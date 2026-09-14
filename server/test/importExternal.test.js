const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('./helpers');
const { Task } = require('../src/models/Task');
const { Taxonomy } = require('../src/models/Taxonomy');
const { Project } = require('../src/models/Project');
const { convertExternalJson, isJiraExternalJson, durationSeconds } = require('../src/import/jira/externalJson');
const { detectFile, parseImportFiles } = require('../src/import/jira/parseFiles');

const CONTENT = fs.readFileSync(path.join(__dirname, 'fixtures', 'jira', 'external-system.json'), 'utf8');

test('converter: external-system JSON → REST search page', () => {
  const data = JSON.parse(CONTENT);
  assert.equal(isJiraExternalJson(data), true);
  assert.equal(detectFile(CONTENT).format, 'jira-external-json');
  const { page, report } = convertExternalJson(data);
  assert.equal(page.issues.length, 3);
  assert.equal(report.effortToPoints, 3);
  const arc = page.issues[0];
  assert.equal(arc.key, 'ARC-001');
  assert.equal(arc.fields.customfield_19000, 2);
  assert.equal(arc.fields.status.name, 'To Do');
  assert.equal(arc.fields.created, '2026-09-13T09:00:00.000+0200');
  assert.match(arc.fields.description, /h3\. Champs Jira/);
  assert.match(arc.fields.description, /Relates → SEC-002/);
  assert.match(page.issues[1].fields.description, /Relates ← ARC-001/);
  assert.equal(durationSeconds('PT2H30M'), 9000);
  assert.equal(durationSeconds('P1DT2H'), 36000);

  // The converted file is itself importable (REST format).
  const bundle = parseImportFiles([{ name: 'converted.json', content: JSON.stringify(page) }]);
  assert.equal(bundle.files[0].format, 'jira-issues-json');
  assert.equal(bundle.fields.category.suggested, 'cf:categorie');
});

let ctx;
let admin;

before(async () => {
  ctx = await startTestServer();
  admin = ctx.client(await ctx.login('admin'));
  assert.equal((await admin.post('/projects', { key: 'AUD', name: 'Audit Démo' })).status, 201);
});

after(async () => {
  await ctx.stop();
});

test('importing the original file creates categories, domains, labels, points and readable descriptions', async () => {
  const files = [{ name: 'kydosjira.json', content: CONTENT }];
  const analysis = await admin.post('/projects/AUD/import/jira/analyze', { files });
  assert.equal(analysis.status, 200, JSON.stringify(analysis.body));
  assert.equal(analysis.body.files[0].format, 'jira-external-json');
  assert.equal(analysis.body.mapping.fields.category, 'cf:categorie');
  assert.equal(analysis.body.mapping.fields.storyPoints, 'cf:story points');
  assert.equal(analysis.body.mapping.statuses['To Do'], 'pending');
  assert.ok(analysis.body.entities.fields.textFields.some((f) => f.label === 'Catégorie'));

  const run = await admin.post('/projects/AUD/import/jira', { files, dryRun: false });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.equal(run.body.counts.created, 3);
  assert.deepEqual(run.body.taxonomiesCreated.category.sort(), ['fonctionnel', 'securite']);

  const project = await Project.findOne({ key: 'AUD' });
  const tasks = await Task.find({ project: project._id }).sort({ taskId: 1 }).lean();
  assert.deepEqual(tasks.map((t) => t.external.key), ['ARC-001', 'CHK-003', 'SEC-002']);
  const arc = tasks.find((t) => t.external.key === 'ARC-001');
  assert.equal(arc.category, 'fonctionnel');
  assert.equal(arc.area, 'server');
  assert.equal(arc.priority, 'P0');
  assert.equal(arc.type, 'bug');
  assert.equal(arc.status, 'pending');
  assert.equal(arc.complexity, 2);
  assert.deepEqual(arc.labels, ['audit-2026-09-13', 'gravite-critique', 'wallet']);
  assert.equal(arc.createdAt.toISOString(), '2026-09-13T07:00:00.000Z');
  assert.match(arc.description, /Champs Jira/);
  assert.match(arc.description, /\*\*CWE\*\* : CWE-840/);
  assert.doesNotMatch(arc.description, /Champs Jira[\s\S]*Gravité/); // already stated in the Jira description
  assert.match(arc.description, /Tickets liés\n- Relates → SEC-002/);
  assert.equal(tasks.find((t) => t.external.key === 'CHK-003').complexity, 8);
  const categories = await Taxonomy.find({ project: project._id, kind: 'category' }).lean();
  assert.deepEqual(categories.map((c) => c.label).sort(), ['Fonctionnel', 'Sécurité']);
  assert.ok(categories.every((c) => /^#[0-9a-f]{6}$/i.test(c.color)));

  const again = await admin.post('/projects/AUD/import/jira', { files, dryRun: false });
  assert.equal(again.body.counts.unchanged, 3);
});
