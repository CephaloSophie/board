#!/usr/bin/env node
/**
 * Converts a Jira "External System Import" JSON (projects[].issues[] + links) into the Jira REST
 * search format read by Kýdos (Paramètres → Import / Export).
 *
 *   npm run jira:convert -- <input.json> [output.json] [--effort S=2,M=5,L=8] [--status "To Do"]
 *
 * Default output: <input>.kydos-import.json next to the input. The app also accepts the original
 * file directly; converting first lets you review / edit the result before importing.
 */
const fs = require('fs');
const path = require('path');
const { isJiraExternalJson, convertExternalJson } = require('../src/import/jira/externalJson');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--effort', '--status'].includes(all[i - 1]));
const [input, outputArg] = positional;
if (!input) {
  console.error('Usage : npm run jira:convert -- <export-jira.json> [sortie.json] [--effort S=2,M=5,L=8] [--status "To Do"]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
if (!isJiraExternalJson(data)) {
  console.error('Format non reconnu : un objet { projects: [{ issues: [...] }], links?: [...] } est attendu.');
  process.exit(1);
}

const effortPoints = argValue('--effort')
  ? Object.fromEntries(argValue('--effort').split(',').map((pair) => pair.split('=')).map(([k, v]) => [k.trim().toUpperCase(), Number(v)]))
  : undefined;
const { page, versions, report } = convertExternalJson(data, { effortPoints, defaultStatus: argValue('--status') });

const output = path.resolve(outputArg || input.replace(/\.json$/i, '') + '.kydos-import.json');
fs.writeFileSync(output, `${JSON.stringify(page, null, 2)}\n`);
console.log(`✔ ${report.issues} ticket(s) converti(s) → ${output}`);
if (versions.length) {
  const versionsFile = output.replace(/\.json$/i, '') + '.versions.json';
  fs.writeFileSync(versionsFile, `${JSON.stringify(versions, null, 2)}\n`);
  console.log(`✔ ${versions.length} version(s) → ${versionsFile}`);
}
console.log(`  champs personnalisés : ${report.customFields.join(', ') || 'aucun'}`);
console.log(`  effort → points : ${report.effortToPoints} · statut par défaut : ${report.statusDefaulted} · dates déduites : ${report.datesInferred} · liens : ${report.links}`);
