const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, toCsv } = require('../src/import/csv');

test('parses quoted fields, escaped quotes, embedded newlines and repeated headers', () => {
  const csv = '﻿Summary,Issue key,Sprint,Sprint,Description\r\n' +
    '"Login, SSO",KB-1,Sprint 1,Sprint 2,"Line 1\nLine ""2"""\r\n' +
    'Cache,KB-2,,,\n';
  const { headers, rows } = parseCsv(csv);
  assert.deepEqual(headers, ['Summary', 'Issue key', 'Sprint', 'Sprint', 'Description']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['Login, SSO', 'KB-1', 'Sprint 1', 'Sprint 2', 'Line 1\nLine "2"']);
  assert.deepEqual(rows[1], ['Cache', 'KB-2', '', '', '']);
});

test('detects semicolon delimiters (French Excel exports)', () => {
  const { headers, rows, delimiter } = parseCsv('Summary;Status\n"A;b";Done\n');
  assert.equal(delimiter, ';');
  assert.deepEqual(headers, ['Summary', 'Status']);
  assert.deepEqual(rows[0], ['A;b', 'Done']);
});

test('toCsv round-trips through parseCsv', () => {
  const headers = ['Summary', 'Description'];
  const rows = [['Quote "x"', 'multi\nline'], ['plain', 'a,b']];
  const parsed = parseCsv(toCsv(headers, rows));
  assert.deepEqual(parsed.headers, headers);
  assert.deepEqual(parsed.rows, rows);
});
