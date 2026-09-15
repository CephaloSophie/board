/**
 * Aligns projects on their current release (default 19.0.3):
 *   - every version older than the release is published, the release version is created / reopened;
 *   - every sprint of an older version (or already active / past) is finished with a frozen report;
 *   - the release sprint (`sprint-<version>`) is created if missing and becomes the single active sprint;
 *   - project.currentVersion / currentSprint point at the release.
 * Tasks are never moved: open tasks of finished sprints stay visible in Planification → « Reste à faire ».
 * Newer versions / future sprints are left untouched. Idempotent.
 *
 *   npm run release:align -- --dry-run                      all projects, version 19.0.3, writes nothing
 *   npm run release:align -- --version 19.0.3 --project KB,KYDOBE
 */
const { Project } = require('../models/Project');
const { Taxonomy } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { statusContext } = require('../utils/taxonomyMeta');
const { compareVersions } = require('../utils/versions');
const { logActivity, projectActivity } = require('../utils/activity');

const DEFAULT_VERSION = '19.0.3';
const DAY = 86400000;
const VERSION_RE = /^\d+(\.\d+){1,3}$/;

// Version a sprint belongs to: meta.linkedVersion, or the "sprint-<version>" key convention.
function sprintVersionOf(sprint) {
  if (sprint.meta?.linkedVersion) return sprint.meta.linkedVersion;
  const m = /^sprint-(\d+(?:\.\d+)*)$/.exec(sprint.key);
  return m ? m[1] : null;
}

function mondayOf(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
}

const points = (tasks) => tasks.reduce((a, t) => a + (Number(t.complexity) || 0), 0);

async function setMeta(item, patch) {
  const meta = { ...(item.meta || {}), ...patch };
  for (const [k, v] of Object.entries(meta)) if (v === undefined) delete meta[k];
  item.meta = meta;
  item.markModified('meta');
  await item.save();
}

async function alignProject(project, { version, dryRun, now, user }) {
  const nowIso = now.toISOString();
  const start = mondayOf(now);
  const end = new Date(start.getTime() + (project.effectiveSprintDays() - 1) * DAY);
  const report = {
    project: project.key,
    version,
    versionCreated: false,
    versionReopened: false,
    versionsReleased: [],
    sprintsFinished: [],
    sprintsDeactivated: [],
    sprintCreated: null,
    sprintStarted: null,
    currentSprint: { from: project.currentSprint || null, to: null },
    currentVersion: { from: project.currentVersion || null, to: version },
    openTasksInFinishedSprints: 0,
    skipped: [],
    changes: 0,
  };
  const writes = [];
  const later = (fn) => {
    report.changes += 1;
    writes.push(fn);
  };

  const taxonomies = await Taxonomy.find({ project: project._id, kind: { $in: ['sprint', 'version'] } }).sort({ order: 1 });
  const versions = taxonomies.filter((t) => t.kind === 'version');
  const sprints = taxonomies.filter((t) => t.kind === 'sprint');
  const ctx = await statusContext(project._id);
  const tasksOf = (key) => Task.find({ project: project._id, sprint: key }, { taskId: 1, status: 1, complexity: 1 }).lean();
  const nextOrder = (list) => list.reduce((m, t) => Math.max(m, t.order || 0), -1) + 1;

  // 1. Versions: publish the older ones, make sure the release exists and is open.
  const release = versions.find((v) => v.key === version);
  if (!release) {
    report.versionCreated = true;
    later(() =>
      Taxonomy.create({
        project: project._id,
        kind: 'version',
        key: version,
        label: version,
        order: nextOrder(versions),
        meta: { status: 'unreleased', startDate: start.toISOString() },
      })
    );
  } else if (release.meta?.status !== 'unreleased' || release.archived) {
    report.versionReopened = release.meta?.status === 'released' || release.archived;
    later(async () => {
      release.archived = false;
      await setMeta(release, { status: 'unreleased', releasedAt: undefined });
    });
  }
  for (const v of versions) {
    if (v.key === version || v.meta?.status === 'released') continue;
    if (compareVersions(v.key, version) > 0) {
      report.skipped.push(`version ${v.key} (postérieure à ${version})`);
      continue;
    }
    report.versionsReleased.push(v.key);
    later(() => setMeta(v, { status: 'released', releasedAt: v.meta?.releaseDate || nowIso }));
  }

  // 2. Sprints: finish everything that belongs to the past.
  const releaseSprint = sprints.find((s) => s.key === `sprint-${version}`) || sprints.find((s) => s.meta?.linkedVersion === version) || null;
  for (const s of sprints) {
    if (s === releaseSprint || s.meta?.status === 'finished') continue;
    if (s.key === 'backlog') {
      report.skipped.push('sprint « backlog » (pseudo-sprint : lancez d’abord npm run migrate)');
      continue;
    }
    const status = s.meta?.status || 'draft';
    const sprintVersion = sprintVersionOf(s);
    const newer = sprintVersion && compareVersions(sprintVersion, version) > 0;
    if (newer) {
      if (status === 'active') {
        report.sprintsDeactivated.push(s.key);
        later(() => setMeta(s, { status: 'ready' }));
      } else report.skipped.push(`sprint ${s.key} (version postérieure)`);
      continue;
    }
    const past = s.meta?.endDate && new Date(s.meta.endDate) < start;
    const older = sprintVersion ? compareVersions(sprintVersion, version) < 0 : status === 'active' || past;
    if (!older) {
      report.skipped.push(`sprint ${s.key} (à venir)`);
      continue;
    }
    const tasks = await tasksOf(s.key);
    const done = tasks.filter((t) => ctx.categoryOf(t.status) === 'done');
    const open = tasks.filter((t) => ctx.categoryOf(t.status) !== 'done');
    report.sprintsFinished.push(s.key);
    report.openTasksInFinishedSprints += open.length;
    later(() =>
      setMeta(s, {
        status: 'finished',
        closedAt: s.meta?.closedAt || nowIso,
        ...(s.meta?.report
          ? {}
          : {
              report: {
                committedPoints: s.meta?.startSnapshot?.committedPoints ?? points(tasks),
                committedCount: s.meta?.startSnapshot?.committedCount ?? tasks.length,
                completedPoints: points(done),
                completedCount: done.length,
                carriedOverTaskIds: [],
                carriedOverPoints: 0,
                carriedTo: null,
                keptTaskIds: open.map((t) => t.taskId),
                source: 'alignment',
              },
            }),
      })
    );
  }

  // 3. The release sprint is the single active one.
  let releaseKey = releaseSprint?.key || `sprint-${version}`;
  if (!releaseSprint) {
    if (sprints.some((s) => s.key === releaseKey)) releaseKey = `${releaseKey}-${Date.now()}`;
    report.sprintCreated = releaseKey;
    later(() =>
      Taxonomy.create({
        project: project._id,
        kind: 'sprint',
        key: releaseKey,
        label: `Sprint ${version}`,
        order: nextOrder(sprints),
        meta: {
          status: 'active',
          linkedVersion: version,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          goal: `Livrer la version ${version}.`,
          startedAt: nowIso,
          startSnapshot: { at: nowIso, committedPoints: 0, committedCount: 0, taskIds: [] },
        },
      })
    );
  } else if (releaseSprint.meta?.status !== 'active' || releaseSprint.archived) {
    const tasks = await tasksOf(releaseSprint.key);
    report.sprintStarted = releaseSprint.key;
    later(async () => {
      releaseSprint.archived = false;
      await setMeta(releaseSprint, {
        status: 'active',
        linkedVersion: releaseSprint.meta?.linkedVersion || version,
        startDate: releaseSprint.meta?.startDate || start.toISOString(),
        endDate: releaseSprint.meta?.endDate || end.toISOString(),
        startedAt: nowIso,
        startSnapshot: { at: nowIso, committedPoints: points(tasks), committedCount: tasks.length, taskIds: tasks.map((t) => t.taskId) },
        closedAt: undefined,
        closedBy: undefined,
        report: undefined,
      });
    });
  }

  // 4. Project pointers.
  report.currentSprint.to = releaseKey;
  if (project.currentSprint !== releaseKey || project.currentVersion !== version) {
    later(async () => {
      project.currentSprint = releaseKey;
      project.currentVersion = version;
      await project.save();
    });
  }

  if (!dryRun && writes.length) {
    for (const write of writes) await write();
    await logActivity([
      projectActivity(project, user, {
        scope: 'version',
        action: 'release.aligned',
        note: `Alignement sur la version ${version} : ${report.sprintsFinished.length} sprint(s) clôturé(s), ${report.versionsReleased.length} version(s) publiée(s).`,
        sprints: [releaseKey],
        versions: [version],
        data: { ...report, sprintsFinished: report.sprintsFinished.length, versionsReleased: report.versionsReleased.length },
      }),
      ...(report.currentSprint.from !== releaseKey
        ? [projectActivity(project, user, { scope: 'sprint', action: 'sprint.current', field: 'currentSprint', from: report.currentSprint.from, to: releaseKey, sprints: [report.currentSprint.from, releaseKey], note: `Sprint ${version} défini comme sprint courant.` })]
        : []),
      ...(report.currentVersion.from !== version
        ? [projectActivity(project, user, { scope: 'version', action: 'version.current', field: 'currentVersion', from: report.currentVersion.from, to: version, versions: [report.currentVersion.from, version], note: `Version courante : ${version}.` })]
        : []),
    ]);
  }
  return report;
}

function describe(r, dryRun) {
  const range = (list) => (list.length ? ` (${list[0]} … ${list[list.length - 1]})` : '');
  return [
    `[release:align] ${dryRun ? '(dry-run) ' : ''}${r.project} → ${r.version} : ${r.changes ? `${r.changes} changement(s)` : 'déjà aligné'}`,
    `  versions publiées : ${r.versionsReleased.length}${range(r.versionsReleased)}`,
    `  version ${r.version} : ${r.versionCreated ? 'créée' : r.versionReopened ? 'rouverte' : 'existante'}`,
    `  sprints clôturés : ${r.sprintsFinished.length}${range(r.sprintsFinished)} — tâches encore ouvertes dans ces sprints : ${r.openTasksInFinishedSprints}`,
    `  sprint courant : ${r.currentSprint.from || '—'} → ${r.currentSprint.to}${r.sprintCreated ? ' (créé, actif)' : r.sprintStarted ? ' (activé)' : ''}`,
    `  version courante : ${r.currentVersion.from || '—'} → ${r.currentVersion.to}`,
    ...(r.sprintsDeactivated.length ? [`  sprints postérieurs repassés « prêt » : ${r.sprintsDeactivated.join(', ')}`] : []),
    ...(r.skipped.length ? [`  inchangés : ${r.skipped.join(' ; ')}`] : []),
  ].join('\n');
}

async function alignRelease({ version = DEFAULT_VERSION, projectKeys, dryRun = false, now = new Date(), logger = console, user = null } = {}) {
  if (!VERSION_RE.test(String(version))) throw new Error(`Version invalide : « ${version} » (attendu : 19.0.3).`);
  const filter = projectKeys?.length ? { key: { $in: projectKeys.map((k) => k.trim().toUpperCase()) } } : { archived: { $ne: true } };
  const projects = await Project.find(filter).sort({ key: 1 });
  const reports = [];
  for (const project of projects) {
    const report = await alignProject(project, { version: String(version), dryRun, now, user });
    reports.push(report);
    logger.log(describe(report, dryRun));
  }
  if (!projects.length) logger.log('[release:align] aucun projet trouvé.');
  return reports;
}

module.exports = { alignRelease, sprintVersionOf, DEFAULT_VERSION };

if (require.main === module) {
  const { connectDb, mongoose } = require('../db');
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  connectDb()
    .then(() =>
      alignRelease({
        version: arg('--version') || process.env.KYDOS_CURRENT_VERSION || DEFAULT_VERSION,
        projectKeys: arg('--project')?.split(',').filter(Boolean),
        dryRun: process.argv.includes('--dry-run'),
      })
    )
    .then(() => mongoose.disconnect())
    .catch((err) => {
      console.error('[release:align] échec :', err.message);
      process.exit(1);
    });
}
