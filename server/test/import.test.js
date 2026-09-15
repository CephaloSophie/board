const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer, PASSWORD } = require('./helpers');
const { User } = require('../src/models/User');
const { Task } = require('../src/models/Task');
const { Taxonomy } = require('../src/models/Taxonomy');
const { Project } = require('../src/models/Project');
const { hashPassword } = require('../src/utils/password');
const { createDateParser } = require('../src/import/jira/dates');
const { secondsToDuration, hoursOf } = require('../src/utils/duration');
const { adfToText, wikiToText } = require('../src/import/jira/markup');
const { normalizeText } = require('../src/import/jira/text');
const { detectFile, parseImportFiles } = require('../src/import/jira/parseFiles');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'jira', name), 'utf8');
const CSV = fixture('cloud-all-fields.csv');
const ISSUES_JSON = fixture('search-jql.json');
const SPRINTS_JSON = fixture('board-sprints.json');
const VERSIONS_JSON = fixture('project-versions.json');

describe('jira parsing (unit)', () => {
  test('dates: Jira formats, timezone and DST', () => {
    const parse = createDateParser([], { timezone: 'Europe/Paris' });
    assert.equal(parse('14/Sep/26 9:05 AM').toISOString(), '2026-09-14T07:05:00.000Z');
    assert.equal(parse('01/Jul/26 12:00 AM').toISOString(), '2026-06-30T22:00:00.000Z');
    assert.equal(parse('04/Sep/26 12:20 PM').toISOString(), '2026-09-04T10:20:00.000Z');
    assert.equal(parse('30/Sep/26').toISOString(), '2026-09-30T00:00:00.000Z');
    assert.equal(parse('14/sept./26 09:05').toISOString(), '2026-09-14T07:05:00.000Z');
    assert.equal(parse('2026-09-14T09:05:12.345+0200').toISOString(), '2026-09-14T07:05:12.345Z');
    assert.equal(parse('2026-01-10 10:00').toISOString(), '2026-01-10T09:00:00.000Z');
    assert.equal(parse('pas une date'), null);
  });

  test('durations: seconds ↔ Kýdos text', () => {
    assert.equal(secondsToDuration(28800), '1j');
    assert.equal(secondsToDuration(5400), '1h 30min');
    assert.equal(secondsToDuration(100800), '3j 4h');
    assert.equal(secondsToDuration(900), '15min');
    assert.equal(hoursOf('1h 30min'), 1.5);
    assert.equal(hoursOf('1j 2h'), 10);
  });

  test('ADF and wiki descriptions convert to the same normalized text', () => {
    const csvBundle = parseImportFiles([{ name: 'a.csv', content: CSV }]);
    const jsonBundle = parseImportFiles([{ name: 'a.json', content: ISSUES_JSON }]);
    const csv5 = csvBundle.issues.find((i) => i.externalKey === 'KB-5').description;
    const json5 = jsonBundle.issues.find((i) => i.externalKey === 'KB-5').description;
    assert.equal(normalizeText(csv5), normalizeText(json5));
    assert.match(wikiToText('{code}* pas une liste{code}'), /\* pas une liste/);
    assert.equal(adfToText({ type: 'doc', content: [{ type: 'rule' }] }), '---');
  });

  test('format detection and CSV normalization', () => {
    assert.equal(detectFile(CSV).format, 'csv');
    assert.equal(detectFile(ISSUES_JSON).format, 'jira-issues-json');
    assert.equal(detectFile(SPRINTS_JSON).format, 'jira-sprints-json');
    assert.equal(detectFile(VERSIONS_JSON).format, 'jira-versions-json');
    assert.equal(detectFile('<?xml version="1.0"?><rss/>').format, 'jira-xml');
    assert.throws(() => parseImportFiles([{ name: 'x.csv', content: 'a,b\n1,2' }]), (e) => e.code === 'CSV_NOT_JIRA');
    assert.throws(() => parseImportFiles([{ name: 'x.xml', content: '<rss/>' }]), (e) => e.code === 'UNSUPPORTED_FORMAT');

    const bundle = parseImportFiles([{ name: 'a.csv', content: CSV }], { timezone: 'Europe/Paris' });
    assert.equal(bundle.issues.length, 6);
    const kb2 = bundle.issues.find((i) => i.externalKey === 'KB-2');
    assert.deepEqual(kb2.sprints.map((s) => s.name), ['KB Sprint 1', 'KB Sprint 2']);
    assert.deepEqual(kb2.fixVersions, ['1.0.0', '1.1.0']);
    assert.equal(kb2.comments.length, 2);
    assert.equal(kb2.comments[1].author.displayName, 'Carole Martin');
    assert.equal(bundle.fields.storyPoints.suggested, 'cf:story point estimate');
    const kb3 = bundle.issues.find((i) => i.externalKey === 'KB-3');
    assert.match(kb3.comments[0].body, /arrondi flottant; corrigé/);
    assert.equal(kb3.resolved.toISOString(), '2026-09-03T12:31:00.000Z');
  });
});

describe('jira import (API)', () => {
  let ctx;
  let admin;
  let dev;
  let alice;

  before(async () => {
    ctx = await startTestServer();
    admin = ctx.client(await ctx.login('admin'));
    dev = ctx.client(await ctx.login('dev'));
    alice = await User.create({ username: 'alice', displayName: 'Alice Durand', email: 'alice.durand@example.com', passwordHash: await hashPassword(PASSWORD) });
    assert.equal((await admin.post('/projects', { key: 'KB', name: 'Kýdos Boutique' })).status, 201);
    assert.equal((await admin.post('/projects', { key: 'DEMO', name: 'Démo' })).status, 201);
  });

  after(async () => {
    await ctx.stop();
  });

  test('analyze suggests correspondences and writes nothing; members are refused', async () => {
    const denied = await dev.post('/projects/KB/import/jira/analyze', { files: [{ name: 'jira.csv', content: CSV }] });
    assert.equal(denied.status, 403);

    const r = await admin.post('/projects/KB/import/jira/analyze', { files: [{ name: 'jira.csv', content: CSV }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dryRun, true);
    assert.deepEqual(r.body.counts, { created: 6, updated: 0, unchanged: 0, skipped: 0, errors: 0, warnings: r.body.counts.warnings });
    assert.deepEqual(r.body.mapping.statuses, { 'In Progress': 'onprocess', Done: 'finished', 'To Do': 'pending', Backlog: 'draft' });
    assert.equal(r.body.mapping.priorities.Lowest, 'P3');
    assert.equal(r.body.mapping.people['712020:1a2b3c4d-0000-4000-8000-00000000a11c'], String(alice._id));
    assert.deepEqual(r.body.taxonomiesCreated.type.sort(), ['epic', 'story', 'subtask', 'task']);
    assert.ok(r.body.warnings.some((w) => w.code === 'SPRINT_STATE_GUESSED'));
    assert.equal(await Task.countDocuments({}), 0);
    assert.equal(await Taxonomy.countDocuments({ kind: 'sprint' }), 0);
  });

  test('CSV import creates tasks, sprints, versions and comments as expected', async () => {
    const r = await admin.post('/projects/KB/import/jira', { files: [{ name: 'jira.csv', content: CSV }], dryRun: false });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.counts.created, 6);
    assert.ok(r.body.jobId);

    const tasks = await Task.find({}).lean();
    const get = (id) => tasks.find((t) => t.taskId === id);
    assert.deepEqual(tasks.map((t) => t.taskId).sort(), ['KB-001', 'KB-002', 'KB-003', 'KB-004', 'KB-005', 'KB-006']);

    const kb1 = get('KB-001');
    assert.equal(kb1.type, 'epic');
    assert.equal(kb1.sprint, null);
    assert.equal(kb1.dueDate.toISOString(), '2026-09-30T00:00:00.000Z');
    assert.equal(kb1.external.assigneeName, 'Carole Martin');

    const kb2 = get('KB-002');
    assert.equal(kb2.status, 'onprocess');
    assert.equal(kb2.priority, 'P2');
    assert.equal(kb2.sprint, 'kb-sprint-2');
    assert.deepEqual(kb2.sprintHistory, ['kb-sprint-1', 'kb-sprint-2']);
    assert.equal(kb2.complexity, 5);
    assert.equal(kb2.estimate, '1j');
    assert.equal(kb2.duration, '4h');
    assert.equal(kb2.version, '1.0.0');
    assert.deepEqual(kb2.fixVersions, ['1.0.0', '1.1.0']);
    assert.equal(kb2.parent, 'KB-001');
    assert.equal(String(kb2.assignee), String(alice._id));
    assert.deepEqual(kb2.labels, ['paiement', 'front']);
    assert.equal(kb2.area, 'api');
    assert.equal(kb2.createdAt.toISOString(), '2026-07-02T09:30:00.000Z');
    assert.equal(kb2.external.key, 'KB-2');
    assert.equal(kb2.comments.length, 2);
    assert.equal(kb2.comments[0].createdAt.toISOString(), '2026-08-25T07:05:00.000Z');
    assert.equal(String(kb2.comments[0].author), String(alice._id));
    assert.equal(kb2.comments[1].authorLabel, 'Carole Martin');
    assert.ok(kb2.history.some((h) => h.field === 'sprint' && h.from === 'kb-sprint-1' && h.to === 'kb-sprint-2'));

    const kb3 = get('KB-003');
    assert.equal(kb3.type, 'bug');
    assert.equal(kb3.status, 'finished');
    assert.equal(kb3.priority, 'P0');
    assert.equal(kb3.sprint, 'kb-sprint-1');
    assert.equal(kb3.resolvedAt.toISOString(), '2026-09-03T12:31:00.000Z');
    assert.equal(kb3.duration, '1h 30min');
    assert.match(kb3.description, /Environnement : Chrome 128 \/ Windows 11$/);

    assert.equal(get('KB-004').parent, 'KB-002');
    assert.equal(get('KB-004').sprint, 'kb-sprint-2');
    assert.match(get('KB-005').description, /## Contexte|### Contexte/);
    assert.equal(get('KB-006').status, 'draft');
    assert.equal(get('KB-006').sprint, null);

    const sprints = await Taxonomy.find({ kind: 'sprint' }).lean();
    const status = Object.fromEntries(sprints.map((s) => [s.key, s.meta.status]));
    assert.deepEqual(status, { 'kb-sprint-1': 'finished', 'kb-sprint-2': 'active', 'kb-sprint-3': 'draft' });
    assert.equal(sprints.find((s) => s.key === 'kb-sprint-1').meta.report.completedPoints, 2);
    assert.equal((await Project.findOne({ key: 'KB' })).currentSprint, 'kb-sprint-2');

    const created = await admin.post('/projects/KB/tasks', { title: 'Manuelle', status: 'pending' });
    assert.equal(created.body.task.taskId, 'KB-007');
  });

  test('re-importing the same file is idempotent; a changed value updates once', async () => {
    const again = await admin.post('/projects/KB/import/jira', { files: [{ name: 'jira.csv', content: CSV }], dryRun: false });
    assert.equal(again.status, 201);
    assert.equal(again.body.counts.created, 0);
    assert.equal(again.body.counts.unchanged, 6);
    assert.equal((await Task.findOne({ taskId: 'KB-002' })).comments.length, 2);

    const edited = CSV.replace('Historique des paiements,KB-6,10006,Story,Backlog,To Do,KB,Kýdos Boutique,Lowest', 'Historique des paiements,KB-6,10006,Story,Backlog,To Do,KB,Kýdos Boutique,High');
    const updated = await admin.post('/projects/KB/import/jira', { files: [{ name: 'jira.csv', content: edited }], dryRun: false });
    assert.equal(updated.body.counts.updated, 1);
    const kb6 = await Task.findOne({ taskId: 'KB-006' });
    assert.equal(kb6.priority, 'P1');
    assert.equal(kb6.history.filter((h) => h.field === 'priority').length, 1);

    const createOnly = await admin.post('/projects/KB/import/jira', { files: [{ name: 'jira.csv', content: CSV }], options: { mode: 'create' } });
    assert.equal(createOnly.body.counts.skipped, 6);
  });

  test('JSON import with sprints and versions files renumbers keys into another project, then rolls back', async () => {
    const files = [
      { name: 'issues.json', content: ISSUES_JSON },
      { name: 'sprints.json', content: SPRINTS_JSON },
      { name: 'versions.json', content: VERSIONS_JSON },
    ];
    const r = await admin.post('/projects/DEMO/import/jira', { files, dryRun: false, options: { componentToArea: false } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.counts.created, 6);
    assert.equal(r.body.idPlan.renumbered, 6);

    const project = await Project.findOne({ key: 'DEMO' });
    const tasks = await Task.find({ project: project._id }).lean();
    const byKey = Object.fromEntries(tasks.map((t) => [t.external.key, t]));
    assert.equal(byKey['KB-1'].taskId, 'DEMO-001');
    assert.equal(byKey['KB-2'].parent, 'DEMO-001');
    assert.equal(byKey['KB-4'].parent, 'DEMO-002');
    assert.equal(String(byKey['KB-2'].assignee), String(alice._id));
    assert.equal(byKey['KB-2'].comments[0].externalId, '20001');
    assert.equal(byKey['KB-6'].complexity, 8);
    assert.equal(project.currentSprint, 'kb-sprint-2');

    const sprint1 = await Taxonomy.findOne({ project: project._id, kind: 'sprint', key: 'kb-sprint-1' }).lean();
    assert.equal(sprint1.meta.status, 'finished');
    assert.equal(sprint1.meta.startDate, '2026-08-24T07:00:00.000Z');
    assert.equal(sprint1.meta.goal, 'Paiement carte de bout en bout');
    assert.equal(sprint1.meta.report.committedPoints, 7);
    const v090 = await Taxonomy.findOne({ project: project._id, kind: 'version', key: '0.9.0' }).lean();
    assert.equal(v090.meta.status, 'released');

    // A task edited after the import survives the rollback.
    await admin.patch('/projects/DEMO/tasks/DEMO-006', { title: 'Historique des paiements (modifié)' });
    const rollback = await admin.post(`/projects/DEMO/import/jobs/${r.body.jobId}/rollback`);
    assert.equal(rollback.status, 200, JSON.stringify(rollback.body));
    assert.equal(rollback.body.report.tasksDeleted, 5);
    assert.deepEqual(rollback.body.report.tasksKept.map((t) => t.taskId), ['DEMO-006']);
    assert.equal(await Task.countDocuments({ project: project._id }), 1);
    assert.equal((await Taxonomy.exists({ project: project._id, kind: 'sprint', key: 'kb-sprint-1' })), null);
    const jobs = await admin.get('/projects/DEMO/import/jobs');
    assert.equal(jobs.body.jobs[0].status, 'rolledBack');
  });

  test('exports: Jira-compatible CSV (re-importable) and JSON bundle without secrets', async () => {
    const csv = await admin.get('/projects/KB/export?format=csv');
    assert.equal(csv.status, 200);
    const text = csv.body;
    assert.match(String(text), /Summary,Issue key,Issue Type/);
    const bundle = parseImportFiles([{ name: 'export.csv', content: String(text) }]);
    assert.equal(bundle.issues.length, 7);
    assert.ok(bundle.issues.some((i) => i.externalKey === 'KB-002' && i.sprints[0]?.name === 'KB Sprint 2'));

    const json = await admin.get('/projects/KB/export?format=json');
    assert.equal(json.status, 200);
    assert.equal(json.body.schema, 'kydos-project/1');
    assert.equal(json.body.tasks.length, 7);
    assert.equal(JSON.stringify(json.body).includes('passwordHash'), false);
  });
});
