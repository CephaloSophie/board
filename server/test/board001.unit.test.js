// Pure unit tests (no database): acceptance criteria sync, merge request URLs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Task } = require('../src/models/Task');
const { syncCriteriaOnSave, criteriaFromInput, reorderCriteria, syncCriteriaFromTexts } = require('../src/utils/criteria');
const { parseMergeRequestUrl, mergeRequestFromInput, mergeRequestLabel } = require('../src/utils/mergeRequests');

const base = { project: '64b000000000000000000001', taskId: 'KB-1', title: 't', status: 'todo' };

test('legacy acceptance strings become structured criteria, with the mirror kept', () => {
  const task = new Task({ ...base, acceptance: ['Le bouton est visible', 'Un toast confirme'] });
  syncCriteriaOnSave(task);
  assert.deepEqual(task.criteria.map((c) => c.text), ['Le bouton est visible', 'Un toast confirme']);
  assert.deepEqual([...task.acceptance], ['Le bouton est visible', 'Un toast confirme']);
  assert.ok(task.criteria.every((c) => c._id && c.done === false));
});

test('criteria edits refresh the acceptance mirror (including deleting everything)', () => {
  const task = new Task({ ...base, criteria: [{ text: 'A' }, { text: 'B' }] });
  syncCriteriaOnSave(task);
  assert.deepEqual([...task.acceptance], ['A', 'B']);
  task.criteria[0].text = 'A bis';
  syncCriteriaOnSave(task);
  assert.deepEqual([...task.acceptance], ['A bis', 'B']);
  task.criteria = [];
  syncCriteriaOnSave(task);
  assert.deepEqual([...task.acceptance], []);
});

test('a text list write keeps the identity, done flag and comments of unchanged criteria', () => {
  const task = new Task({ ...base, criteria: [{ text: 'Garder', done: true, comments: [{ text: 'ok' }] }, { text: 'Retirer' }] });
  const kept = String(task.criteria[0]._id);
  syncCriteriaFromTexts(task, ['Nouveau', 'garder ']);
  assert.deepEqual(task.criteria.map((c) => c.text), ['Nouveau', 'Garder']);
  assert.equal(String(task.criteria[1]._id), kept);
  assert.equal(task.criteria[1].done, true);
  assert.equal(task.criteria[1].comments.length, 1);
});

test('reorder ignores unknown ids and never drops criteria', () => {
  const task = new Task({ ...base, criteria: [{ text: '1' }, { text: '2' }, { text: '3' }] });
  const [a, b, c] = task.criteria.map((x) => String(x._id));
  assert.equal(reorderCriteria(task, [c, 'ffffffffffffffffffffffff', a]), true);
  assert.deepEqual(task.criteria.map((x) => String(x._id)), [c, a, b]);
  assert.equal(reorderCriteria(task, [c, a, b]), false);
});

test('criteriaFromInput: strings or objects, blanks dropped, done stamped', () => {
  const user = { _id: '64b000000000000000000002' };
  const list = criteriaFromInput(['  ', 'Un', { text: 'Deux', done: true }], user);
  assert.equal(list.length, 2);
  assert.equal(list[1].done, true);
  assert.ok(list[1].doneAt instanceof Date);
  assert.throws(() => criteriaFromInput(['x'.repeat(5001)]), /limité/);
});

test('merge request URLs: provider, repository and number are recognised', () => {
  const cases = [
    ['https://gitlab.example.com/team/app/-/merge_requests/42', 'gitlab', 'team/app', '!42'],
    ['https://github.com/acme/api/pull/7/files', 'github', 'acme/api', '#7'],
    ['https://bitbucket.org/acme/api/pull-requests/3', 'bitbucket', 'acme/api', '#3'],
    ['https://git.corp.local/projects/KYD/repos/board/pull-requests/12/overview', 'bitbucket', 'KYD/board', '#12'],
    ['https://dev.azure.com/org/proj/_git/board/pullrequest/99', 'azure', 'org/proj/board', '!99'],
    ['https://codeberg.org/acme/api/pulls/5', 'gitea', 'acme/api', '#5'],
    ['https://example.com/review/1', 'other', '', ''],
  ];
  for (const [url, provider, repo, ref] of cases) {
    const r = parseMergeRequestUrl(url);
    assert.deepEqual([r.provider, r.repo, r.ref], [provider, repo, ref], url);
  }
});

test('merge request URLs: only absolute http(s) links are accepted', () => {
  for (const bad of ['', 'gitlab/team/app', 'javascript:alert(1)', 'ftp://host/x']) {
    assert.throws(() => parseMergeRequestUrl(bad), (e) => /^MR_URL_/.test(e.code), bad);
  }
  assert.throws(() => mergeRequestFromInput({ url: 'https://github.com/a/b/pull/1', state: 'nope' }), (e) => e.code === 'MR_STATE_INVALID');
  const mr = mergeRequestFromInput({ url: 'https://github.com/a/b/pull/1', title: '  Fix   login ' });
  assert.equal(mr.state, 'open');
  assert.equal(mergeRequestLabel(mr), 'a/b #1 · Fix login');
});
