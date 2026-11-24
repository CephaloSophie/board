// Run with `npm test` (node:test, native TypeScript type stripping — Node ≥ 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCriteria, stripMarker, looksLikeList, compileSeparator } from './acceptance.ts';

const texts = (input: string, mode?: Parameters<typeof splitCriteria>[1], pattern?: string) =>
  splitCriteria(input, mode, pattern).items.map((i) => i.text);

test('markdown, unicode and numbered bullets each give one criterion', () => {
  const input = [
    "Critères d'acceptation :",
    '- Le bouton « Payer » est visible',
    '• Un toast confirme le paiement',
    '1. Le reçu est envoyé par e-mail',
    '2) Le montant est arrondi',
    'a) Les erreurs sont traduites',
    'AC3: Le panier est vidé',
  ].join('\n');
  assert.deepEqual(texts(input), [
    'Le bouton « Payer » est visible',
    'Un toast confirme le paiement',
    'Le reçu est envoyé par e-mail',
    'Le montant est arrondi',
    'Les erreurs sont traduites',
    'Le panier est vidé',
  ]);
});

test('checkboxes and check marks set the done flag', () => {
  const items = splitCriteria('- [x] Fait\n- [ ] À faire\n✅ Validé\n☐ Ouvert').items;
  assert.deepEqual(items, [
    { text: 'Fait', done: true },
    { text: 'À faire', done: false },
    { text: 'Validé', done: true },
    { text: 'Ouvert', done: false },
  ]);
});

test('wrapped lines and nested points stay inside their criterion', () => {
  const input = '- Le formulaire valide\n  les champs obligatoires\n- Les messages :\n    - sont en français\n    - restent visibles';
  assert.deepEqual(texts(input), ['Le formulaire valide les champs obligatoires', 'Les messages :\n  - sont en français\n  - restent visibles']);
});

test('an introduction ending with ":" is not a criterion', () => {
  assert.deepEqual(texts("L'écran doit :\n- afficher la liste\n- permettre le tri"), ['afficher la liste', 'permettre le tri']);
});

test('Gherkin scenarios are grouped with their steps', () => {
  const input = 'Scénario : connexion réussie\nÉtant donné un compte actif\nQuand je me connecte\nAlors je vois le tableau de bord\n\nScenario: wrong password\nGiven an account\nThen an error is shown';
  assert.deepEqual(texts(input), [
    '**Scénario : connexion réussie**\n- Étant donné un compte actif\n- Quand je me connecte\n- Alors je vois le tableau de bord',
    '**Scenario: wrong password**\n- Given an account\n- Then an error is shown',
  ]);
});

test('without markers: lines, paragraphs, or a single line with semicolons', () => {
  assert.deepEqual(texts('Premier cas\nSecond cas\n'), ['Premier cas', 'Second cas']);
  assert.deepEqual(texts('Un cas sur\ndeux lignes\n\nUn autre cas'), ['Un cas sur deux lignes', 'Un autre cas']);
  assert.deepEqual(texts('A est vrai; B est faux; C'), ['A est vrai', 'B est faux', 'C']);
});

test('duplicates and empty items are removed, trailing separators trimmed', () => {
  assert.deepEqual(texts('- A;\n- a\n-   \n- B,'), ['A', 'B']);
});

test('explicit modes and custom regular expressions', () => {
  assert.deepEqual(texts('- un\n\n- deux', 'lines'), ['un', 'deux']);
  assert.deepEqual(texts('un | deux | trois', 'regex', '\\s*\\|\\s*'), ['un', 'deux', 'trois']);
  assert.deepEqual(texts('1. un 2. deux 3. trois', 'regex', '\\s*(?=\\b\\d{1,3}[.)]\\s)'), ['un', 'deux', 'trois']);
  assert.match(splitCriteria('x', 'regex', '(').error || '', /invalide/);
  assert.match(compileSeparator('a*').error || '', /vide/);
});

test('helpers', () => {
  assert.deepEqual(stripMarker('  - [x] ok'), { text: 'ok', done: true, bulleted: true });
  assert.equal(stripMarker('-5% de remise').bulleted, false);
  assert.equal(stripMarker('1.5 seconde maximum').bulleted, false);
  assert.equal(looksLikeList('une seule phrase.'), false);
  assert.equal(looksLikeList('- a\n- b'), true);
});
