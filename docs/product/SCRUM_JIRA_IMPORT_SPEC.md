# Spécification : import Jira & pratiques Scrum avancées (Kýdos Board)

| | |
|---|---|
| Statut | Proposition, à valider par le propriétaire produit |
| Date | 14/09/2026 |
| Rédaction | Scrum Master (PSM II) / administrateur Jira |
| Périmètre | Import Jira (CSV, JSON REST, XML évalué), export CSV compatible Jira, fonctionnalités Scrum |
| Hors périmètre | Synchronisation bidirectionnelle temps réel, pièces jointes, worklogs détaillés, workflows Jira |
| Code | Aucune modification de code dans ce document : c'est une spécification |

Conventions : « issue » = élément Jira, « tâche » = `Task` Kýdos. Les noms de colonnes Jira sont écrits `Comme ceci`. **[INCERTAIN]** marque ce qui n'a pas pu être confirmé par une source et doit être vérifié sur un export réel (voir §8).

---

## 0. Synthèse

### 0.1 Décisions clés

| # | Décision |
|---|---|
| D1 | Formats supportés en V1 : **CSV Jira** (Cloud et Data Center) et **JSON REST** (`/rest/api/3/search/jql`, plus sprints `/rest/agile/1.0/board/{id}/sprint` et versions `/rest/api/3/project/{key}/versions`). **XML non supporté** en V1 (§1.4). |
| D2 | Le parseur produit un **modèle intermédiaire unique `NormalizedIssue`** (§4.4). Le mapping et l'import ne connaissent pas le format source. |
| D3 | CSV : les **en-têtes dupliqués** (`Sprint`, `Fix versions`, `Labels`, `Components`, `Comment`, `Watchers`…) sont lus **par position**, jamais via un objet indexé par nom. |
| D4 | Ré-import **idempotent** : clé de rapprochement `(project, source='jira', externalId)`, repli sur `externalKey`. Fusion à trois voies (instantané du dernier import, valeur locale, valeur entrante) (§2.11). |
| D5 | Identifiants : la clé Jira est conservée (au format Kýdos `KB-002`) **si le préfixe correspond au projet et que l'identifiant est libre**, sinon renumérotation. `externalKey` est toujours conservée et le `Counter` est mis à jour avec `$max` (§3). |
| D6 | Nouveaux champs `Task` : `labels[]`, `components[]`, `fixVersions[]`, `affectsVersions[]`, `parent`, `epic`, `sprintHistory[]`, `carryOverCount`, `dueDate`, `resolvedAt`, `resolution`, `time*Sec`, `externalAssignee/Reporter`, `source/externalKey/externalId/externalUrl/importMeta`, `blocked`. Nouveau `KIND` de taxonomie : `component`. |
| D7 | Sprint courant d'une issue = **le dernier sprint non clos** ; si tous sont clos : dernier sprint clos si l'issue est terminée, sinon backlog (`sprint: null`). Tous les sprints sont conservés dans `sprintHistory`. |
| D8 | Utilisateurs : rapprochement mémorisé (`User.externalAccounts`), puis email, puis nom affiché exact ; sinon valeur conservée dans `externalAssignee` / `externalReporter` / `comment.authorLabel`. |
| D9 | API réservée **superadmin** : `POST /api/projects/:projectKey/import/jira/preview` et `POST /api/projects/:projectKey/import/jira` (avec `dryRun`). Parseur JSON dédié à 25 Mo, monté **avant** le parseur global de 2 Mo. |
| D10 | Chaque import crée un `ImportJob` (rapport ligne par ligne) et permet une **annulation** (Jira ne propose pas d'annulation d'import). |
| D11 | Scrum, priorités : P1 = cycle de vie de sprint + burndown/burnup + vélocité ; P2 = capacité + DoD/DoR + alertes ; P3 = planning poker + rétrospective liée aux actions. |

### 0.2 Constats sur l'existant (code lu)

| Élément | Constat | Impact import / Scrum |
|---|---|---|
| `Task.comments[].author` | `required: true` (ref `User`) | Bloque les commentaires d'auteurs Jira non rapprochés : passer à `required: false` et ajouter `authorLabel`. |
| `Task.sprint` / `version` | Valeur unique | Jira est multi-valeurs : ajouter `sprintHistory[]` et `fixVersions[]` en gardant les champs uniques comme « principal ». |
| Backlog | `sprint: null` (seed) ; `DEFAULT_TAXONOMIES` crée aussi une clé sprint `backlog` | L'import écrit `null`. `null` et `'backlog'` sont traités comme équivalents dans les calculs. |
| `utils/taskHistory.js` | Historise `status`, `sprint`, `complexity`, `assignee`… avec `from`/`to` | Base suffisante pour reconstruire burndown et burnup (§6.2), à condition que toute écriture passe par `applyPatchWithHistory`. |
| `valuesEqual` | Compare via `toString()` | Pour les tableaux (`labels`…), la comparaison dépend de l'ordre : trier avant de comparer. |
| `Counter` | `nextTaskNumber` avec `$inc`, identifiants paddés sur 3 chiffres (`KB-042`) | L'import doit faire `$max` avant toute allocation (§3). |
| `index.js` | `express.json({ limit: '2mb' })` global | Un export Jira « all fields » dépasse vite 2 Mo : parseur dédié sur la route d'import (§4.2). |
| Transactions | Mongo en conteneur simple nœud (probablement sans replica set) | Pas de transaction : écritures idempotentes, `ImportJob` et annulation compensatoire. |
| `Taxonomy.meta` | Libre (`isDone`, `status`, `startDate`, `endDate`, `goal`, `linkedVersion`) | On étend `meta` sans migration (§2.1). |
| `Event` | `tasks[]` (note/outcome), `actionItems[]` (text/assignee/done), type `retro` | Support naturel du planning poker et des rétrospectives liées (§6.7, §6.8). |
| Tests | `node --test` dans `server/test/` | Fixtures proposées dans `server/test/fixtures/jira/` (§7). |
| Estimations | Texte libre : `4h`, `1j`, `30min`, `1.5 h` | Conversion des secondes Jira vers ce format (`28800` donne `1j` avec 8 h/jour). |

---

## 1. Formats d'export Jira à supporter

### 1.1 Vue d'ensemble

| Format | Obtention | Richesse | Sprints (état/dates/objectif) | Versions (released/date) | Commentaires | Historique | Support |
|---|---|---|---|---|---|---|---|
| CSV « All fields » | UI, sans droit admin | Bonne | **Nom seulement** | Nom seulement | Oui (`date;auteur;texte`) | Non | **V1** |
| CSV « Current fields » | UI | Colonnes visibles uniquement | Nom seulement | Nom seulement | Si colonne affichée | Non | **V1** (mêmes règles) |
| JSON REST issues | API (token) | Maximale | Oui (objets) | Oui | Oui (ADF) | Oui (`expand=changelog`) | **V1** |
| JSON sprints d'un board | API Agile | Sprints complets | Oui | n/a | n/a | n/a | **V1** (fichier complémentaire) |
| JSON versions d'un projet | API | Versions complètes | n/a | Oui | n/a | n/a | **V1** (fichier complémentaire) |
| XML (RSS 0.92) | UI | Moyenne (HTML) | Nom (customfield) | Nom | Oui (HTML) | Non | **Non** (§1.4) |

Recommandation d'usage à afficher dans le wizard :
- **Meilleur résultat** : JSON issues + JSON sprints + JSON versions (script fourni §1.3.7).
- **Sans accès API** : CSV « All fields ». Il faut ensuite compléter les états et dates des sprints dans l'écran de mapping.

### 1.2 Export CSV

#### 1.2.1 Obtention

- **Jira Cloud** : recherche d'issues ou filtre, puis menu **Export** avec les entrées « CSV (All fields) » et « CSV (Current fields) ». Les anciens libellés « Export Excel CSV (all fields) » et « Export Excel CSV (current fields) » désignent le même contenu. L'export est asynchrone (notification avec lien) et plafonné à **10 000 éléments** (relevé à 10 000 depuis 1 000 en mars 2025 selon Scrumpy).
- **Jira Data Center / Server** : menu **Export**, « CSV (All fields) » / « CSV (Current fields) ». La limite par défaut est souvent de **1 000 lignes** (réglage d'instance). Le séparateur peut être paramétrable selon la version **[INCERTAIN]**.
- Conseil au client : vérifier le nombre de lignes du fichier contre le compteur Jira (troncature silencieuse). L'aperçu Kýdos affiche ce total.

#### 1.2.2 Syntaxe du fichier

- CSV RFC 4180 : champs entre `"` s'ils contiennent `,`, `"` ou un saut de ligne, `""` pour échapper un guillemet. **Les descriptions contiennent des sauts de ligne réels** : le parseur doit gérer les guillemets, jamais un simple `split('\n')`.
- Encodage UTF-8, **BOM possible** (`\uFEFF`) à retirer. Si le décodage produit des `\uFFFD`, afficher un avertissement proposant windows-1252 (fichier ré-enregistré par Excel).
- Séparateur : `,` par défaut. Détection automatique sur la première ligne hors guillemets parmi `,`, `;`, `\t` (le plus fréquent l'emporte).
- **En-têtes dupliqués** : une colonne par valeur, en ordre chronologique pour les commentaires. Une issue passée par neuf sprints produit neuf colonnes `Sprint`, et le nombre de colonnes d'un en-tête répété est le maximum sur l'ensemble du fichier. Un parseur qui construit un objet `{ [header]: value }` ne garde que la dernière colonne : **interdit** (D3).
- Lignes plus courtes que l'en-tête : compléter avec `''` (`relax_column_count`).

Parseur de référence (validé sur la fixture §7.1, sans dépendance) :

```js
// server/src/import/jira/csv/parseCsv.js
function parseCsv(text, delimiter = ',') {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows; // rows[0] = en-têtes (tableau, doublons conservés)
}
```

Alternative acceptable : `csv-parse/sync` avec `{ bom: true, relax_column_count: true, skip_empty_lines: true, columns: false }`.

#### 1.2.3 Catalogue des colonnes

« Multi » = colonne répétée. « DC » = Data Center / Server. Les noms Cloud ont évolué : Atlassian renomme progressivement « issue » en « work item » (« Work item key », « Work type »…), d'où la table d'alias §1.2.4.

| Colonne Cloud | Variante DC / ancienne | Contenu, format | Multi | Exemple |
|---|---|---|---|---|
| `Summary` | idem | Texte | | `Payer par carte` |
| `Issue key` | idem ; Cloud récent `Work item key` **[INCERTAIN]** | `PREFIX-N` | | `KB-2` |
| `Issue id` | idem ; `Work item id` **[INCERTAIN]** | Entier (stable même si l'issue change de projet) | | `10002` |
| `Issue Type` | idem ; `Work type` **[INCERTAIN]** | Nom du type | | `Story`, `Bug`, `Task`, `Epic`, `Sub-task`, `Subtask` |
| `Status` | idem | Nom du statut (workflow) | | `In Progress` |
| `Status Category` | absent en DC **[INCERTAIN]** | `To Do` / `In Progress` / `Done` (libellés parfois localisés) | | `Done` |
| `Status Category Changed` | absent en DC | Date-heure | | |
| `Project key`, `Project name`, `Project type`, `Project lead` | idem | Texte | | `KB` |
| `Priority` | idem | Cloud : `Highest/High/Medium/Low/Lowest` ; DC ancien : `Blocker/Critical/Major/Minor/Trivial` | | `High` |
| `Resolution` | idem | Nom ou vide (`Unresolved` possible) | | `Done` |
| `Assignee` | idem (DC : parfois le username **[INCERTAIN]**) | Nom affiché | | `Alice Durand` |
| `Assignee Id` | absent en DC | accountId Atlassian (`712020:uuid` ou 24 hex) | | `712020:1a2b…` |
| `Reporter`, `Reporter Id`, `Creator`, `Creator Id` | idem (sans `Id` en DC) | Comme Assignee | | |
| `Created`, `Updated`, `Last Viewed`, `Resolved` | idem | Date-heure au format d'instance (§1.2.6) | | `14/Sep/26 9:05 AM` |
| `Due date` | `Due Date` | Date seule | | `30/Sep/26` |
| `Affects versions` | `Affects Version/s` | Nom de version | **oui** | `0.9.0` |
| `Fix versions` | `Fix Version/s` | Nom de version | **oui** | `1.0.0` |
| `Components` | `Component/s` | Nom de composant | **oui** | `API` |
| `Labels` | idem | Libellé sans espace | **oui** | `paiement` |
| `Description` | idem | **Wiki markup** Jira (Cloud convertit l'ADF) **[INCERTAIN sur la fidélité]** | | `h3. Contexte` |
| `Environment` | idem | Wiki markup | | `Chrome 128` |
| `Original estimate` | `Original Estimate` | **Secondes** | | `28800` |
| `Remaining Estimate` | idem | **Secondes** | | `14400` |
| `Time Spent` | idem | **Secondes** | | `14400` |
| `Σ Original estimate`, `Σ Remaining Estimate`, `Σ Time Spent` | `Σ Original Estimate`… | Secondes, agrégat issue + sous-tâches | | `36000` |
| `Work Ratio` | idem | Pourcentage | | |
| `Sprint` | idem | **Nom du sprint** (pas d'id, pas d'état) | **oui** | `KB Sprint 2` |
| `Custom field (Story point estimate)` | (projets team-managed) | Nombre décimal | | `5` |
| `Custom field (Story Points)` | idem (company-managed, DC) | Nombre décimal | | `5` |
| `Parent` | Cloud : **Issue id numérique du parent** | Entier | | `10001` |
| `Parent summary` | Cloud | Texte (informatif) | | `Paiement en ligne` |
| `Parent id` | DC (sous-tâches) | Entier | | `10002` |
| `Custom field (Epic Link)` | DC et Cloud avant avril 2024 | **Clé** de l'epic | | `KB-1` |
| `Custom field (Epic Name)` | idem | Texte (sur l'epic) | | |
| `Custom field (Parent Link)` | Advanced Roadmaps DC | Clé | | |
| `Custom field (Flagged)` | idem | `Impediment` si l'issue est signalée **[INCERTAIN]** | | `Impediment` |
| `Comment` | idem | `date;auteur;texte` (§1.2.8) | **oui** | voir §1.2.8 |
| `Watchers` / `Watchers Id` | `Watchers` | Nom / accountId | **oui** | |
| `Attachment` | idem | `date;auteur;nom;url` **[INCERTAIN]** | **oui** | (ignoré) |
| `Inward issue link (Blocks)`, `Outward issue link (Blocks)`, `(Relates)`… | idem | Issue id ou clé de l'issue liée **[INCERTAIN]** | **oui** | |
| `Log Work` | idem | `commentaire;date;auteur;secondes` **[INCERTAIN]** | **oui** | (ignoré en V1) |
| `Votes`, `Security Level`, `Project url`… | idem | | | (ignorés) |

#### 1.2.4 Normalisation et alias des en-têtes

```js
// server/src/import/jira/csv/headers.js
function normalizeHeader(h) {
  let s = String(h).replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ');
  const cf = /^custom field \((.+)\)$/i.exec(s);
  if (cf) return 'cf:' + cf[1].trim().toLowerCase();
  s = s.replace(/^[Σσ]\s*/, 'sum:');
  return s.toLowerCase().replace(/ version\/s$/, ' versions').replace(/^component\/s$/, 'components');
}

// Nom canonique -> en-têtes normalisés acceptés (le premier trouvé gagne)
const ALIASES = {
  summary: ['summary'],
  key: ['issue key', 'work item key', 'key'],
  id: ['issue id', 'work item id', 'id'],
  type: ['issue type', 'work type', 'work item type', 'type'],
  status: ['status'],
  statusCategory: ['status category'],
  projectKey: ['project key'],
  projectName: ['project name'],
  priority: ['priority'],
  resolution: ['resolution'],
  assignee: ['assignee'], assigneeId: ['assignee id'],
  reporter: ['reporter'], reporterId: ['reporter id'],
  creator: ['creator'], creatorId: ['creator id'],
  created: ['created', 'date created'],
  updated: ['updated', 'date modified'],
  resolved: ['resolved', 'resolution date'],
  dueDate: ['due date'],
  affectsVersions: ['affects versions', 'affects version'],   // multi
  fixVersions: ['fix versions', 'fix version'],               // multi
  components: ['components', 'component'],                    // multi
  labels: ['labels', 'label'],                                // multi
  description: ['description'],
  environment: ['environment'],
  originalEstimate: ['original estimate'],
  remainingEstimate: ['remaining estimate'],
  timeSpent: ['time spent'],
  sprints: ['sprint', 'cf:sprint'],                           // multi
  storyPoints: ['cf:story points', 'story points'],
  storyPointEstimate: ['cf:story point estimate', 'story point estimate'],
  parent: ['parent', 'parent id'],
  parentKey: ['parent key'],
  parentSummary: ['parent summary'],
  epicLink: ['cf:epic link', 'epic link'],
  epicName: ['cf:epic name'],
  flagged: ['cf:flagged', 'flagged'],
  comments: ['comment', 'comment body'],                      // multi
  watchers: ['watchers'], watchersId: ['watchers id'],        // multi
};
const MULTI = new Set(['affectsVersions', 'fixVersions', 'components', 'labels', 'sprints', 'comments', 'watchers', 'watchersId']);
// Liens : /^(inward|outward) issue link \((.+)\)$/ -> { direction, linkType }
// Les colonnes 'sum:*' sont ignorées (les valeurs feuilles suffisent).
```

Construction de l'index : `headerIndex: Map<canonical, number[]>` (toutes les positions). Pour un champ simple, on prend la première valeur non vide ; pour un champ multi, toutes les valeurs non vides dédoublonnées dans l'ordre. Les en-têtes non reconnus sont listés dans l'aperçu (`unmappedColumns`) et `cf:*` peuvent être associés à `acceptance` ou `storyPoints` dans l'écran de mapping.

**Validation minimale** : `summary` et (`key` ou `id`) sont obligatoires, sinon erreur `CSV_NOT_JIRA`.

#### 1.2.5 « All fields » ou « Current fields »

- « Current fields » ne contient que les colonnes affichées dans le navigateur d'issues. Il manque souvent `Issue id`, `Status Category`, `Comment` et `Parent`. Le parseur applique les mêmes alias et signale les colonnes absentes (`MISSING_COLUMN_ISSUE_ID` : l'idempotence se fera sur la clé).
- Si un champ multi n'a qu'**une** colonne et que la cellule contient plusieurs valeurs séparées par des virgules **[INCERTAIN : comportement non documenté]** : pour `Labels` uniquement, découper sur `,` et les espaces (un label ne contient pas d'espace). Pour les versions, composants et sprints, **ne pas découper** (les noms peuvent contenir des virgules) et émettre l'avertissement `MULTI_VALUE_SINGLE_COLUMN`.

#### 1.2.6 Formats de date

Le format dépend de la configuration de l'instance (Cloud : *Système > Apparence > Formats de date/heure*, format Java `SimpleDateFormat`). Formats rencontrés :

| # | Motif | Exemple | Où |
|---|---|---|---|
| F1 | `dd/MMM/yy h:mm a` (mois anglais) | `14/Sep/26 9:05 AM` | Défaut Cloud et DC pour les dates-heures |
| F2 | `dd/MMM/yy` | `30/Sep/26` | `Due date`, dates seules |
| F3 | `yyyy-MM-dd HH:mm` ou `yyyy-MM-dd HH:mm:ss` | `2026-09-14 09:05` | Instances reconfigurées |
| F4 | `yyyy-MM-dd` | `2026-09-14` | Dates seules reconfigurées ; REST `duedate`, `releaseDate` |
| F5 | `dd/MM/yyyy HH:mm` ou `MM/dd/yyyy h:mm a` | `14/09/2026 09:05` | Instances reconfigurées (ambiguïté jour/mois) |
| F6 | Mois localisés `dd/MMM/yy` | `14/sept./26 09:05` **[INCERTAIN]** | Export avec langue utilisateur non anglaise |
| F7 | ISO 8601 avec décalage **sans deux-points** | `2026-09-14T09:05:12.345+0200` | REST v2/v3 (`created`, `updated`) |
| F8 | ISO 8601 UTC | `2026-08-24T07:00:00.000Z` | API Agile (sprints), sprints dans les issues |
| F9 | RFC 822 | `Mon, 14 Sep 2026 09:05:00 +0200` | XML |

Algorithme :
1. **Détection par fichier** : sur les 50 premières valeurs non vides de `Created`, tester F1, F3, F5, F6 ; le premier motif qui les accepte toutes devient `detected.dateFormat`. Pour F5, choisir `dd/MM` si une valeur a son premier nombre supérieur à 12, `MM/dd` si le second l'est, sinon demander dans le wizard (`options.dateFormat`).
2. **Le motif détecté est imposé à toute la colonne** et à `Updated`, `Resolved` et aux dates des commentaires (même motif). Les dates seules (`Due date`) utilisent la variante sans heure.
3. Les dates CSV **n'ont pas de fuseau** : elles sont interprétées dans `options.timezone` (défaut `Europe/Paris`, proposé depuis le navigateur). F7, F8 et F9 portent leur décalage.
4. Mois : `jan feb mar apr may jun jul aug sep oct nov dec`, plus le dictionnaire français `janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.` (comparaison sans point ni accent, sur les 3 premières lettres, avec `juin`/`juil` distingués).
5. Années à 2 chiffres : `+2000`. `12:xx AM` donne `00:xx` et `12:xx PM` donne `12:xx`.
6. Valeur non analysable : `null` et avertissement `DATE_UNPARSEABLE` (ligne, colonne, valeur). **Jamais d'erreur bloquante** pour une date.
7. `dueDate` est stockée à minuit UTC du jour indiqué (sémantique « date seule »).

```js
// server/src/import/jira/common/dates.js (extraits validés)
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseF1(s) { // "14/Sep/26 9:05 AM" | "30/Sep/26"
  const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?$/i.exec(s.trim());
  if (!m || MON[m[2].toLowerCase()] === undefined) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  let H = m[4] ? +m[4] : 0;
  if (m[6]) { H = H % 12; if (/pm/i.test(m[6])) H += 12; }
  return { y, mo: MON[m[2].toLowerCase()], d: +m[1], H, M: m[5] ? +m[5] : 0, dateOnly: !m[4] };
}
function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}
function zonedToUtc(y, mo, d, H, M, timeZone) { // gère l'heure d'été
  const guess = Date.UTC(y, mo, d, H, M);
  return new Date(guess - tzOffsetMs(guess - tzOffsetMs(guess, timeZone), timeZone));
}
// zonedToUtc(2026,6,1,10,0,'Europe/Paris') -> 2026-07-01T08:00:00.000Z
// F7 : normaliser "+0200" en "+02:00" avant new Date() (V8 accepte les deux, mais on ne dépend pas de ce comportement).
const isoFix = (s) => s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
```

#### 1.2.7 Estimations en secondes

- `Original estimate`, `Remaining Estimate`, `Time Spent` et leurs `Σ` sont exportés **en secondes** : c'est le stockage interne ; l'interface Jira les affiche en `w d h m`.
- La conversion jour/semaine utilise le réglage de suivi du temps de l'instance (défaut **8 h/jour, 5 j/semaine**) : « 3d 4h » donne `100800`. Kýdos expose `options.hoursPerDay` (défaut 8) et `options.daysPerWeek` (défaut 5).
- Mise au format Kýdos (cohérent avec l'existant `4h`, `1j`, `30min`) :

```js
function secondsToDuration(sec, hoursPerDay = 8) {
  if (!sec || sec <= 0) return '';
  let m = Math.round(sec / 60);
  const perDay = hoursPerDay * 60;
  const d = Math.floor(m / perDay); m -= d * perDay;
  const h = Math.floor(m / 60); m -= h * 60;
  return [d && `${d}j`, h && `${h}h`, m && `${m}min`].filter(Boolean).join(' ');
}
// 28800 -> "1j" ; 14400 -> "4h" ; 5400 -> "1h 30min" ; 36000 -> "1j 2h" ; 100800 -> "3j 4h" ; 900 -> "15min"
```

Les secondes brutes sont **aussi** stockées (`timeOriginalEstimateSec`, etc.) pour les calculs de capacité : le texte ne sert qu'à l'affichage.

#### 1.2.8 Commentaires

- Une colonne `Comment` par commentaire, en ordre chronologique.
- Format de cellule : **`<date>;<auteur>;<texte>`**, par exemple `31/Mar/24 6:49 AM;712020:1a2b…;Nouveau commentaire`.
  - Cloud : `<auteur>` est l'**accountId**. DC : le **username** **[INCERTAIN selon version]**.
  - La date suit le format de l'instance (§1.2.6).
- **Le texte peut contenir des `;`** : découper uniquement sur les **deux premiers** `;`.
- Une cellule sans deux `;`, ou dont la première partie n'est pas une date, est un commentaire sans métadonnées : `created = null`, auteur inconnu, texte intégral, avertissement `COMMENT_NO_META`.
- Le nom affiché de l'auteur n'est pas dans la cellule. On le résout avec un dictionnaire `accountId → displayName` construit à partir des paires (`Assignee`, `Assignee Id`), (`Reporter`, `Reporter Id`), (`Creator`, `Creator Id`) et (`Watchers`, `Watchers Id`, appariées par position) de **tout** le fichier.
- Le texte est en wiki markup : même conversion que la description (§1.2.9).

```js
function parseCommentCell(cell, parseDate) {
  const i1 = cell.indexOf(';'), i2 = i1 < 0 ? -1 : cell.indexOf(';', i1 + 1);
  if (i2 > 0) {
    const created = parseDate(cell.slice(0, i1));
    if (created) return { created, authorRef: cell.slice(i1 + 1, i2).trim(), body: cell.slice(i2 + 1) };
  }
  return { created: null, authorRef: null, body: cell, warning: 'COMMENT_NO_META' };
}
```

#### 1.2.9 Description (wiki markup vers texte)

Kýdos affiche la description en texte brut : on produit un **texte lisible en Markdown léger**. Conversion minimale (validée) :

| Wiki Jira | Sortie |
|---|---|
| `h1.` … `h6.` | `#` … `######` |
| `* item`, `** sous-item`, `- item` | `- item` (indentation de 2 espaces par niveau) |
| `# item` | `1. item` |
| `*gras*` | `**gras**` |
| `{{code}}` | `` `code` `` |
| `{code:js}…{code}`, `{noformat}…{noformat}` | bloc ```` ``` ```` (contenu protégé de toute autre règle) |
| `[texte\|url]` | `[texte](url)` |
| `[~accountid:xxx]` | `@<displayName résolu ou xxx>` |
| `{color}`, `{panel}`, `{quote}` | supprimés (contenu conservé) |
| `!image.png!` | `[pièce jointe non importée]` |

```js
function wikiToText(s) {
  if (!s) return '';
  const blocks = [];
  const keep = (txt) => `@@CODE${blocks.push(txt) - 1}@@`;
  let out = s.replace(/\r\n/g, '\n')
    .replace(/\{code(?::([a-z0-9]+))?[^}]*\}([\s\S]*?)\{code\}/gi, (_, l, c) => keep('```' + (l || '') + '\n' + c.trim() + '\n```'))
    .replace(/\{noformat\}([\s\S]*?)\{noformat\}/gi, (_, c) => keep('```\n' + c.trim() + '\n```'))
    .replace(/^[ \t]*([*#-]+)[ \t]+/gm, (_, b) => '  '.repeat(b.length - 1) + (b.endsWith('#') ? '1. ' : '- '))
    .replace(/^h([1-6])\.[ \t]*/gm, (_, n) => '#'.repeat(+n) + ' ')
    .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=[\s).,;:!?]|$)/gm, '$1**$2**')
    .replace(/\{\{([^}]+)\}\}/g, '`$1`')
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '[$1]($2)')
    .replace(/![^!\n]+!/g, '[pièce jointe non importée]')
    .replace(/\{color[^}]*\}|\{panel[^}]*\}|\{quote\}/gi, '');
  return out.replace(/@@CODE(\d+)@@/g, (_, i) => blocks[+i]).trim();
}
```

Option `extractAcceptanceFromDescription` (défaut **activée**) : si la description contient un titre `Acceptance Criteria`, `Critères d'acceptation` ou `AC` (insensible à la casse, `#` à `######` après conversion), les puces qui le suivent jusqu'au titre suivant alimentent `acceptance[]` et la section est retirée de `description`.

#### 1.2.10 Pièges CSV connus

1. En-têtes dupliqués (D3).
2. Sauts de ligne dans les cellules.
3. Sprint en **nom seul**, sans id, état ni dates (demande JRASERVER-65781 non résolue) : les états sont déduits par heuristique (§2.4.3) et les dates sont à compléter.
4. Estimations en secondes et 8 h/jour.
5. Format de date dépendant de l'instance ; Excel et Google Sheets peuvent ré-écrire les dates de façon incohérente (JRACLOUD-67150) : recommander **de ne pas ouvrir puis ré-enregistrer** le CSV dans un tableur.
6. `Parent` contient un **Issue id** (Cloud) mais `Epic Link` contient une **clé** (DC) : tester `/^\d+$/` contre `/^[A-Z][A-Z0-9_]*-\d+$/`.
7. `Story Points` et `Story point estimate` coexistent selon le type de projet (company-managed / team-managed).
8. Emails absents du CSV : le rapprochement des utilisateurs se fait sur le nom affiché ou l'accountId mémorisé.
9. Troncature silencieuse (1 000 en DC, 10 000 en Cloud).

### 1.3 Export JSON (API REST)

#### 1.3.1 Endpoints

| Besoin | Endpoint Cloud | Remarques |
|---|---|---|
| Issues | `GET /rest/api/3/search/jql?jql=project=KB ORDER BY key ASC&fields=*all&expand=names,changelog&maxResults=100&nextPageToken=…` | Réponse `{ issues[], nextPageToken?, isLast }`. Pagination **par jeton** : il n'y a plus de `startAt` ni de `total`. |
| Issues (ancien) | `GET/POST /rest/api/3/search` et `/rest/api/2/search` | **Retiré de Jira Cloud** (répond 410 Gone depuis la dépréciation de 2025). Kýdos accepte quand même les **fichiers** produits avant cette date : même tableau `issues[]`, avec `startAt`, `maxResults` et `total`. |
| Issues (DC) | `GET /rest/api/2/search?jql=…&fields=*all&expand=names,changelog&startAt=0&maxResults=100` | Description en **wiki markup** (chaîne) et non en ADF. |
| Sprints d'un board | `GET /rest/agile/1.0/board/{boardId}/sprint?startAt=0&maxResults=50` | `{ maxResults, startAt, isLast, values[] }`. Paramètre `state=future,active,closed` possible. Peut ne pas lister les sprints d'autres boards : consolider par id. |
| Versions d'un projet | `GET /rest/api/3/project/{projectIdOrKey}/versions` | Tableau **non paginé**. Variante paginée : `/project/{key}/version` renvoie `{ values[] }`. |
| Champs | `GET /rest/api/3/field` | `[{ id, name, custom, schema: { type, custom, customId } }]` : utile pour identifier `Sprint` et `Story Points`. |
| Changelog complet | `GET /rest/api/3/issue/{key}/changelog` | `expand=changelog` dans la recherche peut être tronqué (environ 100 entrées) **[INCERTAIN sur la limite exacte]**. |

Signalé par la communauté : bugs de pagination de `search/jql` (`nextPageToken` qui ne change pas). Le script client (§1.3.7) arrête la boucle si un jeton se répète.

#### 1.3.2 Structure d'une issue (champs utiles)

```jsonc
{
  "id": "10002",                       // -> externalId
  "key": "KB-2",                       // -> externalKey
  "self": "https://site.atlassian.net/rest/api/3/issue/10002",  // base de externalUrl = <site>/browse/<key>
  "changelog": { "histories": [ { "id": "1", "author": { "accountId": "…", "displayName": "…" }, "created": "2026-09-07T09:00:00.000+0200",
                                  "items": [ { "field": "status", "fieldtype": "jira", "fieldId": "status", "from": "10001", "fromString": "To Do", "to": "3", "toString": "In Progress" } ] } ] },
  "fields": {
    "summary": "Payer par carte",
    "issuetype": { "id": "10001", "name": "Story", "subtask": false, "hierarchyLevel": 0 },   // Epic = 1, Sub-task = -1
    "project":   { "id": "10000", "key": "KB", "name": "Kýdos Boutique" },
    "status":    { "id": "3", "name": "In Progress", "statusCategory": { "id": 4, "key": "indeterminate", "name": "In Progress" } }, // key: new | indeterminate | done
    "priority":  { "id": "3", "name": "Medium" },
    "resolution": null, "resolutiondate": null,                        // ou { "name": "Done" }, "2026-09-03T14:31:00.000+0200"
    "assignee":  { "accountId": "712020:…", "displayName": "Alice Durand", "emailAddress": "alice@…", "active": true }, // emailAddress souvent ABSENT (confidentialité)
    "reporter":  { "…": "idem" }, "creator": { "…": "idem" },
    "created": "2026-07-02T11:30:00.000+0200", "updated": "2026-09-12T09:41:00.000+0200",
    "duedate": "2026-09-30",                                            // date seule ou null
    "versions":    [ { "id": "10099", "name": "0.9.0", "released": true, "releaseDate": "2026-07-15", "archived": false } ], // Affects versions
    "fixVersions": [ { "id": "10100", "name": "1.0.0", "released": false, "releaseDate": "2026-09-30", "archived": false } ],
    "components":  [ { "id": "10200", "name": "API" } ],
    "labels": [ "paiement", "front" ],
    "parent": { "id": "10001", "key": "KB-1", "fields": { "summary": "…", "issuetype": { "name": "Epic", "hierarchyLevel": 1 } } },
    "description": { "type": "doc", "version": 1, "content": [ /* ADF (v3) ; chaîne wiki en v2/DC */ ] },
    "environment": null,
    "timeoriginalestimate": 28800, "timeestimate": 14400, "timespent": 14400,   // secondes ; timeestimate = remaining
    "aggregatetimeoriginalestimate": 36000,
    "timetracking": { "originalEstimate": "1d", "originalEstimateSeconds": 28800 },  // présent selon les champs demandés
    "subtasks": [ { "id": "10004", "key": "KB-4" } ],
    "issuelinks": [ { "type": { "name": "Blocks", "inward": "is blocked by", "outward": "blocks" }, "outwardIssue": { "key": "KB-9" } } ],
    "customfield_10020": [ { "id": 2, "name": "KB Sprint 2", "state": "active", "boardId": 1, "goal": "…", "startDate": "2026-09-07T07:00:00.000Z", "endDate": "2026-09-18T15:00:00.000Z" } ],
    "customfield_10016": 5,                                                // Story point estimate (id variable)
    "comment": { "comments": [ { "id": "20001", "author": { "accountId": "…", "displayName": "…" }, "created": "…", "updated": "…", "body": { "type": "doc" } } ],
                 "total": 2, "maxResults": 2, "startAt": 0 }
  }
}
```

Si `comment.total > comment.comments.length`, émettre l'avertissement `COMMENTS_TRUNCATED` (il faut exporter `/rest/api/3/issue/{key}/comment`).

#### 1.3.3 Détection des champs personnalisés (identifiants variables)

`customfield_10020` (Sprint) et `customfield_10016` (Story point estimate) sont **fréquents sur Cloud mais pas garantis**, et différents en DC. Ordre de résolution :
1. Map `names` (présente si `expand=names`) : `{ "customfield_10020": "Sprint", … }`. Rechercher les noms `Sprint`, `Story Points`, `Story point estimate`, `Flagged`, `Epic Link`, `Acceptance Criteria` / `Critères d'acceptation` (insensible à la casse).
2. À défaut, **forme de la valeur** : un tableau d'objets ayant `state` ∈ {`future`,`active`,`closed`} et `name` est un sprint. Un tableau de chaînes `com.atlassian.greenhopper.service.sprint.Sprint@…[id=…,state=CLOSED,name=…]` est un sprint au format ancien (DC/Server), à analyser avec l'expression ci-dessous.
3. À défaut pour les story points : proposer dans le wizard les `customfield_*` numériques à valeurs dans l'échelle 0–100 (choix manuel obligatoire).

```js
// Format toString historique (DC / Cloud avant 2020)
function parseLegacySprint(s) {
  const body = /\[(.*)\]$/.exec(s)?.[1] || '';
  const get = (k) => new RegExp(`(?:^|,)${k}=([^,]*)`).exec(body)?.[1];
  const nameM = /(?:^|,)name=(.*?),(?:startDate|endDate|completeDate|activatedDate|sequence|goal)=/.exec(body); // un nom peut contenir des virgules
  const val = (v) => (v && v !== '<null>' ? v : null);
  return { jiraId: +get('id'), state: (get('state') || '').toLowerCase() || null, name: nameM ? nameM[1] : get('name'),
           startDate: val(get('startDate')), endDate: val(get('endDate')), completeDate: val(get('completeDate')), goal: val(get('goal')) };
}
```

#### 1.3.4 Sprints et versions (fichiers complémentaires)

Réponse de `GET /rest/agile/1.0/board/{boardId}/sprint` :

```json
{ "maxResults": 50, "startAt": 0, "isLast": true,
  "values": [ { "id": 1, "self": "…/rest/agile/1.0/sprint/1", "state": "closed", "name": "KB Sprint 1",
                "startDate": "2026-08-24T07:00:00.000Z", "endDate": "2026-09-04T15:00:00.000Z",
                "completeDate": "2026-09-04T15:10:00.000Z", "createdDate": "2026-08-20T09:00:00.000Z",
                "originBoardId": 1, "goal": "Paiement carte de bout en bout" } ] }
```

- `endDate` = date de fin **prévue** au démarrage ; `completeDate` = date de clôture réelle (sprints `closed` uniquement).
- Un sprint `future` peut avoir des dates planifiées, ou aucune.
- Dans une issue, l'objet sprint porte `boardId` ; dans l'API Agile, il porte `originBoardId`.

Réponse de `GET /rest/api/3/project/{key}/versions` :

```json
[ { "self": "…/rest/api/3/version/10100", "id": "10100", "name": "1.0.0", "description": "Lancement public",
    "archived": false, "released": false, "startDate": "2026-08-24", "releaseDate": "2026-09-30", "overdue": false,
    "userStartDate": "24/Aug/26", "userReleaseDate": "30/Sep/26", "projectId": 10000 } ]
```

Lorsqu'un fichier complémentaire est fourni, ses données **priment** sur celles embarquées dans les issues : elles sont plus complètes et contiennent les sprints et versions sans issue.

#### 1.3.5 ADF (Atlassian Document Format) vers texte

Conversion récursive (validée sur la fixture) :

| Nœud ADF | Sortie |
|---|---|
| `doc` | Blocs séparés par une ligne vide |
| `paragraph` | Texte des enfants |
| `heading` (`attrs.level`) | `#` × niveau + espace |
| `text` + marks `strong` / `em` / `code` / `strike` / `link` | `**t**` / `_t_` / `` `t` `` / `~~t~~` / `[t](href)` |
| `hardBreak` | `\n` |
| `bulletList` / `orderedList` > `listItem` | `- ` / `n. ` (indentation des lignes de continuation) |
| `codeBlock` (`attrs.language`) | bloc ```` ``` ```` |
| `blockquote`, `panel` | lignes préfixées par `> ` |
| `rule` | `---` |
| `mention` (`attrs.text`) | `@Nom` |
| `emoji` (`attrs.text` ou `shortName`) | texte |
| `inlineCard`, `blockCard` (`attrs.url`) | URL |
| `status` (`attrs.text`) | `[TEXTE]` |
| `date` (`attrs.timestamp` en ms) | `YYYY-MM-DD` |
| `media`, `mediaSingle`, `mediaGroup` | `[pièce jointe non importée]` |
| `table` > `tableRow` > `tableCell` / `tableHeader` | `\| a \| b \|` par ligne |
| Nœud inconnu | Texte des enfants (jamais d'erreur) |

```js
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node; // v2 / DC : wiki markup -> passer ensuite par wikiToText
  const kids = (n, sep = '') => (n.content || []).map((c) => adfToText(c)).join(sep);
  switch (node.type) {
    case 'doc': return kids(node, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
    case 'paragraph': return kids(node);
    case 'heading': return '#'.repeat(node.attrs?.level || 1) + ' ' + kids(node);
    case 'text': {
      let t = node.text || '';
      for (const m of node.marks || []) {
        if (m.type === 'strong') t = `**${t}**`;
        else if (m.type === 'em') t = `_${t}_`;
        else if (m.type === 'code') t = '`' + t + '`';
        else if (m.type === 'strike') t = `~~${t}~~`;
        else if (m.type === 'link') t = `[${t}](${m.attrs?.href})`;
      }
      return t;
    }
    case 'hardBreak': return '\n';
    case 'bulletList': return (node.content || []).map((li) => '- ' + adfToText(li).replace(/\n/g, '\n  ')).join('\n');
    case 'orderedList': return (node.content || []).map((li, i) => `${(node.attrs?.order || 1) + i}. ` + adfToText(li).replace(/\n/g, '\n   ')).join('\n');
    case 'listItem': return kids(node, '\n');
    case 'codeBlock': return '```' + (node.attrs?.language || '') + '\n' + kids(node) + '\n```';
    case 'blockquote': case 'panel': return kids(node, '\n\n').split('\n').map((l) => '> ' + l).join('\n');
    case 'rule': return '---';
    case 'mention': return '@' + (node.attrs?.text || '').replace(/^@/, '');
    case 'emoji': return node.attrs?.text || node.attrs?.shortName || '';
    case 'inlineCard': case 'blockCard': return node.attrs?.url || '';
    case 'status': return `[${node.attrs?.text || ''}]`;
    case 'date': return node.attrs?.timestamp ? new Date(+node.attrs.timestamp).toISOString().slice(0, 10) : '';
    case 'mediaSingle': case 'mediaGroup': case 'media': return '[pièce jointe non importée]';
    case 'table': return (node.content || []).map((row) => '| ' + (row.content || [])
      .map((cell) => adfToText({ type: 'doc', content: cell.content }).replace(/\n+/g, ' ')).join(' | ') + ' |').join('\n');
    default: return kids(node);
  }
}
```

Note : ADF et wiki ne produisent pas exactement les mêmes blancs (lignes vides entre blocs). Les tests et les empreintes de commentaires comparent donc un **texte normalisé** : suppression de `*_\`~#>` et des puces `- `, espaces compactés, minuscules.

#### 1.3.6 Enveloppe acceptée par Kýdos

Le client envoie **1 à 5 fichiers** dans un même import. Chaque fichier est détecté indépendamment (§1.5) :
- un fichier d'issues **obligatoire** : CSV **ou** JSON (plusieurs pages JSON acceptées : fichiers multiples ou tableau de pages `[{ issues }, { issues }]`) ;
- 0 à n fichiers de sprints (un par board) ;
- 0 ou 1 fichier de versions.

#### 1.3.7 Script d'export fourni aux utilisateurs

À publier dans l'aide du wizard (Node 18+, jeton API Atlassian) :

```js
// export-jira.mjs  —  node export-jira.mjs https://site.atlassian.net KB 1 email@x.com $JIRA_TOKEN
import { writeFile } from 'node:fs/promises';
const [site, projectKey, boardId, email, token] = process.argv.slice(2);
const headers = { Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'), Accept: 'application/json' };
const get = async (path) => { const r = await fetch(site + path, { headers }); if (!r.ok) throw new Error(`${r.status} ${path}`); return r.json(); };

const pages = []; let token_ = null; const seen = new Set();
do {
  const q = new URLSearchParams({ jql: `project=${projectKey} ORDER BY key ASC`, fields: '*all', expand: 'names,changelog', maxResults: '100' });
  if (token_) q.set('nextPageToken', token_);
  const page = await get(`/rest/api/3/search/jql?${q}`);
  pages.push(page);
  token_ = page.isLast ? null : page.nextPageToken;
  if (token_ && seen.has(token_)) break; seen.add(token_);
} while (token_);
await writeFile(`${projectKey}-issues.json`, JSON.stringify(pages));

const sprints = []; let startAt = 0, last = false;
while (!last) { const p = await get(`/rest/agile/1.0/board/${boardId}/sprint?startAt=${startAt}&maxResults=50`); sprints.push(...p.values); last = p.isLast; startAt += p.values.length; }
await writeFile(`${projectKey}-sprints.json`, JSON.stringify({ isLast: true, values: sprints }));
await writeFile(`${projectKey}-versions.json`, JSON.stringify(await get(`/rest/api/3/project/${projectKey}/versions`)));
```

### 1.4 Export XML (RSS « Export XML »)

Obtention : navigateur d'issues, **Export > XML**, soit `/sr/jira.issueviews:searchrequest-xml/temp/SearchRequest.xml?jqlQuery=…&tempMax=1000`. Il est possible de restreindre les champs avec `&field=key&field=summary`.

Structure minimale utile (**[INCERTAIN]** : noms d'éléments et d'attributs reconstitués à partir de la documentation partielle et de la pratique, à vérifier sur un export réel) :

```xml
<rss version="0.92">
  <channel>
    <issue start="0" end="6" total="6"/>
    <item>
      <title>[KB-2] Payer par carte</title>
      <project id="10000" key="KB">Kýdos Boutique</project>
      <description>&lt;p&gt;HTML rendu&lt;/p&gt;</description>
      <key id="10002">KB-2</key>
      <summary>Payer par carte</summary>
      <type id="10001">Story</type>
      <parent id="10001">KB-1</parent>
      <priority id="3">Medium</priority>
      <status id="3"><statusCategory id="4" key="indeterminate" colorName="yellow"/>In Progress</status>
      <resolution id="-1">Unresolved</resolution>
      <assignee accountid="712020:…">Alice Durand</assignee>
      <reporter accountid="5f8a…">Carole Martin</reporter>
      <labels><label>paiement</label><label>front</label></labels>
      <created>Thu, 2 Jul 2026 11:30:00 +0200</created>
      <updated>Sat, 12 Sep 2026 09:41:00 +0200</updated>
      <version>0.9.0</version>
      <fixVersion>1.0.0</fixVersion><fixVersion>1.1.0</fixVersion>
      <component>API</component>
      <due/>
      <timeoriginalestimate seconds="28800">1 day</timeoriginalestimate>
      <timeestimate seconds="14400">4 hours</timeestimate>
      <timespent seconds="14400">4 hours</timespent>
      <comments><comment id="20001" author="712020:…" created="Tue, 25 Aug 2026 09:05:00 +0200">&lt;p&gt;…&lt;/p&gt;</comment></comments>
      <subtasks><subtask id="10004">KB-4</subtask></subtasks>
      <customfields>
        <customfield id="customfield_10020" key="com.pyxis.greenhopper.jira:gh-sprint">
          <customfieldname>Sprint</customfieldname>
          <customfieldvalues><customfieldvalue key="1">KB Sprint 1</customfieldvalue><customfieldvalue key="2">KB Sprint 2</customfieldvalue></customfieldvalues>
        </customfield>
      </customfields>
    </item>
  </channel>
</rss>
```

**Recommandation : ne pas supporter le XML en V1.**
- Il n'apporte rien par rapport au couple CSV + JSON : sprints en nom (au mieux avec id), sans état ni dates, versions sans `released`.
- Il impose un parseur XML (nouvelle dépendance ou parseur maison fragile) et une conversion HTML vers texte supplémentaire.
- Export plafonné (`tempMax`), et historiquement instable sur certains navigateurs (JRASERVER-71512).
- Détection : si le fichier commence par `<?xml` ou `<rss`, répondre `400 UNSUPPORTED_FORMAT` avec le message « Export XML non supporté : utilisez “CSV (All fields)” ou l'export JSON ».
- À réévaluer seulement si une instance DC a le CSV désactivé et aucun accès API.

### 1.5 Détection automatique du format

Pour chaque fichier (`name`, `content` sous forme de chaîne) :

```text
1. t = content sans BOM, trimStart
2. si t commence par '<?xml' ou '<rss'                  -> 'jira-xml' (non supporté)
3. si t commence par '{' ou '[' et JSON.parse réussit :
     a. objet avec issues[] dont issues[0] a key et fields      -> 'jira-issues-json'
     b. tableau dont chaque élément vérifie (a)                   -> 'jira-issues-json' (pages)
     c. objet avec values[] dont values[0] a name et state ∈ {future,active,closed} -> 'jira-sprints-json'
     d. tableau (ou {values[]}) dont [0] a name et released booléen -> 'jira-versions-json'
     e. sinon                                                      -> 400 JSON_UNKNOWN_SHAPE
4. sinon CSV : délimiteur = max(',', ';', '\t') hors guillemets sur la 1re ligne ;
     en-têtes normalisés contenant summary ET (key OU id)          -> 'jira-csv'
     variante : 'cloud' si 'assignee id' ou 'status category' ou 'parent summary' présent ;
                'datacenter' si 'fix version/s' ou 'component/s' bruts présents ; sinon 'unknown'
5. sinon -> 400 UNRECOGNIZED_FILE
```

Contraintes : exactement **un** type de fichier d'issues (CSV **ou** JSON, pas les deux), sinon `400 MIXED_ISSUE_SOURCES`. Un fichier XML ou inconnu fait échouer toute la prévisualisation.

---

## 2. Mapping Jira vers Kýdos

### 2.1 Évolutions du modèle de données

Toutes les évolutions sont **additives** : valeurs par défaut neutres, aucune migration obligatoire des données existantes.

#### 2.1.1 `Task`

```js
// Traçabilité / idempotence
source:      { type: String, enum: ['kydos', 'jira'], default: 'kydos' },
externalKey: { type: String, trim: true },            // "KB-2" (clé Jira d'origine)
externalId:  { type: String, trim: true },            // "10002" (Issue id, stable)
externalUrl: { type: String, trim: true },            // "https://site.atlassian.net/browse/KB-2"
importMeta: {
  jobId:        { type: Schema.Types.ObjectId, ref: 'ImportJob' },
  importedAt:   Date,                                  // premier import
  lastSyncedAt: Date,                                  // dernier import ayant touché la tâche
  hash:         String,                                // sha1 de la projection mappée (§2.11)
  snapshot:     Schema.Types.Mixed,                    // valeurs mappées du dernier import (fusion 3 voies)
},

// Hiérarchie
parent:            { type: String, default: null },    // taskId du parent direct (même projet)
epic:              { type: String, default: null },    // taskId de l'epic ancêtre (dénormalisé)
parentExternalKey: { type: String, default: null },    // parent Jira non résolu

// Multi-valeurs
labels:          { type: [String], default: [] },      // libres, dédoublonnés, sensibles à la casse
components:      { type: [String], default: [] },      // clés Taxonomy kind=component
fixVersions:     { type: [String], default: [] },      // clés Taxonomy kind=version ; `version` = principale (§2.5)
affectsVersions: { type: [String], default: [] },
sprintHistory:   { type: [String], default: [] },      // clés sprint parcourues, ordre chronologique
carryOverCount:  { type: Number, default: 0 },         // nb de sprints clos non terminés

// Dates, temps
dueDate:                 { type: Date, default: null },
resolvedAt:              { type: Date, default: null },
resolution:              { type: String, trim: true },
timeOriginalEstimateSec: { type: Number, default: null },
timeRemainingSec:        { type: Number, default: null },
timeSpentSec:            { type: Number, default: null },

// Personnes non rapprochées
externalAssignee: { accountId: String, displayName: String, email: String },
externalReporter: { accountId: String, displayName: String, email: String },

// Scrum (§6)
blocked:       { type: Boolean, default: false },
blockedReason: { type: String, trim: true },
blockedAt:     { type: Date, default: null },
```

Index :

```js
taskSchema.index({ project: 1, source: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });
taskSchema.index({ project: 1, externalKey: 1 });
taskSchema.index({ project: 1, parent: 1 });
taskSchema.index({ project: 1, epic: 1 });
taskSchema.index({ project: 1, labels: 1 });
taskSchema.index({ project: 1, sprintHistory: 1 });
```

Autres changements `Task` :
- `commentSchema` : `author` passe à `required: false`. Ajouts : `authorLabel: String`, `externalAuthor: { accountId, displayName, email }`, `externalId: String` (id du commentaire Jira, sinon empreinte `fp:<sha1>`) et `source: String`. **Impact client** : afficher `authorLabel` quand `author` est `null`.
- `historySchema` : ajout de `source: String` (`'jira'` pour les entrées issues du changelog).
- `TRACKED_FIELDS` : ajouter `parent`, `fixVersions`, `labels`, `components`, `dueDate` et `blocked`. `valuesEqual` doit comparer les tableaux **triés** (sauf `sprintHistory`, qui n'est pas suivi).
- `GET /tasks/:taskId` : si aucune tâche ne correspond, rechercher `externalKey === :taskId` et répondre `{ task, redirectedFrom }` pour que les liens Jira collés restent valides.
- Filtres de `GET /tasks` : ajouter `labels`, `components`, `parent`, `epic`, `fixVersions`.

#### 2.1.2 `Taxonomy`

- `KINDS` : ajouter `'component'`.
- Conventions de `meta` par kind (extensions en **gras**) :

| kind | meta |
|---|---|
| status | `isDone`, **`category: 'new'\|'indeterminate'\|'done'`**, **`jiraName`**, **`jiraId`**, **`isBlocked`** |
| priority | **`jiraName`**, **`jiraId`** |
| type | **`isEpic`**, **`isSubtask`**, **`hierarchyLevel`** (1 epic, 0 standard, -1 sous-tâche), **`jiraName`** |
| sprint | `status`, `startDate`, `endDate`, `goal`, `linkedVersion`, **`completeDate`**, **`jiraId`**, **`jiraBoardId`**, **`source`**, **`stateSource: 'jira'\|'heuristic'\|'manual'`**, **`capacity`**, **`startedAt`**, **`startedBy`**, **`closedAt`**, **`closedBy`**, **`excludeFromVelocity`** |
| version | **`released`**, **`releaseDate`**, **`startDate`**, **`archived`**, **`jiraId`** (le champ `description` de la taxonomie reçoit la description Jira) |
| component | **`jiraId`** |

- Proposition complémentaire : ajouter `meta.category` aux statuts par défaut de `DEFAULT_TAXONOMIES` (`draft` et `pending` = `new` ; `onprocess`, `tested` et `needconfirmation` = `indeterminate` ; `finished` et `confirmed` = `done`). Les alertes (§6.9) en ont besoin.

#### 2.1.3 `User`

```js
externalAccounts: [{
  source:      { type: String, enum: ['jira'], required: true },
  site:        String,           // "site.atlassian.net" si connu, sinon null
  accountId:   String,           // accountId Cloud ou username DC
  displayName: String,
  email:       String,
  linkedAt:    Date,
}],
```

Index `{ 'externalAccounts.source': 1, 'externalAccounts.accountId': 1 }`. La correspondance est mémorisée après chaque import validé (option `rememberMapping`, activée par défaut).

#### 2.1.4 `Project`

```js
timezone:       { type: String, default: 'Europe/Paris' },
workingDays:    { type: [Number], default: [1, 2, 3, 4, 5] },   // 0 = dimanche
holidays:       { type: [Date], default: [] },
hoursPerDay:    { type: Number, default: 8 },
velocityWindow: { type: Number, default: 3 },
importMappings: {
  jira: {
    site:       String,
    statuses:   Schema.Types.Mixed,   // { "In Progress": "onprocess", … }
    priorities: Schema.Types.Mixed,
    types:      Schema.Types.Mixed,
    fields:     Schema.Types.Mixed,   // { storyPoints: "cf:story point estimate", acceptance: null }
    options:    Schema.Types.Mixed,   // dernières options utilisées
  },
},
// §6 : definitionOfDone, definitionOfReady, readyRules, dodEnforcement, dorEnforcement, wipLimit, staleDays, alertThresholds
```

#### 2.1.5 `ImportJob` (nouveau)

```js
const importJobSchema = new Schema({
  project:    { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  source:     { type: String, enum: ['jira'], default: 'jira' },
  status:     { type: String, enum: ['running', 'completed', 'partial', 'failed', 'rolledBack'], default: 'running' },
  startedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  startedAt:  Date, finishedAt: Date,
  files:      [{ name: String, format: String, variant: String, size: Number, sha1: String, rows: Number }],
  options:    Schema.Types.Mixed,
  mapping:    Schema.Types.Mixed,
  counts:     { created: Number, updated: Number, unchanged: Number, skipped: Number, errors: Number, conflicts: Number, warnings: Number },
  taxonomiesCreated: [{ kind: String, key: String, id: Schema.Types.ObjectId }],
  usersCreated:      [Schema.Types.ObjectId],
  rows: [{ row: Number, externalKey: String, externalId: String, action: String, taskId: String,
           changes: [String], conflicts: Schema.Types.Mixed, warnings: [String], errors: [String] }],
  undo: [{ taskId: String, action: { type: String, enum: ['created', 'updated'] }, before: Schema.Types.Mixed }],
}, { timestamps: true });
importJobSchema.index({ project: 1, status: 1 });
```

Taille : pour 10 000 lignes, `rows` et `undo` restent sous la limite de 16 Mo par document tant que `before` ne contient que les champs modifiés. Au-delà de 5 000 lignes, stocker `rows` dans une collection `ImportJobRow` **[décision d'implémentation]**.

### 2.2 Tableau de mapping champ par champ

| Jira CSV (canonique §1.2.4) | Jira JSON (`fields.*`) | Kýdos | Règle |
|---|---|---|---|
| `key` | `key` | `externalKey`, `taskId` | §3 |
| `id` | `id` | `externalId` | Chaîne. Absent (current fields) : `null`, avertissement |
| (base du site, option) | `self` (origine) | `externalUrl` | `${site}/browse/${key}` si le site est connu |
| `summary` | `summary` | `title` | trim ; vide : **erreur de ligne** `MISSING_SUMMARY` |
| `description` (wiki) | `description` (ADF v3 / wiki v2) | `description`, `acceptance[]` | §1.2.9 / §1.3.5 ; extraction des critères d'acceptation |
| `environment` | `environment` | `description` (suffixe) | Ajout de `\n\nEnvironnement : <texte>` si non vide |
| `type` | `issuetype.name` (+ `subtask`, `hierarchyLevel`) | `type` | §2.3.3 |
| `status` + `statusCategory` | `status.name` + `status.statusCategory.key` | `status` | §2.3.1 |
| `priority` | `priority.name` | `priority` | §2.3.2 ; vide : `null` |
| `resolution` | `resolution.name` | `resolution` | `Unresolved`, `Non résolu` ou vide : `null` |
| `resolved` | `resolutiondate` | `resolvedAt` | Date |
| `created` / `updated` | `created` / `updated` | `createdAt` / `updatedAt` | Écriture avec `timestamps: false` (comme `seed.js`) |
| `dueDate` | `duedate` | `dueDate` | Minuit UTC |
| `assignee` + `assigneeId` | `assignee{accountId,displayName,emailAddress}` | `assignee` ou `externalAssignee` | §2.7 |
| `reporter` + `reporterId` | `reporter` | `reporter` ou `externalReporter` | §2.7 ; si absent : utilisateur qui importe, avec `externalReporter` vide |
| `sprints[]` (noms) | `customfield_<sprint>[]` | `sprint`, `sprintHistory[]`, `carryOverCount`, taxonomies `sprint` | §2.4 |
| `fixVersions[]` | `fixVersions[]` | `fixVersions[]`, `version`, taxonomies `version` | §2.5 |
| `affectsVersions[]` | `versions[]` | `affectsVersions[]`, taxonomies `version` | Création des versions manquantes |
| `components[]` | `components[].name` | `components[]` (+ `area` en option) | Taxonomie `component` : `key = slug(name)`, `label = name` ; option `componentToArea` : premier composant vers `area` (taxonomie `area` créée si besoin) |
| `labels[]` | `labels[]` | `labels[]` | Brut, dédoublonné. Option `labelsToTechno` : un label égal (sans casse) à une clé `techno` ou `category` existante alimente aussi ce champ |
| `storyPoints` / `storyPointEstimate` / colonne choisie | `customfield_<sp>` | `complexity` | §2.8 |
| `originalEstimate` | `timeoriginalestimate` | `estimate` (texte) + `timeOriginalEstimateSec` | §1.2.7 |
| `timeSpent` | `timespent` | `duration` (texte) + `timeSpentSec` | Kýdos `duration` = durée réelle passée |
| `remainingEstimate` | `timeestimate` | `timeRemainingSec` | Pas d'équivalent texte |
| `parent` / `parentKey` / `epicLink` | `parent.{id,key}` | `parent`, `epic`, `parentExternalKey` | §2.6 |
| `comments[]` | `comment.comments[]` | `comments[]` | §2.9 |
| `flagged` = `Impediment` | `customfield_<flagged>` non vide | `blocked: true`, `blockedReason: 'Signalé dans Jira'` | `blockedAt = updated` |
| liens `Blocks` | `issuelinks[]` | (P3 : `links[]`) | V1 : ignoré, compté dans le rapport |
| `watchers[]` | `watches` | (ignoré) | Compté dans le rapport |
| `Attachment` | `attachment[]` | (ignoré) | Avertissement `ATTACHMENTS_SKIPPED` (nombre) |
| `Log Work` | `worklog` | (ignoré) | `timeSpentSec` suffit en V1 |
| (aucun) | `changelog.histories[]` | `history[]` | Option `importChangelog` (§2.10) |
| `projectKey` | `project.key` | contrôle | Plusieurs projets Jira dans le fichier : avertissement, et l'écran d'options permet de filtrer |
| colonnes inconnues `cf:*` | `customfield_*` | (ignorées) ou `acceptance[]` | Si mappées dans l'écran « Champs » |

Champs Kýdos sans source Jira : `techno`, `category`, `module` et `spec` restent vides ; `instructions[]` = `[]`.

### 2.3 Taxonomies (création automatique des valeurs manquantes)

Principe commun :
1. Rassembler les valeurs distinctes du fichier avec leur nombre d'occurrences.
2. Proposer une correspondance **pré-remplie** (règles ci-dessous), modifiable dans le wizard.
3. Toute valeur non associée à une clé existante est **créée** si `createMissingTaxonomies` vaut `true` (défaut). Sinon l'import renvoie `422 MAPPING_INCOMPLETE`.
4. Création : `key = slug(name)` (NFD, suppression des diacritiques, minuscules, `[^a-z0-9]+` remplacé par `-`, tirets de bord retirés). En cas de collision de clé avec une valeur **différente**, suffixe `-2`, `-3`… `label` = nom Jira ; `order` = ordre max du kind + 1 ; `meta.jiraName` = nom Jira.
5. Un élément **archivé** correspondant est désarchivé (avertissement), plutôt que dupliqué.
6. Correspondance mémorisée dans `Project.importMappings.jira` et proposée en priorité au ré-import.

#### 2.3.1 Statuts

Pré-remplissage, par ordre :
1. Correspondance mémorisée.
2. `label` ou `meta.jiraName` égal au nom Jira (normalisé : sans casse ni accent).
3. Synonymes :

| Noms Jira (normalisés) | Clé Kýdos par défaut |
|---|---|
| `backlog`, `open`, `new`, `nouveau`, `ouvert` | `draft` |
| `to do`, `todo`, `a faire`, `selected for development`, `ready`, `pret` | `pending` |
| `in progress`, `en cours`, `doing`, `in development` | `onprocess` |
| `in test`, `testing`, `qa`, `en test` | `tested` |
| `in review`, `code review`, `review`, `en revue`, `a valider`, `validation` | `needconfirmation` |
| `done`, `closed`, `resolved`, `termine`, `terminee`, `ferme`, `fait` | `finished` |
| `validated`, `accepted`, `valide`, `validee` | `confirmed` |

4. Repli par catégorie : `done` donne le premier statut `isDone` (ordre croissant) ; `indeterminate`, le premier statut non terminé de catégorie `indeterminate` (sinon d'ordre intermédiaire) ; `new`, le premier statut non terminé.
5. Si la clé suggérée n'existe pas dans le projet : proposition « Créer ».

Création :
- `meta.isDone = (category === 'done')` et `meta.category = category`.
- Couleur : `new` `#9db4dd`, `indeterminate` `#e6c46a`, `done` `#2f8f57`.
- Ordre : inséré après le dernier statut de même catégorie.

Déduction de la catégorie quand elle est absente (CSV DC, current fields) :
- `done` si `Status Category` ∈ {`Done`, `Terminé`, `Terminée`}, **ou** si `Resolution` est non vide et différente de `Unresolved`, **ou** si `Resolved` est non vide, **ou** si le nom figure dans la ligne `done` des synonymes ;
- `new` si le nom figure dans les lignes `draft` / `pending` ;
- sinon `indeterminate`.
- Avertissement `STATUS_CATEGORY_GUESSED`.

Incohérence : un statut Kýdos `isDone` associé à une issue Jira non terminée (ou l'inverse) déclenche l'avertissement `DONE_MISMATCH` dans l'aperçu, sans blocage.

#### 2.3.2 Priorités

| Jira | Si le projet a P0–P3 (défauts Kýdos) | Sinon création (clé, couleur) |
|---|---|---|
| `Highest` | `P0` | `highest`, `#e85d70` |
| `High` | `P1` | `high`, `#e0a458` |
| `Medium` | `P2` | `medium`, `#e6c46a` |
| `Low` | `P3` | `low`, `#9db4dd` |
| `Lowest` | `P3` + avertissement `PRIORITY_MERGED` (option « Créer P4 Très basse `#6b7280` ») | `lowest`, `#6b7280` |
| `Blocker` / `Critical` (DC) | `P0` | `blocker` / `critical`, `#e85d70` |
| `Major` | `P1` | `major`, `#e0a458` |
| `Minor` | `P2` | `minor`, `#9db4dd` |
| `Trivial` | `P3` | `trivial`, `#6b7280` |
| Autre | Correspondance manuelle | `slug(name)`, `#6b7280` |

`order` des priorités créées : ordre Jira (Highest = 0).

#### 2.3.3 Types

| Jira (`issuetype.name`, normalisé) | Suggestion | Création si absent : clé, couleur, meta |
|---|---|---|
| `story`, `user story` | `story` | `story`, `#7ecb98`, `{ hierarchyLevel: 0 }` |
| `bug`, `defect` | `bug` (existe par défaut) | `bug`, `#e85d70` |
| `task`, `tache` | `task` | `task`, `#9db4dd`, `{ hierarchyLevel: 0 }` |
| `epic` ou `hierarchyLevel === 1` | `epic` | `epic`, `#b39ddb`, `{ isEpic: true, hierarchyLevel: 1 }` |
| `sub-task`, `subtask`, `sous-tache` ou `subtask === true` | `subtask` | `subtask`, `#6b78ea`, `{ isSubtask: true, hierarchyLevel: -1 }` |
| `new feature`, `improvement` (DC) | `feature` (existe par défaut) | `feature` |
| `spike`, `technical task` | `chore` | `chore` |
| Autre | Correspondance manuelle | `slug(name)`, `#6b7280`, `{ hierarchyLevel }` issu du JSON si présent |

Choix : Story est **créée** plutôt que fusionnée avec `feature`, pour préserver la sémantique Scrum (la vélocité compte les stories et les bugs, pas les sous-tâches). Le wizard permet de fusionner.

#### 2.3.4 Versions et composants

- Version : `key = name` (brut, trim), comme `seed.js` ; `label = name`.
  - `meta.released`, `meta.releaseDate` (`YYYY-MM-DD`), `meta.startDate`, `meta.archived` et `meta.jiraId` viennent du fichier versions, sinon des objets `fixVersions` / `versions` du JSON. En CSV : non renseignés (`undefined`), avertissement `VERSION_META_MISSING`.
  - `order` : tri par `releaseDate` croissante (sans date en dernier), puis `compareVersions` de `seed.js`.
  - Version archivée dans Jira : créée avec `archived: true` si des issues y font référence, ignorée sinon.
- Composant : `key = slug(name)`, `label = name`, couleur `#6b7280`.

### 2.4 Sprints

#### 2.4.1 Rapprochement et création

Identification d'un sprint Jira `s` contre les taxonomies `sprint` du projet :
1. `meta.jiraId === s.jiraId` (si l'id est connu) ;
2. sinon `label` égal au nom (sans casse, espaces compactés) ;
3. sinon création : `key = slug(name)` (`KB Sprint 1` donne `kb-sprint-1`), `label = name`, `order` = rang chronologique (§2.4.4).

Au rapprochement par nom d'un sprint existant sans `jiraId`, l'import renseigne `meta.jiraId` : c'est ce qui permet un CSV suivi d'un JSON.

Meta écrites :

| Jira | `meta` Kýdos | Règle |
|---|---|---|
| `state` | `status` | `active` donne `active` ; `closed` donne `finished` ; `future` donne `draft`. Option `nextFutureAsReady` : le sprint `future` au `startDate` le plus proche passe à `ready`. |
| `startDate` | `startDate` | ISO UTC |
| `endDate` | `endDate` | ISO UTC (fin prévue) |
| `completeDate` | `completeDate`, `closedAt` | ISO UTC |
| `goal` | `goal` | Vide : on conserve l'objectif Kýdos existant |
| `id` / `boardId` / `originBoardId` | `jiraId` / `jiraBoardId` | |
| | `source: 'jira'`, `stateSource: 'jira'\|'heuristic'\|'manual'` | |

Mise à jour d'un sprint existant (ré-import) :
- Les dates et l'état Jira écrasent les valeurs **seulement si** `stateSource !== 'manual'` (modifié dans l'écran de mapping ou dans l'administration Kýdos après import), ou si `conflictPolicy === 'jira'`.
- Un sprint Kýdos `finished` n'est **jamais** rouvert par un import (avertissement `SPRINT_REOPEN_IGNORED`).

`Project.currentSprint` : si `setCurrentSprint` (défaut `true`) et que le sprint courant du projet est `null`, absent ou `finished`, il prend la valeur du sprint `active`.
- Plusieurs sprints actifs (sprints parallèles Jira) : le plus récent par `startDate`, avec l'avertissement `MULTIPLE_ACTIVE_SPRINTS`.
- Aucun sprint actif : on ne touche pas au sprint courant.

#### 2.4.2 Sprint courant et historique d'une issue

```js
// refs : sprints de l'issue, résolus (état connu) ; isDone : catégorie du statut Jira === 'done'
function assignSprint(refs, isDone) {
  const chrono = [...refs].sort(bySprintChronology);          // §2.4.4
  const history = chrono.map((s) => s.key);
  const open = chrono.filter((s) => s.state !== 'closed');   // active | future | inconnu
  const closed = chrono.filter((s) => s.state === 'closed');
  let current = null;
  if (open.length) {
    // Jira n'autorise qu'un sprint ouvert par issue ; en cas d'anomalie : l'actif, sinon le dernier
    current = (open.find((s) => s.state === 'active') || open[open.length - 1]).key;
    if (open.length > 1) warn('ISSUE_IN_MULTIPLE_OPEN_SPRINTS');
  } else if (closed.length && isDone) {
    current = closed[closed.length - 1].key;                 // sprint où elle a été terminée
  }                                                          // sinon backlog : null
  const carryOverCount = closed.length - (isDone && !open.length && closed.length ? 1 : 0);
  return { sprint: current, sprintHistory: history, carryOverCount };
}
```

Cas limites :
- Issue terminée **et** présente dans un sprint ouvert : sprint ouvert. Jira la comptera dans ce sprint à la clôture.
- Sous-tâche : mêmes règles (Jira reporte le sprint du parent). Si le sprint de la sous-tâche diffère de celui du parent, avertissement `SUBTASK_SPRINT_MISMATCH`, sans correction.

#### 2.4.3 États des sprints en CSV (heuristique)

Le CSV ne donne ni état ni dates. Si aucun fichier sprints JSON n'est fourni :
1. **Ordre de liste** : on suppose que les colonnes `Sprint` d'une ligne sont en ordre chronologique d'ajout **[INCERTAIN : observé en pratique, non documenté]**. Chaque ligne à au moins deux sprints produit des arcs `s[i]` vers `s[i+1]`.
2. **Clos** : tout sprint ayant un successeur sur au moins une issue (l'issue a été reportée).
3. Les sprints restants sont triés par numéro final du nom (`/(\d+)\s*$/`), sinon par première apparition dans le fichier.
4. Premier sprint restant : **actif** si au moins une de ses issues a une catégorie `indeterminate` ou `done`, sinon **futur**.
   - Exception : si toutes ses issues sont `done` **et** qu'un autre sprint restant existe après lui, il est **clos**, et on applique la règle au suivant.
5. Les autres restants sont **futurs**.
6. Tous reçoivent `meta.stateSource = 'heuristic'`, dates à `null` et l'avertissement `SPRINT_STATE_GUESSED` et `SPRINT_DATES_MISSING`.
7. L'écran de mapping affiche un tableau éditable (état, début, fin, objectif) avec l'action « Compléter les dates selon la cadence du projet » : le sprint actif commence le lundi de la semaine courante, sur `effectiveSprintDays()` jours ; les sprints clos sont placés avant, les futurs après.

Fixture §7.1 : `KB Sprint 1` clos (successeur sur KB-2), `KB Sprint 2` actif (KB-2 est In Progress), `KB Sprint 3` futur.

#### 2.4.4 Chronologie des sprints

`bySprintChronology(a, b)`, dans l'ordre :
1. `startDate` (les `null` en dernier) ;
2. rang topologique des arcs §2.4.3 ;
3. numéro final du nom ;
4. `jiraId` ;
5. ordre d'apparition.

Cette même comparaison fixe `order` des taxonomies créées ; les sprints existants du projet gardent leur `order`, et les nouveaux sont insérés à la bonne position par renumérotation de `order` de 10 en 10.

### 2.5 Versions : version principale

`Task.version` (unique) est dérivée de `fixVersions` :

```js
function primaryVersion(fixVersions /* [{ key, released, releaseDate }] */) {
  if (!fixVersions.length) return null;
  const unreleased = fixVersions.filter((v) => v.released !== true);
  if (unreleased.length) // la prochaine livraison visée
    return unreleased.sort((a, b) => cmpDateNullLast(a.releaseDate, b.releaseDate) || compareVersions(a.key, b.key))[0].key;
  return fixVersions.sort((a, b) => cmpDateNullLast(b.releaseDate, a.releaseDate) || compareVersions(b.key, a.key))[0].key; // dernière livrée
}
```

- En CSV (`released` inconnu), toutes les versions sont non livrées : on retient la plus petite par `compareVersions`, sauf si une date est connue par ailleurs.
- `Project.currentVersion` : si `setCurrentVersion` (défaut `false`), il prend la première version non livrée par `releaseDate`.

### 2.6 Hiérarchie epic / parent

Résolution du **parent direct** de chaque issue, dans l'ordre :
1. JSON `fields.parent.id` / `.key` ;
2. CSV `parent` : valeur `/^\d+$/` = Issue id, valeur `/^[A-Z][A-Z0-9_]*-\d+$/` = clé ;
3. CSV `parentKey` ;
4. CSV `epicLink` (clé de l'epic, DC).

Recherche du parent :
1. dans l'ensemble importé : `Map externalId → taskId` et `Map externalKey → taskId`, construites **après** l'allocation des identifiants (§3) ;
2. sinon en base : `{ project, source: 'jira', externalId }` puis `{ project, externalKey }` ;
3. sinon `parent = null`, `parentExternalKey = <clé ou "id:10001">` et l'avertissement `PARENT_NOT_FOUND`. Un ré-import ultérieur qui contient le parent résout le lien.

Calcul de `epic` :

```js
function epicOf(taskId, byTaskId, isEpicType, depth = 0) {
  const t = byTaskId.get(taskId);
  if (!t || !t.parent || depth > 5) return null;           // garde anti-cycle
  const p = byTaskId.get(t.parent);                        // chargé depuis l'import ou la base
  if (!p) return null;
  return isEpicType(p.type) ? p.taskId : epicOf(p.taskId, byTaskId, isEpicType, depth + 1);
}
```

- Une tâche de type epic a `epic = null`.
- Cycle détecté (A parent de B parent de A) : lien rompu sur la ligne la plus récente, avec l'erreur de ligne `PARENT_CYCLE` (la tâche est importée sans parent).
- Recalcul : modifier `parent` ou `type` d'une tâche recalcule `epic` pour elle et ses descendants (hook de sauvegarde ou service dédié).

### 2.7 Utilisateurs

Personnes détectées : assignee, reporter, creator, auteurs de commentaires et watchers. Chacune est identifiée par `ref = accountId || 'name:' + displayName`. Rapprochement, dans l'ordre :

| # | Critère | Confiance | Automatique |
|---|---|---|---|
| 1 | `User.externalAccounts` : `source: 'jira'` et même `accountId` | `remembered` | oui |
| 2 | `email` (JSON, rarement présent) égal à `User.email` (minuscules) | `email` | oui |
| 3 | `displayName` normalisé (NFD sans accents, minuscules, espaces compactés) égal à `User.displayName` **et unique** | `name` | oui |
| 4 | `username` égal à la partie locale de l'email, ou au username DC | `username` | oui |
| 5 | Mêmes jetons de nom dans un autre ordre (`Durand Alice`) | `fuzzy` | **non** : suggestion seulement |
| — | Aucun | `none` | valeur externe conservée |

Non rapproché :
- `assignee = null` et `externalAssignee = { accountId, displayName, email }` ;
- idem pour `reporter` : dans ce cas `reporter` = l'utilisateur qui importe, afin de garder un propriétaire ;
- commentaires : `author = null` et `authorLabel = displayName || accountId`.

Option `createMissingUsers` (défaut `false`) : crée un `User` avec
- `username = slug(displayName)` (suffixe numérique en cas de collision),
- `email` si connu, `role: 'developer'`, `active: false`,
- `passwordHash = hashPassword(randomBytes(24))`, l'administrateur active ensuite le compte et définit le mot de passe.

Les utilisateurs rapprochés automatiquement ou manuellement reçoivent une entrée `externalAccounts` si `rememberMapping`.

### 2.8 Story points et estimations

- Colonne de points : `mapping.fields.storyPoints`. Suggestion : la colonne ou le champ `Story Points` / `Story point estimate` le plus rempli dans le fichier. S'ils sont tous deux remplis sur une même ligne avec des valeurs différentes, le champ choisi l'emporte et l'avertissement `STORY_POINTS_CONFLICT` est émis.
- Analyse : `parseFloat(String(v).replace(',', '.'))`. Vide, `NaN` ou négatif donne `0`. Valeur hors échelle du projet : conservée, avec l'avertissement `POINTS_OFF_SCALE`.
- Sous-tâches : points importés tels quels, mais exclus de la vélocité (§6.4).
- `estimate = secondsToDuration(originalEstimateSec, hoursPerDay)` et `duration = secondsToDuration(timeSpentSec, hoursPerDay)`. Les secondes brutes sont conservées (§2.1.1).

### 2.9 Commentaires

- Source CSV : §1.2.8. Source JSON : `comment.comments[]` avec `body` passé par `adfToText`.
- Chaque commentaire devient `{ author, authorLabel, externalAuthor, text, createdAt, updatedAt, editedAt, externalId, source: 'jira' }`.
  - `editedAt = updated` si `updated - created > 60 s`.
  - Texte vide après conversion : ignoré.
- Idempotence : `externalId` = id Jira si connu, sinon `fp:` + sha1 de `created (arrondi à la minute, ISO) | authorRef | normalize(text).slice(0, 200)` (normalisation §1.3.5).
  - Au ré-import, un commentaire est ajouté seulement si aucun commentaire de la tâche n'a le même `externalId` **ou** la même empreinte.
  - Si le JSON correspond à un commentaire importé en CSV par l'empreinte, son `externalId` est remplacé par l'id Jira.
- Les commentaires importés ne sont **jamais modifiés ni supprimés** par un ré-import (les commentaires locaux sont préservés).
- Écriture : `createdAt` doit rester celui de Jira. Utiliser `updateOne` / `bulkWrite` avec `timestamps: false`, ou `save({ timestamps: false })`. **[À vérifier]** : Mongoose peut écraser `createdAt` des sous-documents quand les timestamps sont actifs.
- `options.importComments` (défaut `true`).

### 2.10 Historique

- Toute tâche **créée** reçoit l'entrée `{ at: now, by: importer._id, byLabel: importer.displayName, field: 'imported', from: null, to: externalKey, note: 'Importée depuis Jira (<fichier>, job <id>)', source: 'jira' }`.
- Toute tâche **mise à jour** passe par `applyPatchWithHistory(task, patch, importer, 'Ré-import Jira (<fichier>)')`, ce qui trace les champs suivis.
- Option `importChangelog` (JSON uniquement, défaut `false`) : chaque `histories[].items[]` produit une entrée de `history` datée de `histories[].created`, insérée **avant** l'entrée `imported` et ordonnée par date :

| `items[].field` | `history.field` | from / to |
|---|---|---|
| `status` | `status` | `fromString`/`toString` passés par la correspondance de statuts ; nom inconnu : chaîne brute préfixée `jira:` |
| `Sprint` | `sprint` | `from`/`to` = listes d'ids (`"76, 79"`). Sprint entrant = `to \ from`, sortant = `from \ to`. L'entrée est `from: clé du sprint ouvert précédent`, `to: clé du nouveau sprint ouvert ou null` |
| `Story Points` / `Story point estimate` | `complexity` | nombres |
| `assignee` | `assignee` | ObjectId rapproché, sinon `null` avec `note: displayName` |
| `priority` | `priority` | via la correspondance |
| `Fix Version` | `fixVersions` | nom ajouté ou retiré |
| `issuetype` | `type` | via la correspondance |
| autres | ignorés | |

Avec le changelog, la reconstruction du burndown des sprints passés (§6.2) est exacte. Sans lui, les métriques des sprints Jira clos sont **approximatives** (§6.1.4).

### 2.11 Ré-import idempotent

#### 2.11.1 Rapprochement

Pour chaque `NormalizedIssue` :
1. `Task.findOne({ project, source: 'jira', externalId })` si `externalId` ;
2. sinon `Task.findOne({ project, source: 'jira', externalKey })` (et renseignement de `externalId` s'il était manquant) ;
3. sinon création.

Précharger toutes les tâches `source: 'jira'` du projet dans deux `Map` (une requête), pas de requête par ligne.

Si `externalId` existe dans **un autre** projet Kýdos : avertissement `ALREADY_IMPORTED_ELSEWHERE`, sans déplacement.

#### 2.11.2 Modes

| Mode | Tâche absente | Tâche existante |
|---|---|---|
| `create` (« Créer seulement ») | créée | `skip` (« déjà importée ») |
| `upsert` (« Créer et mettre à jour ») | créée | fusion §2.11.3 |

Les tâches Kýdos absentes du fichier ne sont **jamais supprimées** (le fichier peut être partiel). Le rapport indique leur nombre (`notInFile`).

#### 2.11.3 Fusion à trois voies

Champs synchronisés : `title`, `description`, `acceptance`, `type`, `status`, `priority`, `sprint`, `version`, `fixVersions`, `affectsVersions`, `labels`, `components`, `complexity`, `estimate`, `duration`, `timeOriginalEstimateSec`, `timeRemainingSec`, `timeSpentSec`, `assignee`, `externalAssignee`, `parent`, `dueDate`, `resolution`, `resolvedAt`, `blocked`. (`sprintHistory` : union ordonnée, jamais de conflit. `reporter` et `createdAt` : fixés à la création.)

```js
const base = task.importMeta?.snapshot || {};            // valeurs mappées du dernier import
for (const f of SYNC_FIELDS) {
  const local = canon(task[f]), incoming = canon(mapped[f]), prev = canon(base[f]);
  if (eq(incoming, prev)) continue;                       // Jira n'a pas changé : on garde le local
  if (eq(local, prev) || !(f in base)) { patch[f] = mapped[f]; continue; } // pas de modif locale : Jira s'applique
  if (eq(local, incoming)) continue;                      // convergence
  conflicts.push({ field: f, local: task[f], incoming: mapped[f], base: base[f] });
  if (options.conflictPolicy === 'jira') patch[f] = mapped[f]; // 'kydos' : on garde le local
}
// canon : tableaux triés (sauf ordre significatif), ObjectId en chaîne, Date en ISO, '' et undefined en null
```

- `conflictPolicy` : `'jira'` (défaut, Jira fait foi pendant la transition) ou `'kydos'`.
- Chaque conflit apparaît dans le rapport (et dans le dry-run) avec les trois valeurs.
- Après écriture : `importMeta.snapshot = mapped` (projection complète), `importMeta.hash = sha1(stableStringify(mapped))`, `importMeta.lastSyncedAt = now`.
- **Raccourci** : si `sha1(mapped) === importMeta.hash`, la tâche est `unchanged` sans comparaison ; les nouveaux commentaires sont quand même traités.
- Les statuts ne sont pas soumis aux règles DoD (§6.6) lors d'un import, mais les DoD incomplètes sont listées dans le rapport (`DOD_BYPASSED_BY_IMPORT`).

---

## 3. Stratégie d'identifiants

### 3.1 Règles

Notations : `P` = clé du projet Kýdos cible ; clé Jira `J = PREFIX-N`.

1. **Tâche déjà importée** (rapprochée §2.11.1) : garde son `taskId`, **jamais renumérotée**.
2. **Nouvelle tâche, `PREFIX === P`** : candidat `taskId = format(P, N)` avec `format = (P, n) => \`${P}-${String(n).padStart(3, '0')}\`` (convention Kýdos : `KB-2` devient `KB-002`, `KB-1234` reste `KB-1234`).
   - Candidat libre (aucune tâche du projet avec ce `taskId`, et non réservé par une autre ligne du fichier) : il est retenu.
   - Sinon : renumérotation (règle 4) et avertissement `ID_RENUMBERED` (`{ externalKey, wanted, assigned, reason: 'collision' }`).
3. **Nouvelle tâche, `PREFIX !== P`** : renumérotation systématique.
4. **Renumérotation** : `nextTaskNumber(P)`, **après** l'étape 3.2.3 ci-dessous. Les lignes sont traitées par `PREFIX` puis `N` croissants, ce qui préserve l'ordre relatif Jira.
5. `externalKey = J` toujours ; recherche et `GET /tasks/:id` acceptent `J` (§2.1.1).

Remarque : `KB-42` et `KB-042` ne doivent pas coexister. La vérification de collision porte donc sur la forme paddée **et** sur `externalKey`.

### 3.2 Algorithme (planification, exécutée aussi en dry-run)

```text
1. existing = Map(taskId -> task) du projet ; imported = Map(externalId|externalKey -> task)
2. Pour chaque issue rapprochée : assigned[issue] = task.taskId
3. Nouvelles issues avec PREFIX === P, triées par N :
     cand = format(P, N)
     si !existing.has(cand) && !reserved.has(cand) : assigned = cand ; reserved.add(cand)
     sinon : pending.push(issue) (collision)
   maxKept = max(N des candidats retenus)
   3.2.3  Counter.findByIdAndUpdate(P, { $max: { seq: maxKept } }, { upsert: true })
          (en dry-run : seqSim = max(counter.seq, maxKept), sans écriture)
4. pending += nouvelles issues avec PREFIX !== P (triées par PREFIX, N)
   pour chacune : assigned = format(P, await nextTaskNumber(P))   (dry-run : ++seqSim)
5. Maps externalId -> taskId et externalKey -> taskId, puis résolution des parents (§2.6)
```

Le `$max` avant les `nextTaskNumber` garantit qu'une tâche créée ensuite à la main ne prend pas un identifiant réservé par l'import. Une issue Jira créée **après** et importée plus tard peut toutefois entrer en collision avec une tâche manuelle : elle est alors renumérotée (règle 2).

### 3.3 Exemples

| Situation | Résultat |
|---|---|
| Projet Kýdos `KB` vide, fixture §7 | `KB-001` … `KB-006`, `Counter.KB = 6` |
| Projet `KB` existant (seed : `KB-001` … `KB-155`) | Toutes collisions : `KB-156` … `KB-161` (dans l'ordre KB-1 … KB-6), 6 × `ID_RENUMBERED` |
| Projet `DEMO` (`Counter = 12`) | `DEMO-013` … `DEMO-018` ; KB-2 devient `DEMO-014`, parent `DEMO-013` |
| Projet `KB` contenant seulement `KB-002` (manuelle) | KB-1, 3, 4, 5, 6 donnent `KB-001`, `003`…`006` ; `Counter` porté à 6 ; KB-2 donne `KB-007` |
| Ré-import du même fichier | Aucun nouvel identifiant, `Counter` inchangé |

Option du wizard « Créer un nouveau projet avec la clé Jira » : le client appelle d'abord `POST /api/projects` (`key = PREFIX`), puis importe. Les identifiants sont alors identiques (modulo padding).

---

## 4. Flux d'import (wizard) et API

### 4.1 Écrans

Accès : **Administration > Projet > Importer depuis Jira**, visible des superadmins uniquement.

| # | Écran | Contenu | Actions / validations |
|---|---|---|---|
| 1 | **Source** | Projet cible : existant (sélecteur) ou nouveau (clé + nom, clé Jira proposée après analyse). Zone de dépôt multi-fichiers (`.csv`, `.json`), 5 fichiers max, 20 Mo par fichier. Aide dépliable « Comment exporter depuis Jira » (§1.2.1, script §1.3.7). | Lecture `FileReader.readAsText` (UTF-8). Refus local au-delà de la taille. Bouton « Analyser » : appel `preview`. |
| 2 | **Aperçu** | Pour chaque fichier : format détecté, variante Cloud/DC, lignes, délimiteur, format de date détecté (modifiable si ambigu), fuseau. Compteurs : issues par type, sprints (avec états), versions, statuts, priorités, composants, labels, personnes, commentaires, issues avec parent. Projets Jira présents (filtre). Plan d'identifiants (conservés / renumérotés / collisions). Création / mise à jour prévues. Erreurs et avertissements groupés par code, avec lignes. Échantillon des 5 premières issues normalisées. | Bloquant : erreurs de fichier. Lignes en erreur : exclues, affichées. |
| 3 | **Correspondances** | Onglets : **Statuts** (nom Jira, catégorie, nb, sélecteur Kýdos ou « Créer… » avec libellé, couleur, terminé ?) ; **Priorités** ; **Types** ; **Utilisateurs** (personne Jira, rôles et occurrences, suggestion avec niveau de confiance, sélecteur utilisateur, « Ne pas associer », « Créer un compte inactif ») ; **Sprints** (tableau éditable : nom, état, source de l'état, début, fin, objectif, sprint Kýdos existant ou nouveau ; bouton « Compléter selon la cadence ») ; **Champs** (colonne des story points, colonne des critères d'acceptation, heures par jour). | Tout statut, priorité et type doit être associé ou marqué « Créer » ; sinon bouton suivant désactivé. |
| 4 | **Options** | Mode `create` / `upsert` ; politique de conflit ; importer commentaires / changelog ; composants vers area ; labels vers techno ; extraire les critères d'acceptation ; définir sprint courant / version courante ; mémoriser les correspondances. | |
| 5 | **Simulation (dry-run)** | Appel `import` avec `dryRun: true`. Tableau : action par ligne (créer / mettre à jour / inchangée / ignorée / erreur), champs modifiés, conflits (valeurs locale, entrante, base), taxonomies et utilisateurs à créer, identifiants attribués. Filtres par action et par code. Export du rapport en CSV. | La simulation est **obligatoire** avant l'exécution. Si les fichiers, options ou correspondances changent, il faut la relancer (contrôle par `planHash`). |
| 6 | **Exécution** | Appel `import` avec `dryRun: false` et le `planHash` de la simulation. Indicateur de progression (réponse synchrone ; au-delà de 2 000 lignes, job asynchrone suivi par sondage de `GET /import/jobs/:id` toutes les 2 s). | `409` si un import est déjà en cours sur le projet. |
| 7 | **Rapport** | Compteurs `créées / mises à jour / inchangées / ignorées / erreurs / conflits / avertissements`, taxonomies créées, lien vers les tâches filtrées par job, rapport ligne par ligne téléchargeable, bouton **Annuler cet import** (§4.5). | |

### 4.2 API

Montage dans `server/src/index.js`, **avant** le parseur global (body-parser ignore ensuite un corps déjà analysé grâce à `req._body`) :

```js
const importRoutes = require('./routes/import.routes');
app.use('/api/projects/:projectKey/import', express.json({ limit: '25mb' }), importRoutes);
app.use(express.json({ limit: '2mb' }));
```

`import.routes.js` : `Router({ mergeParams: true })`, `router.use(requireAuth, loadProject, requireRole('superadmin'))`.

Limites :
- corps : **25 Mo** ;
- 5 fichiers maximum, 20 Mo par `content` ;
- 10 000 issues au total (plafond d'un export Jira Cloud) ;
- 1 import `running` par projet.

#### 4.2.1 `POST /api/projects/:projectKey/import/jira/preview`

Requête :

```json
{
  "files": [
    { "name": "jira.csv", "content": "Summary,Issue key,…" },
    { "name": "KB-sprints.json", "content": "{\"values\":[…]}" }
  ],
  "options": { "timezone": "Europe/Paris", "dateFormat": "auto", "hoursPerDay": 8, "jiraProjectKeys": null, "site": "https://site.atlassian.net" }
}
```

Réponse `200` :

```json
{
  "fileHash": "3f1c…",
  "detected": {
    "files": [ { "name": "jira.csv", "format": "jira-csv", "variant": "cloud", "rows": 6, "delimiter": ",", "dateFormat": "dd/MMM/yy h:mm a", "unmappedColumns": [] } ]
  },
  "stats": { "issues": 6, "byType": { "Epic": 1, "Story": 2, "Bug": 1, "Sub-task": 1, "Task": 1 }, "sprints": 3, "versions": 3, "components": 2,
             "labels": 3, "statuses": 4, "priorities": 5, "people": 3, "comments": 3, "withParent": 4, "jiraProjects": [ { "key": "KB", "name": "Kýdos Boutique", "count": 6 } ] },
  "entities": {
    "statuses":   [ { "name": "In Progress", "category": "indeterminate", "categorySource": "file", "count": 2, "suggested": { "key": "onprocess", "confidence": "synonym", "exists": true } } ],
    "priorities": [ { "name": "Lowest", "count": 1, "suggested": { "key": "P3", "confidence": "default", "exists": true, "warning": "PRIORITY_MERGED" } } ],
    "types":      [ { "name": "Sub-task", "subtask": true, "hierarchyLevel": -1, "count": 1, "suggested": { "key": "subtask", "exists": false, "create": { "label": "Sub-task", "color": "#6b78ea", "meta": { "isSubtask": true, "hierarchyLevel": -1 } } } } ],
    "sprints":    [ { "name": "KB Sprint 1", "jiraId": null, "state": "closed", "stateSource": "heuristic", "startDate": null, "endDate": null, "goal": null, "count": 2, "existingKey": null, "suggestedKey": "kb-sprint-1" } ],
    "versions":   [ { "name": "1.0.0", "released": null, "releaseDate": null, "count": 4, "exists": false } ],
    "components": [ { "name": "API", "count": 4, "key": "api", "exists": false } ],
    "labels":     [ { "name": "paiement", "count": 3 } ],
    "people":     [ { "ref": "712020:1a2b3c4d-0000-4000-8000-00000000a11c", "displayName": "Alice Durand", "email": null,
                      "roles": { "assignee": 1, "reporter": 2, "commenter": 1, "watcher": 1 }, "suggested": { "userId": "66e…", "confidence": "name" } } ],
    "fields":     { "storyPoints": { "candidates": [ "cf:story point estimate" ], "suggested": "cf:story point estimate" }, "acceptance": { "candidates": [], "suggested": null } }
  },
  "idPlan": { "projectKey": "KB", "prefixes": { "KB": 6 }, "kept": 6, "renumbered": 0, "collisions": [] },
  "matches": { "toCreate": 6, "toUpdate": 0, "alreadyImportedElsewhere": 0 },
  "defaultMapping": { "statuses": { "In Progress": "onprocess" }, "priorities": {}, "types": {}, "people": {}, "sprints": {}, "fields": {} },
  "warnings": [ { "code": "SPRINT_DATES_MISSING", "message": "3 sprints sans dates (export CSV).", "rows": [] } ],
  "errors":   [],
  "sample":   [ { "row": 1, "externalKey": "KB-1", "summary": "Paiement en ligne", "type": "Epic", "status": "In Progress" } ]
}
```

#### 4.2.2 `POST /api/projects/:projectKey/import/jira`

Requête :

```json
{
  "files": [ { "name": "jira.csv", "content": "…" } ],
  "dryRun": true,
  "planHash": null,
  "options": {
    "timezone": "Europe/Paris", "dateFormat": "auto", "hoursPerDay": 8, "site": null, "jiraProjectKeys": ["KB"],
    "mode": "upsert", "conflictPolicy": "jira",
    "createMissingTaxonomies": true, "createMissingUsers": false, "rememberMapping": true,
    "importComments": true, "importChangelog": false,
    "extractAcceptanceFromDescription": true, "componentToArea": false, "labelsToTechno": false,
    "setCurrentSprint": true, "setCurrentVersion": false, "nextFutureAsReady": false
  },
  "mapping": {
    "statuses":   { "In Progress": "onprocess", "Done": "finished", "To Do": "pending", "Backlog": { "create": { "key": "backlog-jira", "label": "Backlog", "color": "#9db4dd", "isDone": false, "category": "new" } } },
    "priorities": { "Highest": "P0", "High": "P1", "Medium": "P2", "Low": "P3", "Lowest": "P3" },
    "types":      { "Epic": { "create": { "key": "epic" } }, "Story": { "create": { "key": "story" } }, "Bug": "bug", "Task": { "create": { "key": "task" } }, "Sub-task": { "create": { "key": "subtask" } } },
    "people":     { "712020:1a2b3c4d-0000-4000-8000-00000000a11c": "66e0c1…", "712020:2b3c4d5e-0000-4000-8000-000000000b0b": null, "5f8a9b0c1d2e3f0012345678": { "create": true } },
    "sprints":    { "KB Sprint 1": { "key": "kb-sprint-1", "status": "finished", "startDate": "2026-08-24", "endDate": "2026-09-04", "goal": "Paiement carte" } },
    "fields":     { "storyPoints": "cf:story point estimate", "acceptance": null }
  }
}
```

- Valeur de correspondance : **chaîne** = clé existante ; `{ create: {...} }` = création ; `null` (personnes uniquement) = ne pas associer.
- `planHash` = sha1(`fileHash` + options + mapping) renvoyé par le dry-run. Il est **exigé** lorsque `dryRun: false`. En cas de différence : `409 PLAN_CHANGED`.

Réponse `200` (dry-run, avec `jobId: null`) ou `201` (exécution) :

```json
{
  "jobId": "66f1…",
  "dryRun": false,
  "planHash": "a9d0…",
  "status": "completed",
  "durationMs": 842,
  "counts": { "created": 6, "updated": 0, "unchanged": 0, "skipped": 0, "errors": 0, "conflicts": 0, "warnings": 5, "notInFile": 0 },
  "taxonomiesCreated": { "type": ["epic", "story", "task", "subtask"], "sprint": ["kb-sprint-1", "kb-sprint-2", "kb-sprint-3"], "version": ["0.9.0", "1.0.0", "1.1.0"], "component": ["api", "web"], "status": [], "priority": [] },
  "usersCreated": [],
  "project": { "currentSprint": "kb-sprint-2", "counterSeq": 6 },
  "rows": [
    { "row": 2, "externalKey": "KB-2", "externalId": "10002", "action": "create", "taskId": "KB-002", "changes": [], "conflicts": [], "warnings": [], "errors": [] },
    { "row": 7, "externalKey": null, "externalId": null, "action": "error", "taskId": null, "errors": ["MISSING_SUMMARY"] }
  ],
  "warnings": [ { "code": "PRIORITY_MERGED", "rows": [6] } ]
}
```

- `rows[].row` : numéro de ligne de données CSV (1 = première ligne après l'en-tête) ou index dans `issues[]` + 1 en JSON.
- `action` ∈ `create | update | unchanged | skip | error`.

Codes HTTP :

| Code | `code` | Cas |
|---|---|---|
| 400 | `NO_FILES`, `UNRECOGNIZED_FILE`, `UNSUPPORTED_FORMAT` (XML), `JSON_UNKNOWN_SHAPE`, `CSV_NOT_JIRA`, `MIXED_ISSUE_SOURCES`, `NO_ISSUES`, `INVALID_OPTIONS` | |
| 401 / 403 | | Non authentifié / non superadmin |
| 404 | | Projet introuvable |
| 409 | `IMPORT_IN_PROGRESS`, `PLAN_CHANGED`, `PLAN_REQUIRED` | |
| 413 | `PAYLOAD_TOO_LARGE`, `TOO_MANY_ISSUES` | |
| 422 | `MAPPING_INCOMPLETE` (avec `missing: { statuses: [], priorities: [], types: [] }`), `INVALID_MAPPING_TARGET` | |

Endpoints complémentaires :
- `GET /api/projects/:projectKey/import/jobs` : liste paginée, sans `rows` ni `undo`.
- `GET /api/projects/:projectKey/import/jobs/:id` : détail, avec `rows`.
- `POST /api/projects/:projectKey/import/jobs/:id/rollback` : annulation (§4.5).

### 4.3 Architecture serveur

```text
server/src/import/jira/
  detect.js                 // §1.5
  csv/parseCsv.js           // §1.2.2
  csv/headers.js            // §1.2.4
  csv/toNormalized.js       // lignes -> NormalizedIssue[] (+ dictionnaire accountId -> nom)
  json/issuesToNormalized.js
  json/sprints.js           // values[] -> JiraSprint[] ; parseLegacySprint
  json/versions.js
  common/dates.js           // §1.2.6
  common/durations.js       // §1.2.7 (+ parseDurationToSeconds pour l'export)
  common/adf.js             // §1.3.5
  common/wiki.js            // §1.2.9
  common/text.js            // slug, normalizeName, fingerprint, stableStringify, sha1
  suggest.js                // correspondances pré-remplies §2.3 / §2.7
  plan.js                   // fonction PURE : (normalized, projectState, mapping, options) -> Plan
  execute.js                // applique un Plan (écritures Mongo)
  rollback.js
server/src/routes/import.routes.js
server/src/models/ImportJob.js
server/test/import/*.test.js
server/test/fixtures/jira/{cloud-all-fields.csv, search-jql.json, board-sprints.json, project-versions.json}
```

Principes :
- **`plan.js` est pur** : il reçoit l'état du projet déjà chargé (taxonomies, tâches `source: 'jira'`, `taskId` existants, utilisateurs, `Counter`). Il renvoie la liste exhaustive des opérations et le rapport. Le dry-run **est** le plan : aucune divergence possible entre simulation et exécution, seul `execute` écrit.
- Ordre d'exécution :
  1. `ImportJob` en `running`, avec verrou par index partiel unique `{ project, status: 'running' }` ;
  2. taxonomies (`upsert`) ;
  3. utilisateurs créés et `externalAccounts` ;
  4. `Counter` `$max` puis allocations ;
  5. tâches en `bulkWrite` par lots de 500, `ordered: false`, `timestamps: false` pour les créations. Les mises à jour chargent le document, appliquent `applyPatchWithHistory` et sauvegardent par lots ;
  6. commentaires (`$push` des nouveaux) ;
  7. `Project` (sprint courant, version courante, `importMappings`) ;
  8. `ImportJob` en `completed`, ou `partial` si des écritures ont échoué (erreurs rattachées aux lignes).
- Aucune donnée d'import n'est conservée brute : les fichiers ne sont **pas stockés**, seulement leur sha1 et leur taille.

### 4.4 Modèle intermédiaire `NormalizedIssue`

```js
/**
 * @typedef {{ accountId: string|null, displayName: string|null, email: string|null, username: string|null }} JiraPerson
 * @typedef {{ jiraId: number|null, name: string, state: 'future'|'active'|'closed'|null, startDate: string|null,
 *             endDate: string|null, completeDate: string|null, goal: string|null, boardId: number|null }} JiraSprintRef
 * @typedef {{ externalId: string|null, author: JiraPerson|null, created: Date|null, updated: Date|null, body: string }} JiraComment
 * @typedef {{ name: string, jiraId: string|null, released: boolean|null, releaseDate: string|null, startDate: string|null,
 *             archived: boolean|null, description: string|null }} JiraVersionRef
 *
 * @typedef {Object} NormalizedIssue
 * @property {number} row                       // ligne source (1-based)
 * @property {string|null} externalId           // "10002"
 * @property {string|null} externalKey          // "KB-2"
 * @property {string|null} projectKey
 * @property {string} summary
 * @property {string} description               // texte converti (sans la section critères si extraite)
 * @property {string[]} acceptance
 * @property {string|null} environment
 * @property {{ name: string, subtask: boolean|null, hierarchyLevel: number|null }} type
 * @property {{ name: string, category: 'new'|'indeterminate'|'done', categorySource: 'file'|'guessed' }} status
 * @property {string|null} priority
 * @property {string|null} resolution
 * @property {JiraPerson|null} assignee
 * @property {JiraPerson|null} reporter
 * @property {Date|null} created
 * @property {Date|null} updated
 * @property {Date|null} resolved
 * @property {string|null} dueDate              // "YYYY-MM-DD"
 * @property {JiraVersionRef[]} fixVersions
 * @property {JiraVersionRef[]} affectsVersions
 * @property {string[]} components
 * @property {string[]} labels
 * @property {JiraSprintRef[]} sprints           // ordre source
 * @property {number|null} storyPoints
 * @property {{ storyPoints: number|null, storyPointEstimate: number|null }} rawPoints
 * @property {number|null} originalEstimateSec
 * @property {number|null} remainingEstimateSec
 * @property {number|null} timeSpentSec
 * @property {{ id: string|null, key: string|null, summary: string|null }|null} parent
 * @property {string|null} epicKey               // Epic Link (DC)
 * @property {boolean} flagged
 * @property {JiraComment[]} comments
 * @property {number} commentsTotal              // total annoncé (JSON)
 * @property {JiraPerson[]} watchers
 * @property {{ linkType: string, direction: 'inward'|'outward', ref: string }[]} links
 * @property {number} attachments
 * @property {Array<{ at: Date, author: JiraPerson, items: Array<{ field: string, from: string|null, fromString: string|null, to: string|null, toString: string|null }> }>} changelog
 * @property {{ code: string, message: string, column?: string, value?: string }[]} warnings
 * @property {{ code: string, message: string }[]} errors     // non vide : ligne exclue
 */
```

Sortie globale d'un parseur : `{ issues: NormalizedIssue[], sprints: JiraSprintRef[], versions: JiraVersionRef[], people: Map<ref, JiraPerson>, meta: { format, variant, rows, delimiter, dateFormat, unmappedColumns, customFieldIds } }`.

### 4.5 Rapport et annulation

- Rapport : `ImportJob.rows`, téléchargeable en CSV (`row, externalKey, action, taskId, changes, conflicts, warnings, errors`).
- Annulation (`POST …/jobs/:id/rollback`, superadmin, uniquement pour le **dernier** job `completed` ou `partial` du projet) :
  1. tâches `created` : supprimées **si** `updatedAt <= job.finishedAt` et aucun commentaire local ajouté depuis ; sinon conservées avec l'avertissement `ROLLBACK_SKIPPED_MODIFIED` ;
  2. tâches `updated` : restauration des champs de `undo[].before` via `applyPatchWithHistory` (note « Annulation import <id> »), seulement pour les champs encore égaux à la valeur importée ;
  3. commentaires ajoutés par le job : retirés (`source: 'jira'` et `externalId` listé) ;
  4. taxonomies créées : supprimées si plus aucune tâche ne les référence, sinon archivées ;
  5. utilisateurs créés (inactifs) : supprimés s'ils ne sont référencés nulle part ;
  6. `Counter` : **non décrémenté** (des identifiants « troués » sont acceptables et évitent toute réutilisation) ;
  7. job en `rolledBack`, avec rapport d'annulation.

### 4.6 Sécurité et robustesse

- Contenu traité comme **données** : aucune évaluation, aucun HTML rendu. Descriptions et commentaires sont affichés en texte côté client (déjà le cas).
- Limitation de taille avant analyse, garde de profondeur JSON (`JSON.parse` natif, profondeur non limitée : refuser si `content.length > 20 Mo`).
- Aucune requête sortante vers Jira depuis le serveur (pas de stockage de jeton Atlassian).
- Les ObjectId de la correspondance des personnes sont vérifiés (`User.exists`) ; clés de taxonomie validées contre le projet.
- Journal serveur : job id, projet, utilisateur, compteurs (pas le contenu).
- Temps de traitement cible : moins de 5 s pour 2 000 issues, moins de 30 s pour 10 000 (sinon mode asynchrone, §4.1 écran 6).

---

## 5. Export Kýdos vers CSV compatible Jira

### 5.1 Endpoint

`GET /api/projects/:projectKey/export/jira.csv?status=…&sprint=…&type=…` : mêmes filtres que `GET /tasks`, authentifié (tout rôle). Réponse `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="KB-jira-2026-09-14.csv"`.

### 5.2 Format

- UTF-8 **avec BOM**, séparateur `,`, fins de ligne `\r\n`, guillemets RFC 4180 sur toute cellule contenant `,`, `"`, `\r` ou `\n`.
- Dates au format **`dd/MMM/yy h:mm a`**, mois anglais, fuseau `Project.timezone`. C'est le format à saisir dans l'étape « Configuration » de l'importeur CSV Jira.
- Lignes ordonnées : epics, puis tâches standard, puis sous-tâches ; ensuite par `taskId`. L'importeur Jira exige que le parent précède l'enfant.
- En-têtes multi-valeurs répétés autant de fois que le maximum rencontré (au moins 1).

| Colonne (ordre) | Source Kýdos | Notes |
|---|---|---|
| `Issue id` | Partie numérique de `taskId` (`KB-042` donne `42`) | Identifiant local pour la hiérarchie à l'import Jira |
| `Issue key` | `externalKey` sinon `taskId` | Informatif |
| `Summary` | `title` | |
| `Issue Type` | `meta.jiraName` du type, sinon `label` | Correspondance à confirmer dans l'importeur Jira |
| `Status` | `meta.jiraName` du statut, sinon `label` | |
| `Priority` | `meta.jiraName`, sinon correspondance inverse §2.3.2 (`P0` donne `Highest`…), sinon `label` | |
| `Description` | `description` + `\n\nh3. Critères d'acceptation\n` + `* item` par critère | Wiki markup minimal |
| `Assignee` | `assignee.email`, sinon `externalAssignee.email`, sinon `displayName` | **[INCERTAIN]** : l'importeur Cloud attend l'accountId pour un rapprochement fiable |
| `Reporter` | Même règle | |
| `Created` | `createdAt` | |
| `Due Date` | `dueDate` (`dd/MMM/yy`) | |
| `Labels` × n | `labels[]` (espaces remplacés par `_`) + `kydos-<taskId>` | Le label de traçabilité permet un aller-retour |
| `Component/s` × n | `label` des composants | |
| `Fix Version/s` × n | `fixVersions[]`, sinon `[version]` | |
| `Affects Version/s` × n | `affectsVersions[]` | |
| `Sprint` | `label` du sprint courant (vide si backlog) | **[INCERTAIN]** : l'import de sprint par nom n'est pas garanti (Jira DC exige l'id) |
| `Story Points` | `complexity` (vide si 0) | À associer au champ de points de l'instance cible |
| `Original Estimate` | `timeOriginalEstimateSec` sinon `parseDurationToSeconds(estimate)` | Secondes |
| `Time Spent` | `timeSpentSec` sinon `parseDurationToSeconds(duration)` | Secondes |
| `Parent` | `Issue id` du parent (`parent`) | |
| `Comment` × n | `dd/MMM/yy h:mm a;<accountId ou email ou nom>;<texte>` | accountId si `externalAccounts` le connaît |

```js
// common/durations.js
function parseDurationToSeconds(text, hoursPerDay = 8, daysPerWeek = 5) {
  if (!text) return null;
  const re = /(\d+(?:[.,]\d+)?)\s*(sem|w|j|d|h|min|m)\b/gi;
  const unit = { sem: hoursPerDay * daysPerWeek * 3600, w: hoursPerDay * daysPerWeek * 3600, j: hoursPerDay * 3600, d: hoursPerDay * 3600, h: 3600, min: 60, m: 60 };
  let total = 0, found = false, m;
  while ((m = re.exec(text))) { found = true; total += parseFloat(m[1].replace(',', '.')) * unit[m[2].toLowerCase()]; }
  return found ? Math.round(total) : null;   // "—", "1h/version" -> 3600 (partie analysable) ; texte libre -> null
}
```

### 5.3 Test d'aller-retour

Test obligatoire : export du projet importé depuis la fixture §7.1, puis ré-import dans un projet vierge `RT`. Résultat attendu : mêmes titres, types, statuts, priorités, points, estimations (à la minute), labels (hors `kydos-*`), composants, versions, hiérarchie et nombre de commentaires. Le CSV exporté doit être reconnu par Kýdos (`variant: 'datacenter'`, en-têtes `Fix Version/s`).

---

## 6. Fonctionnalités Scrum pour dépasser Jira

### 6.0 Priorisation

| Prio | Fonctionnalité | Ce que Jira fait | Ce que Kýdos fait en plus | Dépendances | Effort |
|---|---|---|---|---|---|
| **P1** | 6.1 Cycle de vie de sprint | Démarrer / terminer, report des tâches vers un sprint ou le backlog | Objectif et capacité **obligatoires** au démarrage, contrôle DoR, **snapshot figé** des engagements et du résultat, report **par tâche**, compteur de reports, création proposée de la rétro | §2.1 | M |
| **P1** | 6.2–6.3 Burndown / burnup | Graphiques par board, basés sur l'estimation | Calcul **reproductible** depuis `history`, choix points / nombre / heures, journal des changements de périmètre | 6.1 | M |
| **P1** | 6.4 Vélocité | Graphique engagé / terminé | Moyenne glissante, fourchette, **vélocité par jour de capacité**, prévision de version | 6.1 | S |
| **P2** | 6.5 Capacité | Absente en natif (Advanced Planning partiel) | Capacité par membre (dispo, focus), charge en heures et en points, alerte de surcharge | 6.4 | M |
| **P2** | 6.6 DoD / DoR | Absentes (checklists via apps tierces) | Listes par projet et par type, contrôle bloquant configurable, traçabilité des dérogations | §2.1 | M |
| **P2** | 6.9 Alertes | Signalement « Flagged », pas d'alerte calculée | 12 règles calculées (bloqué, immobile, surcharge, dérive du burndown…) | 6.1–6.6 | M |
| **P3** | 6.7 Planning poker | Absent en natif (apps tierces) | Intégré au rituel refinement existant (`Event`) : votes masqués, tours, consensus, écriture de `complexity` historisée | `Event` | M |
| **P3** | 6.8 Rétrospective liée | Absente | Formats de rétro, cartes et votes, actions converties en tâches, **revue automatique** des actions précédentes, taux de suivi | 6.1, `Event` | M |

Effort : S ≤ 3 j, M ≤ 8 j (un développeur, tests compris), estimation indicative.

Prérequis communs :
- `isDone(statusKey)` = `meta.isDone` de la taxonomie de statut.
- `isSubtask(typeKey)` = `meta.isSubtask`.
- `points(t)` = `complexity`.
- Jours ouvrés : `Project.workingDays` hors `Project.holidays`, calculés dans `Project.timezone`.

### 6.1 Cycle de vie de sprint

#### 6.1.1 États et transitions

```text
draft --(préparer)--> ready --(démarrer)--> active --(clôturer)--> finished
  ^                     |
  +----(repasser)-------+
```

- Au plus **un** sprint `active` par projet, sauf `Project.allowParallelSprints` (défaut `false`).
- `finished` est terminal : réouverture réservée au superadmin, qui supprime le snapshot de clôture et ajoute une note d'audit.

#### 6.1.2 Données

Dans `Taxonomy(kind='sprint').meta` : `status`, `startDate`, `endDate`, `goal`, `capacity` (§6.5), `startedAt`, `startedBy`, `closedAt`, `closedBy`, `excludeFromVelocity`.

Nouveau modèle `SprintSnapshot` (immuable) :

```js
const sprintSnapshotSchema = new Schema({
  project:  { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  sprint:   { type: String, required: true },                       // clé taxonomy
  kind:     { type: String, enum: ['start', 'close'], required: true },
  at:       { type: Date, required: true },
  by:       { type: Schema.Types.ObjectId, ref: 'User' },
  approximate: { type: Boolean, default: false },                   // reconstitué (import sans changelog)
  goal:     String,
  capacity: Schema.Types.Mixed,                                     // copie de meta.capacity
  tasks: [{ task: Schema.Types.ObjectId, taskId: String, type: String, status: String, done: Boolean,
            points: Number, assignee: Schema.Types.ObjectId, parent: String, subtask: Boolean }],
  metrics: Schema.Types.Mixed,                                      // §6.1.4 (close)
  carryOver: [{ taskId: String, to: String }],                       // close : destination (clé sprint ou null)
}, { timestamps: true });
sprintSnapshotSchema.index({ project: 1, sprint: 1, kind: 1 }, { unique: true });
```

#### 6.1.3 Démarrer

`POST /api/projects/:projectKey/sprints/:sprintKey/start` (superadmin) :

```json
{ "goal": "Paiement 3-D Secure en production", "startDate": "2026-09-07", "endDate": "2026-09-18", "capacity": { "focusFactor": 0.7, "members": [ { "user": "66e…", "availableDays": 9, "hoursPerDay": 7 } ] }, "force": false }
```

Règles :
1. Statut du sprint ∈ {`draft`, `ready`}, sinon `409 SPRINT_NOT_STARTABLE`. Un autre sprint est `active` (et pas de sprints parallèles) : `409 ACTIVE_SPRINT_EXISTS`.
2. `goal` non vide (après trim) : **obligatoire**, sinon `400 GOAL_REQUIRED`.
3. `endDate > startDate`. Valeurs par défaut : `startDate` = aujourd'hui, `endDate` = `startDate + effectiveSprintDays() - 1`.
4. Contrôles, renvoyés dans `warnings` et bloquants si `dorEnforcement === 'block'` et `force !== true` :
   - tâches non prêtes (§6.6) : `NOT_READY` ;
   - tâches non estimées (`complexity === 0`, hors sous-tâches) : `UNESTIMATED` ;
   - surengagement (§6.9 `OVERCOMMIT`) : **jamais bloquant**.
5. Écritures :
   - `meta.status = 'active'`, `startedAt = now`, `startedBy` ;
   - `Project.currentSprint = sprintKey` ;
   - `SprintSnapshot{ kind: 'start' }` avec toutes les tâches `sprint === sprintKey` : `points` = `complexity` à cet instant, `done` = `isDone(status)` ;
   - `metrics.committedPoints` = Σ `points` des tâches non terminées et non sous-tâches ;
   - `metrics.committedCount` = leur nombre ;
   - les tâches déjà terminées au démarrage sont listées mais **exclues** de l'engagement.
6. Réponse : `{ sprint, snapshot, warnings }`.

#### 6.1.4 Clôturer

`POST /api/projects/:projectKey/sprints/:sprintKey/close` (superadmin) :

```json
{ "defaultTarget": "next", "overrides": [ { "taskId": "KB-004", "target": "backlog" }, { "taskId": "KB-009", "target": "kb-sprint-4" } ], "createRetro": true }
```

`defaultTarget` ∈ `next` (défaut) | `backlog` | `<clé sprint>`.
- `next` : premier sprint `ready`, sinon `draft`, d'`order` supérieur (ou de `startDate` postérieure). Si aucun n'existe, création de `Sprint N+1` (clé `slug`), dates contiguës selon la cadence du projet, statut `draft`.

Définitions, avec `S0` = tâches du snapshot `start` (non terminées au démarrage, hors sous-tâches), `T1` = instant de clôture, `E` = tâches avec `sprint === key` à T1 (hors sous-tâches) :

| Métrique | Formule |
|---|---|
| `committedPoints` | Σ `points` (snapshot start) sur `S0` |
| `completed` | `{ t ∈ E : isDone(t.status) }` |
| `completedPoints` | Σ `complexity` à T1 sur `completed` |
| `completedCommitted` | `completed ∩ S0` et Σ points |
| `added` | `E \ S0` (en excluant les tâches déjà terminées au démarrage) ; `addedPoints` = Σ `pointsAt(t, t_ajout)` où `t_ajout` = dernière entrée `history{field:'sprint', to:key}` postérieure à `startedAt` (ou `createdAt` si créée dans le sprint) |
| `addedThenRemoved` | Tâches entrées puis sorties pendant le sprint (via `history`) ; nombre seulement |
| `removed` | `S0 \ E` ; `removedPoints` = Σ `pointsAt(t, t_retrait)` |
| `reestimationDelta` | Σ (`complexity` à T1 − `points` au démarrage) sur `S0 ∩ E` |
| `notCompleted` | `E \ completed` ; Σ points |
| `sayDoRatio` | `completedCommittedPoints / committedPoints` (null si 0) |
| `completionRate` | `completedPoints / (committedPoints + addedPoints − removedPoints)` |
| `scopeChangeRatio` | `(addedPoints + removedPoints) / committedPoints` |
| `velocity` | `= completedPoints` (sous-tâches exclues ; une story terminée compte ses points même si des sous-tâches restent ouvertes) |
| `bugsCompleted`, `bugPoints` | Sur `completed` de type bug |
| `dodOverrides` | Nombre d'entrées `history{field:'dod'}` pendant le sprint (§6.6) |
| `blockedDays` | Σ jours ouvrés `blocked === true` pendant le sprint (via `history{field:'blocked'}`) |

Écritures (dans cet ordre, idempotentes) :
1. Pour chaque `t ∈ notCompleted` : `target = override ?? defaultTarget`. Puis `applyPatchWithHistory(t, { sprint: targetKeyOrNull }, user, 'Report fin de sprint « <label> »')`, `t.carryOverCount += 1`, et ajout de `target` à `sprintHistory` s'il n'est pas `null`. Les **sous-tâches non terminées** suivent leur parent. Une sous-tâche non terminée dont le parent est terminé suit `defaultTarget`.
2. `SprintSnapshot{ kind: 'close', tasks: état de E ∪ S0 à T1, metrics, carryOver }`.
3. `meta.status = 'finished'`, `closedAt`, `closedBy`, `completeDate = T1`.
4. `Project.currentSprint` = sprint cible s'il est défini et que `setCurrentOnClose` est vrai (défaut `true`), sinon `null`.
5. Si `createRetro` : `Event{ type: 'retro', sprint: key, title: 'Rétrospective <label>', status: 'draft', retro.sprintMetrics = metrics }` avec la revue des actions précédentes pré-remplie (§6.8).

**Sprints importés de Jira déjà clos** (sans snapshot) : snapshot `close` calculé à l'import avec `approximate: true` :
- `completed` = tâches terminées dont le dernier sprint de `sprintHistory` est ce sprint ;
- `notCompleted` = tâches ayant ce sprint suivi d'un autre sprint dans `sprintHistory` ;
- `committed` ≈ `completed ∪ notCompleted` (ajouts et retraits inconnus) ;
- si `importChangelog` : calcul exact via §6.2.

### 6.2 Reconstruction temporelle depuis `history`

```js
// Valeur du champ `field` de la tâche à l'instant t (Date). undefined si la tâche n'existait pas.
function valueAt(task, field, t) {
  if (task.createdAt > t) return undefined;
  let v = task[field];
  const later = task.history
    .filter((h) => h.field === field && h.at > t)
    .sort((a, b) => b.at - a.at);            // du plus récent au plus ancien
  for (const h of later) v = h.from;          // on « rembobine »
  return v;
}
const sprintAt = (task, t) => valueAt(task, 'sprint', t) ?? null;   // 'backlog' -> null
const statusAt = (task, t) => valueAt(task, 'status', t);
const pointsAt = (task, t) => Number(valueAt(task, 'complexity', t)) || 0;
```

Hypothèses et garde-fous :
- Toute modification de `status`, `sprint` ou `complexity` passe par `applyPatchWithHistory`, y compris le glisser-déposer du board, le report de clôture et l'import. **Test d'invariant** : pour chaque route qui écrit ces champs, vérifier qu'une entrée d'historique est créée.
- `history.from` doit être la valeur **avant** modification (déjà le cas).
- Tâches importées sans changelog : aucune entrée avant `importMeta.importedAt`. La valeur est donc considérée constante avant l'import, et les graphiques des périodes antérieures portent la mention « reconstitué ».
- Candidats d'un sprint (limite la requête) : `{ project, $or: [ { sprint: key }, { sprintHistory: key }, { history: { $elemMatch: { field: 'sprint', $or: [ { to: key }, { from: key } ] } } } ] }`.

### 6.3 Burndown et burnup

`GET /api/projects/:projectKey/sprints/:sprintKey/burndown?unit=points|count|hours`

Calcul :
1. `days` = jours ouvrés de `startDate` à `min(endDate, aujourd'hui)` ; pour la prévision affichée, les jours restants jusqu'à `endDate`. `N` = nombre total de jours ouvrés du sprint.
2. Pour chaque jour `d`, `T(d)` = fin du jour local (23:59:59.999 dans `Project.timezone`), ou maintenant pour aujourd'hui.
3. `scope(T) = { t ∈ candidats : sprintAt(t, T) === key && !isSubtask(valueAt(t,'type',T)) }`
4. `val(t, T)` selon l'unité : `pointsAt(t, T)` ; `1` ; `heures(t)` = `timeRemainingSec/3600` si défini, sinon `parseDurationToSeconds(estimate)/3600`, sinon 0 (+ compteur `unestimated`).
5. `remaining(T) = Σ_{t ∈ scope(T), !isDone(statusAt(t,T))} val(t,T)`
6. `completed(T) = Σ_{t ∈ scope(T), isDone(statusAt(t,T))} val(t,T)`
7. `scopeTotal(T) = remaining(T) + completed(T)`
8. Ligne idéale : `committed` = `metrics.committedPoints` du snapshot start (ou `remaining(T_start)` si absent). Après le k-ième jour ouvré (k = 0 au démarrage, N à la fin) : `ideal(k) = committed × (1 − k / N)`.
9. `events[]` : entrées d'historique dans l'intervalle du sprint sur les tâches candidates (`added`, `removed`, `done`, `reopened`, `reestimated`) avec `{ at, taskId, delta }`. Ce journal est affiché en infobulle.

Réponse :

```json
{ "unit": "points", "committed": 21, "workingDays": 10,
  "days": [ { "date": "2026-09-07", "remaining": 21, "completed": 0, "scope": 21, "ideal": 18.9 } ],
  "events": [ { "at": "2026-09-08T10:12:00Z", "taskId": "KB-012", "type": "added", "delta": 3 } ],
  "approximate": false }
```

- Burndown : `remaining` contre `ideal`.
- Burnup : `completed` et `scope` (la ligne de périmètre rend visibles les ajouts, contrairement au burndown Jira qui les mélange).
- Performance : tâches candidates < 200 par sprint en pratique, calcul en mémoire en O(tâches × jours × entrées). Mise en cache mémoire de 60 s par `(sprint, unit)`, invalidée par toute écriture sur une tâche candidate. Pour un sprint `finished` : résultat persisté dans `SprintSnapshot.metrics.burndown` à la clôture.

### 6.4 Vélocité

`GET /api/projects/:projectKey/velocity?window=3`

Série : sprints `finished` qui ont un snapshot `close`, triés par `closedAt`, hors `meta.excludeFromVelocity`. Pour chaque sprint `i` :
- `v_i` = `metrics.velocity` ;
- `c_i` = `metrics.committedPoints` ;
- `sd_i` = `metrics.sayDoRatio` ;
- `cap_i` = Σ `availableDays` de la capacité (§6.5), sinon nombre de jours ouvrés du sprint × nombre de membres ayant eu au moins une tâche (repli signalé `capacityEstimated: true`).

Sur les `n = min(window, nb sprints)` derniers sprints (`window` par défaut = `Project.velocityWindow` = 3) :

| Indicateur | Formule |
|---|---|
| `average` | `Σ v_i / n` |
| `median` | médiane des `v_i` |
| `min`, `max` | extrêmes |
| `stdDev` | écart-type de population |
| `predictability` | moyenne des `sd_i` non nuls |
| `pointsPerCapacityDay` | `Σ v_i / Σ cap_i` |
| `forecastNext.points` | `pointsPerCapacityDay × capNext` si la capacité du prochain sprint est saisie ; sinon `average × (joursOuvrésNext / moyenne joursOuvrés_i)` |
| `forecastNext.low` / `high` | `min` et `max` des `v_i / cap_i`, multipliés par `capNext` (même repli) |
| `calibrated` | `n >= 2` ; en dessous, pas de prévision (`null`) |

Prévision de version (au-delà de Jira) : `GET /api/projects/:projectKey/versions/:versionKey/forecast`.
- `R` = Σ `complexity` des tâches non terminées (hors sous-tâches) ayant la version dans `fixVersions`, ou comme `version`.
- Sprints restants : `optimiste = ceil(R / max)`, `probable = ceil(R / average)`, `pessimiste = ceil(R / min)`.
- Date estimée = `endDate` du sprint actif + (sprints − 1) × `effectiveSprintDays()`, en jours calendaires.
- Comparaison avec `meta.releaseDate` : `onTrack` si la date probable ≤ `releaseDate`.

Réponse :

```json
{ "window": 3, "calibrated": true,
  "sprints": [ { "key": "kb-sprint-1", "label": "KB Sprint 1", "committed": 13, "completed": 11, "added": 2, "removed": 0, "sayDo": 0.77, "capacityDays": 18, "approximate": true } ],
  "average": 12.3, "median": 12, "min": 11, "max": 14, "stdDev": 1.2, "predictability": 0.81,
  "pointsPerCapacityDay": 0.68, "forecastNext": { "points": 12.9, "low": 11.4, "high": 14.2, "basis": "capacity" } }
```

### 6.5 Capacité par membre

Données : `Taxonomy(sprint).meta.capacity`

```js
{
  focusFactor: 0.7,                         // défaut projet, 0 < f <= 1
  members: [{
    user: ObjectId,
    availableDays: 8,                       // jours ouvrés disponibles sur le sprint
    hoursPerDay: 7,                         // défaut Project.hoursPerDay
    focusFactor: null,                      // surcharge individuelle (null = défaut)
    note: 'Congés jeudi-vendredi',
  }],
  updatedAt: Date, updatedBy: ObjectId,
}
```

Endpoints :
- `GET /api/projects/:projectKey/sprints/:sprintKey/capacity` : données et calculs ;
- `PUT …/capacity` (superadmin, ou tout membre pour sa propre ligne).

Pré-remplissage à la création : membres actifs ayant eu au moins une tâche sur les 3 derniers sprints, `availableDays` = jours ouvrés du sprint.

Calculs par membre `m` (tâches `t` du sprint avec `assignee = m`, hors terminées) :

| Grandeur | Formule |
|---|---|
| `workingDays` | jours ouvrés entre `startDate` et `endDate` (hors `holidays`) |
| `capacityHours(m)` | `availableDays × hoursPerDay × (focusFactor_m ?? focusFactor)` |
| `loadHours(m)` | Σ `remainingHours(t)`, avec `remainingHours` = `timeRemainingSec/3600` sinon `parseDurationToSeconds(estimate)/3600`, sinon non comptée |
| `unestimated(m)` | nombre de tâches sans estimation horaire |
| `loadPoints(m)` | Σ `complexity` (hors sous-tâches) |
| `capacityPoints(m)` | `pointsPerCapacityDay × availableDays` (§6.4 ; `null` si non calibré) |
| `ratioHours(m)` | `loadHours / capacityHours` |
| `ratioPoints(m)` | `loadPoints / capacityPoints` |
| `state(m)` | ratio de référence = `ratioHours` si ≥ 50 % des tâches ont une estimation horaire, sinon `ratioPoints`. `< 0.8` : `under` ; `0.8–1.0` : `ok` ; `1.0–1.15` : `tight` ; `> 1.15` : `overload` |

Équipe : `teamCapacityHours = Σ capacityHours`, `teamCapacityPoints = pointsPerCapacityDay × Σ availableDays`, `plannedPoints = Σ complexity` des tâches du sprint (hors sous-tâches), `ratio = plannedPoints / teamCapacityPoints`. Tâches non assignées : comptées dans l'équipe, listées à part.

### 6.6 Definition of Done / Definition of Ready

#### 6.6.1 Données

`Project` :

```js
definitionOfDone:  [{ _id: ObjectId, text: String, required: { type: Boolean, default: true }, appliesTo: [String] /* clés type, [] = tous */, order: Number, archived: Boolean }],
definitionOfReady: [{ /* même forme */ }],
readyRules: {                                  // contrôles automatiques de la DoR
  requireEstimate: true,                       // complexity > 0 (hors sous-tâches)
  requireAcceptance: true,                     // acceptance.length >= 1 (stories et bugs)
  requireDescription: true,                    // description.trim().length >= 20
  maxPoints: 13,                               // au-delà : « à découper »
  requireNoOpenBlocker: true,                  // blocked === false
},
dodEnforcement: { type: String, enum: ['off', 'warn', 'block'], default: 'warn' },
dorEnforcement: { type: String, enum: ['off', 'warn', 'block'], default: 'warn' },
```

`Task` :

```js
checklists: {
  dod: [{ item: ObjectId, checked: Boolean, by: ObjectId, at: Date }],
  dor: [{ item: ObjectId, checked: Boolean, by: ObjectId, at: Date }],
},
```

Endpoints :
- `PUT /api/projects/:projectKey/definitions` (superadmin) : `{ definitionOfDone, definitionOfReady, readyRules, dodEnforcement, dorEnforcement }` ;
- `PATCH /api/projects/:projectKey/tasks/:taskId/checklists` : `{ list: 'dod'|'dor', item, checked }`, avec une entrée d'historique `field: 'dod'|'dor'`.

#### 6.6.2 Règles

- Éléments applicables à `t` : non archivés et (`appliesTo` vide ou contenant `t.type`).
- `readiness(t)` = `{ ready, missingItems[], failedRules[], score }` :
  - `missingItems` = éléments DoR **requis** applicables non cochés ;
  - `failedRules` = règles de `readyRules` non satisfaites ;
  - `ready = missingItems.length === 0 && failedRules.length === 0` ;
  - `score = cochés / applicables` (éléments requis et règles confondus).
- `doneCheck(t)` = éléments DoD requis applicables non cochés.
- **Passage vers un statut `isDone`**, dans `PATCH /tasks/:taskId`, le board et la clôture :
  - `off` : aucun contrôle ;
  - `warn` : écriture effectuée, réponse `{ task, warnings: [{ code: 'DOD_INCOMPLETE', missing }] }` ;
  - `block` : `409 { code: 'DOD_INCOMPLETE', missing }`, sauf `body.forceDod === true` par un superadmin avec `note` obligatoire. L'entrée d'historique `field: 'dod'`, `to: 'override'` porte la note et les éléments manquants.
- Démarrage de sprint : `readiness` sur toutes les tâches (§6.1.3).
- Refinement : un événement de type `refinement` affiche `readiness` par tâche liée.
- Métriques de clôture : `% tâches terminées avec DoD complète`, `dodOverrides`, `% tâches prêtes au démarrage`.
- Import : les contrôles DoD ne s'appliquent pas (§2.11.3).

### 6.7 Planning poker dans le rituel refinement

#### 6.7.1 Données (`Event`)

```js
// eventTaskSchema : ajout
poker: {
  status: { type: String, enum: ['idle', 'voting', 'revealed', 'agreed', 'skipped'], default: 'idle' },
  round:  { type: Number, default: 0 },
  votes:  [{ user: ObjectId, value: String, round: Number, at: Date }],
  finalValue: Number, agreedAt: Date, agreedBy: ObjectId,
},
// eventSchema : ajout
pokerDeck:      { type: [String], default: undefined },   // défaut dérivé du projet
facilitator:    { type: Schema.Types.ObjectId, ref: 'User' },  // défaut createdBy
activePokerTask: { type: Schema.Types.ObjectId, default: null }, // _id du eventTask en cours
```

Paquet par défaut : nombres extraits de `Project.complexityScale` après `:` (`/\d+(?:[.,]\d+)?/g`), par exemple `"Fibonacci (points de story) : 1, 2, 3, 5, 8, 13"` donne `['1','2','3','5','8','13']`. On ajoute en tête `'0'` et `'0.5'` s'ils sont absents, et en fin `'?'` (je ne sais pas) et `'pause'`.

Fonctionnalité activée pour les types d'événement dont `meta.features` contient `'estimation'` (déjà le cas de `refinement` et `grooming`).

#### 6.7.2 Endpoints

Préfixe `/api/projects/:projectKey/events/:id/poker/:eventTaskId`.

| Méthode | Rôle | Effet |
|---|---|---|
| `POST …/start` | animateur | `round += 1`, `status = 'voting'`, `activePokerTask = eventTaskId` |
| `POST …/vote` `{ value }` | participant (`participants` contient l'utilisateur) | `value ∈ pokerDeck`, sinon 400. Remplace le vote du même utilisateur pour ce tour. Si tous les participants ont voté : révélation automatique |
| `POST …/reveal` | animateur | `status = 'revealed'` |
| `POST …/agree` `{ value }` | animateur | `status = 'agreed'`, `finalValue`. `applyPatchWithHistory(task, { complexity: value }, user, 'Planning poker « <titre> », tour <n>')`. `eventTask.outcome = 'estimé <value> pts'` |
| `POST …/skip` | animateur | `status = 'skipped'` |

Confidentialité : tant que `status === 'voting'`, `GET /events/:id` renvoie pour les votes des autres `{ user, hasVoted: true }` **sans** `value`. Seul le vote du demandeur est complet. Filtrage côté serveur obligatoire.

Temps réel : sondage client (`refetchInterval: 2000` avec react-query) tant qu'un poker est `voting` ou `revealed`. Pas de WebSocket en V1.

#### 6.7.3 Statistiques et consensus (à la révélation, tour courant)

- `numeric` = votes convertibles en nombre ; `idx(v)` = position dans `pokerDeck`.
- `average`, `median`, `min`, `max` sur `numeric`.
- `spread = idx(max) − idx(min)`.
- `consensus` :
  - `'full'` si toutes les valeurs numériques sont égales ;
  - `'near'` si `spread <= 1` ;
  - sinon `'none'`.
- `suggested` : `'full'` donne la valeur commune ; `'near'` donne la valeur la plus fréquente (égalité : la plus haute) ; `'none'` donne `null`.
- `outliers` = utilisateurs ayant voté `min` et `max` si `consensus === 'none'`. L'interface les invite à s'exprimer en premier, puis propose un nouveau tour.
- Si les `'?'` représentent plus de 50 % des votes : suggestion « Story à affiner ou à découper ».
- Si `suggested > readyRules.maxPoints` : suggestion « À découper ».
- Tous les tours sont conservés (`votes[].round`) pour l'historique de l'événement.

### 6.8 Rétrospective liée aux actions

#### 6.8.1 Données (`Event` de type `retro`)

```js
retro: {
  format: { type: String, enum: ['start-stop-continue', '4L', 'mad-sad-glad', 'keep-drop-add'], default: 'start-stop-continue' },
  cards: [{ column: String, text: String, author: ObjectId, anonymous: Boolean, votes: [ObjectId], groupId: String, createdAt: Date }],
  sprintMetrics: Schema.Types.Mixed,            // copie de SprintSnapshot(close).metrics
  previousActionsReview: [{ event: ObjectId, action: ObjectId, text: String, statusAtReview: String, comment: String }],
  maxVotesPerUser: { type: Number, default: 3 },
},
// actionItemSchema : ajout
status:     { type: String, enum: ['open', 'done', 'dropped'], default: 'open' },   // `done` conservé et synchronisé : done === (status === 'done')
dueSprint:  String,                               // clé du sprint cible
task:       { type: Schema.Types.ObjectId, ref: 'Task' },
taskId:     String,
sourceCard: ObjectId,
doneAt:     Date,
```

#### 6.8.2 Règles

1. **Création** (depuis la clôture §6.1.4 ou manuellement avec un `sprint`) :
   - `sprintMetrics` copié ;
   - `previousActionsReview` pré-rempli avec **toutes les actions `open`** des rétros précédentes du projet (triées par date), qui forment l'agenda « Revue des actions précédentes ».
2. **Cartes** :
   - le texte est masqué aux autres participants tant que `status === 'draft'` (phase de collecte), sauf pour son auteur ;
   - révélation au passage en `scheduled` ;
   - votes limités à `maxVotesPerUser` par participant ;
   - `anonymous` masque `author` dans les réponses.
3. **Conversion d'une action en tâche** : `POST /api/projects/:projectKey/events/:id/actions/:actionId/to-task` crée une tâche avec
   - `type` = `Project.retroActionType` (défaut `chore`), `labels: ['retro']` ;
   - `sprint` = `dueSprint` ou le sprint suivant ;
   - `description` = texte + `Issue de la rétrospective « <titre> »`, `assignee` = celui de l'action ;
   - `action.task` et `action.taskId` renseignés.
4. **Synchronisation** :
   - une tâche liée passe à un statut `isDone` : `action.status = 'done'` et `doneAt` (hook dans la mise à jour des tâches : recherche `Event.find({ 'actionItems.task': task._id })`) ;
   - une tâche liée supprimée : `action.task = null` (statut inchangé).
5. **Métriques** (affichées dans la rétro suivante et sur le tableau de bord) :
   - `followThroughRate(retro n)` = actions de la rétro `n-1` passées à `done` avant la date de la rétro `n`, divisées par le nombre total d'actions de la rétro `n-1` ;
   - `openActionsAge` = âge moyen (en sprints) des actions `open` ;
   - `recurringThemes` = `groupId` présents dans au moins 2 rétros consécutives (regroupement manuel des cartes).

### 6.9 Alertes

`GET /api/projects/:projectKey/alerts?sprint=<clé>` (défaut : sprint courant) renvoie `[{ code, severity: 'info'|'warning'|'critical', taskId?, user?, message, value?, threshold? }]`. Calcul à la demande (pas de stockage), mis en cache 60 s. L'interface affiche un badge sur le sprint et une liste dans le tableau de bord.

Seuils par défaut (`Project.alertThresholds`, modifiables) et `Project.wipLimit = 2`, `Project.staleDays = 2`.

| Code | Règle précise | Sévérité |
|---|---|---|
| `BLOCKED_TASK` | Tâche du sprint non terminée avec `blocked === true` (ou statut `meta.isBlocked`). `d` = jours ouvrés depuis `blockedAt` | `warning` ; `critical` si `d >= 2` |
| `STALE_TASK` | Tâche du sprint actif, catégorie de statut `indeterminate`. `lastActivity` = max(dernière entrée `history.at`, dernier `comments.createdAt`). Jours ouvrés depuis `lastActivity` ≥ `staleDays` | `warning` ; `critical` si ≥ 2 × `staleDays` |
| `OVERCOMMIT` | Sprint `ready` ou `active` : `ratio = plannedPoints / forecastNext.points` (§6.4 ; pour l'actif, `committedPoints`). Non calculée si `calibrated === false` (émet `VELOCITY_NOT_CALIBRATED`, `info`) | `warning` si `ratio > 1.10` ; `critical` si `> 1.25` |
| `MEMBER_OVERLOAD` | `state(m) === 'overload'` (§6.5) ; `tight` | `critical` / `warning` |
| `SCOPE_CREEP` | Sprint actif : `(addedPoints + removedPoints)` calculés à maintenant (§6.1.4) / `committedPoints` | `warning` si `> 0.20` ; `critical` si `> 0.35` |
| `BURNDOWN_OFF_TRACK` | Sprint actif : `k/N >= 0.5` et `remaining(now) > ideal(k) × 1.2` | `warning` ; `critical` si ≤ 2 jours ouvrés restants et `remaining > 0.3 × committed` |
| `UNESTIMATED_IN_SPRINT` | Tâche du sprint (hors sous-tâches), `complexity === 0` | `warning` |
| `NOT_READY_IN_SPRINT` | `readiness(t).ready === false` et `dorEnforcement !== 'off'` | `info` (`warning` en `block`) |
| `WIP_LIMIT` | Pour un assigné : nombre de tâches en catégorie `indeterminate` > `wipLimit` | `warning` |
| `CARRY_OVER_REPEAT` | `carryOverCount >= 2` | `warning` ; `critical` si `>= 3` |
| `SPRINT_WITHOUT_GOAL` | Sprint actif avec `goal` vide | `info` |
| `SPRINT_OVERDUE` | Sprint actif avec `endDate < maintenant` | `warning` (« sprint à clôturer ») |
| `RETRO_ACTIONS_OPEN` | Actions de rétro `open` dont `dueSprint` est `finished` | `info` |

Tri : `critical` puis `warning` puis `info`, puis par code. Pas de notification e-mail en V1 (évolution : récapitulatif quotidien).

---

## 7. Jeux de données de test

Emplacement proposé : `server/test/fixtures/jira/`. Contexte commun :
- projet Jira `KB` « Kýdos Boutique », sprints de 2 semaines ;
- `KB Sprint 1` clos (24/08 au 04/09), `KB Sprint 2` actif (07/09 au 18/09), `KB Sprint 3` futur (21/09 au 02/10) ;
- versions `0.9.0` (livrée), `1.0.0` et `1.1.0` ;
- personnes : Alice Durand (`712020:1a2b…a11c`), Bob Leroy (`712020:2b3c…0b0b`), Carole Martin (`5f8a9b0c1d2e3f0012345678`, ancien format d'accountId).

Couverture : epic (KB-1), stories (KB-2 reportée sur deux sprints, KB-6 au backlog), bug terminé (KB-3), sous-tâche (KB-4), tâche future avec description wiki multi-lignes et guillemets (KB-5). S'y ajoutent : colonnes `Sprint`, `Fix versions`, `Components` et `Labels` répétées, commentaires contenant `,` et `;`, story points, estimations en secondes, statut `Backlog` hors synonymes directs.

Les fixtures ont été vérifiées : 40 colonnes par ligne après analyse RFC 4180, JSON valides, conversion ADF et wiki équivalente après normalisation.

### 7.1 `cloud-all-fields.csv` (Jira Cloud, « CSV (All fields) », colonnes réduites)

```csv
Summary,Issue key,Issue id,Issue Type,Status,Status Category,Project key,Project name,Priority,Resolution,Assignee,Assignee Id,Reporter,Reporter Id,Created,Updated,Resolved,Due date,Affects versions,Fix versions,Fix versions,Components,Components,Labels,Labels,Description,Environment,Original estimate,Remaining Estimate,Time Spent,Σ Original estimate,Sprint,Sprint,Custom field (Story point estimate),Parent,Parent summary,Watchers,Watchers Id,Comment,Comment
Paiement en ligne,KB-1,10001,Epic,In Progress,In Progress,KB,Kýdos Boutique,High,,Carole Martin,5f8a9b0c1d2e3f0012345678,Carole Martin,5f8a9b0c1d2e3f0012345678,01/Jul/26 10:00 AM,10/Sep/26 4:12 PM,,30/Sep/26,,1.0.0,,API,,paiement,,Permettre aux clients de payer en ligne.,,,,,,,,,,,Carole Martin,5f8a9b0c1d2e3f0012345678,,
Payer par carte,KB-2,10002,Story,In Progress,In Progress,KB,Kýdos Boutique,Medium,,Alice Durand,712020:1a2b3c4d-0000-4000-8000-00000000a11c,Carole Martin,5f8a9b0c1d2e3f0012345678,02/Jul/26 11:30 AM,12/Sep/26 9:41 AM,,,,1.0.0,1.1.0,API,Web,paiement,front,"En tant que client, je veux payer par carte afin de finaliser ma commande.",,28800,14400,14400,36000,KB Sprint 1,KB Sprint 2,5,10001,Paiement en ligne,Alice Durand,712020:1a2b3c4d-0000-4000-8000-00000000a11c,"25/Aug/26 9:05 AM;712020:1a2b3c4d-0000-4000-8000-00000000a11c;Maquette validée, on part sur Stripe Elements.","04/Sep/26 5:20 PM;5f8a9b0c1d2e3f0012345678;Reporté sur le sprint 2 : 3-D Secure pas prêt."
Montant arrondi incorrect au centime près,KB-3,10003,Bug,Done,Done,KB,Kýdos Boutique,Highest,Done,Bob Leroy,712020:2b3c4d5e-0000-4000-8000-000000000b0b,Alice Durand,712020:1a2b3c4d-0000-4000-8000-00000000a11c,20/Jul/26 3:15 PM,03/Sep/26 2:31 PM,03/Sep/26 2:31 PM,,0.9.0,1.0.0,,API,,paiement,,"Le total affiche 19,99 € au lieu de 20,00 €.",Chrome 128 / Windows 11,7200,0,5400,7200,KB Sprint 1,,2,10001,Paiement en ligne,,,03/Sep/26 2:30 PM;712020:2b3c4d5e-0000-4000-8000-000000000b0b;Cause : arrondi flottant; corrigé avec des centimes entiers.,
Écrire les tests 3-D Secure,KB-4,10004,Sub-task,To Do,To Do,KB,Kýdos Boutique,Medium,,Bob Leroy,712020:2b3c4d5e-0000-4000-8000-000000000b0b,Alice Durand,712020:1a2b3c4d-0000-4000-8000-00000000a11c,07/Sep/26 10:02 AM,07/Sep/26 10:02 AM,,15/Sep/26,,1.0.0,,,,,,,,7200,7200,,7200,KB Sprint 2,,,10002,Payer par carte,,,,
Configurer le webhook Stripe,KB-5,10005,Task,To Do,To Do,KB,Kýdos Boutique,Low,,,,Carole Martin,5f8a9b0c1d2e3f0012345678,10/Sep/26 8:45 AM,11/Sep/26 6:10 PM,,,,1.1.0,,API,,stripe,,"h3. Contexte
Recevoir les événements *payment_intent.succeeded*.
* Vérifier la signature
* Rejouer en cas d'échec (""retry"")",,14400,14400,,14400,KB Sprint 3,,3,10001,Paiement en ligne,,,,
Historique des paiements,KB-6,10006,Story,Backlog,To Do,KB,Kýdos Boutique,Lowest,,,,Carole Martin,5f8a9b0c1d2e3f0012345678,11/Sep/26 9:00 AM,11/Sep/26 9:00 AM,,,,1.1.0,,Web,,,,Afficher la liste des paiements du client.,,,,,,,,8,,,,,,
```

### 7.2 `search-jql.json` (réponse `GET /rest/api/3/search/jql?…&fields=*all&expand=names`)

```json
{
  "isLast": true,
  "names": {
    "summary": "Summary",
    "customfield_10020": "Sprint",
    "customfield_10016": "Story point estimate",
    "timeoriginalestimate": "Original estimate",
    "timeestimate": "Remaining Estimate",
    "timespent": "Time Spent"
  },
  "issues": [
    {
      "id": "10001",
      "key": "KB-1",
      "fields": {
        "summary": "Paiement en ligne",
        "issuetype": { "id": "10000", "name": "Epic", "subtask": false, "hierarchyLevel": 1 },
        "project": { "id": "10000", "key": "KB", "name": "Kýdos Boutique" },
        "status": { "id": "3", "name": "In Progress", "statusCategory": { "id": 4, "key": "indeterminate", "name": "In Progress", "colorName": "yellow" } },
        "priority": { "id": "2", "name": "High" },
        "resolution": null,
        "resolutiondate": null,
        "assignee": { "accountId": "5f8a9b0c1d2e3f0012345678", "displayName": "Carole Martin", "emailAddress": "carole.martin@example.com", "active": true },
        "reporter": { "accountId": "5f8a9b0c1d2e3f0012345678", "displayName": "Carole Martin", "emailAddress": "carole.martin@example.com", "active": true },
        "created": "2026-07-01T10:00:00.000+0200",
        "updated": "2026-09-10T16:12:00.000+0200",
        "duedate": "2026-09-30",
        "versions": [],
        "fixVersions": [ { "id": "10100", "name": "1.0.0", "archived": false, "released": false, "releaseDate": "2026-09-30" } ],
        "components": [ { "id": "10200", "name": "API" } ],
        "labels": [ "paiement" ],
        "description": { "type": "doc", "version": 1, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Permettre aux clients de payer en ligne." } ] } ] },
        "environment": null,
        "timeoriginalestimate": null,
        "timeestimate": null,
        "timespent": null,
        "aggregatetimeoriginalestimate": null,
        "customfield_10020": null,
        "customfield_10016": null,
        "comment": { "comments": [], "maxResults": 0, "total": 0, "startAt": 0 }
      }
    },
    {
      "id": "10002",
      "key": "KB-2",
      "fields": {
        "summary": "Payer par carte",
        "issuetype": { "id": "10001", "name": "Story", "subtask": false, "hierarchyLevel": 0 },
        "project": { "id": "10000", "key": "KB", "name": "Kýdos Boutique" },
        "status": { "id": "3", "name": "In Progress", "statusCategory": { "id": 4, "key": "indeterminate", "name": "In Progress", "colorName": "yellow" } },
        "priority": { "id": "3", "name": "Medium" },
        "resolution": null,
        "resolutiondate": null,
        "assignee": { "accountId": "712020:1a2b3c4d-0000-4000-8000-00000000a11c", "displayName": "Alice Durand", "emailAddress": "alice.durand@example.com", "active": true },
        "reporter": { "accountId": "5f8a9b0c1d2e3f0012345678", "displayName": "Carole Martin", "emailAddress": "carole.martin@example.com", "active": true },
        "created": "2026-07-02T11:30:00.000+0200",
        "updated": "2026-09-12T09:41:00.000+0200",
        "duedate": null,
        "versions": [],
        "fixVersions": [
          { "id": "10100", "name": "1.0.0", "archived": false, "released": false, "releaseDate": "2026-09-30" },
          { "id": "10101", "name": "1.1.0", "archived": false, "released": false, "releaseDate": "2026-10-30" }
        ],
        "components": [ { "id": "10200", "name": "API" }, { "id": "10201", "name": "Web" } ],
        "labels": [ "paiement", "front" ],
        "parent": { "id": "10001", "key": "KB-1", "fields": { "summary": "Paiement en ligne", "issuetype": { "name": "Epic", "hierarchyLevel": 1 } } },
        "description": { "type": "doc", "version": 1, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "En tant que client, je veux payer par carte afin de finaliser ma commande." } ] } ] },
        "environment": null,
        "timeoriginalestimate": 28800,
        "timeestimate": 14400,
        "timespent": 14400,
        "aggregatetimeoriginalestimate": 36000,
        "customfield_10016": 5,
        "customfield_10020": [
          { "id": 1, "name": "KB Sprint 1", "state": "closed", "boardId": 1, "goal": "Paiement carte de bout en bout", "startDate": "2026-08-24T07:00:00.000Z", "endDate": "2026-09-04T15:00:00.000Z", "completeDate": "2026-09-04T15:10:00.000Z" },
          { "id": 2, "name": "KB Sprint 2", "state": "active", "boardId": 1, "goal": "3-D Secure et corrections", "startDate": "2026-09-07T07:00:00.000Z", "endDate": "2026-09-18T15:00:00.000Z" }
        ],
        "comment": {
          "comments": [
            { "id": "20001", "author": { "accountId": "712020:1a2b3c4d-0000-4000-8000-00000000a11c", "displayName": "Alice Durand" }, "created": "2026-08-25T09:05:00.000+0200", "updated": "2026-08-25T09:05:00.000+0200",
              "body": { "type": "doc", "version": 1, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Maquette validée, on part sur Stripe Elements." } ] } ] } },
            { "id": "20002", "author": { "accountId": "5f8a9b0c1d2e3f0012345678", "displayName": "Carole Martin" }, "created": "2026-09-04T17:20:00.000+0200", "updated": "2026-09-04T17:20:00.000+0200",
              "body": { "type": "doc", "version": 1, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Reporté sur le sprint 2 : 3-D Secure pas prêt." } ] } ] } }
          ],
          "maxResults": 2, "total": 2, "startAt": 0
        }
      }
    },
    {
      "id": "10003",
      "key": "KB-3",
      "fields": {
        "summary": "Montant arrondi incorrect au centime près",
        "issuetype": { "id": "10004", "name": "Bug", "subtask": false, "hierarchyLevel": 0 },
        "project": { "id": "10000", "key": "KB", "name": "Kýdos Boutique" },
        "status": { "id": "10002", "name": "Done", "statusCategory": { "id": 3, "key": "done", "name": "Done", "colorName": "green" } },
        "priority": { "id": "1", "name": "Highest" },
        "resolution": { "id": "10000", "name": "Done" },
        "resolutiondate": "2026-09-03T14:31:00.000+0200",
        "assignee": { "accountId": "712020:2b3c4d5e-0000-4000-8000-000000000b0b", "displayName": "Bob Leroy", "active": true },
        "reporter": { "accountId": "712020:1a2b3c4d-0000-4000-8000-00000000a11c", "displayName": "Alice Durand", "emailAddress": "alice.durand@example.com", "active": true },
        "created": "2026-07-20T15:15:00.000+0200",
        "updated": "2026-09-03T14:31:00.000+0200",
        "duedate": null,
        "versions": [ { "id": "10099", "name": "0.9.0", "archived": false, "released": true, "releaseDate": "2026-07-15" } ],
        "fixVersions": [ { "id": "10100", "name": "1.0.0", "archived": false, "released": false, "releaseDate": "2026-09-30" } ],
        "components": [ { "id": "10200", "name": "API" } ],
        "labels": [ "paiement" ],
        "parent": { "id": "10001", "key": "KB-1", "fields": { "summary": "Paiement en ligne", "issuetype": { "name": "Epic", "hierarchyLevel": 1 } } },
        "description": { "type": "doc", "version": 1, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Le total affiche 19,99 € au lieu de 20,00 €." } ] } ] },
        "environment": { "type": "doc", "version": 1, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Chrome 128 / Windows 11" } ] } ] },
        "timeoriginalestimate": 7200,
        "timeestimate": 0,
        "timespent": 5400,
        "aggregatetimeoriginalestimate": 7200,
        "customfield_10016": 2,
        "customfield_10020": [
          { "id": 1, "name": "KB Sprint 1", "state": "closed", "boardId": 1, "goal": "Paiement carte de bout en bout", "startDate": "2026-08-24T07:00:00.000Z", "endDate": "2026-09-04T15:00:00.000Z", "completeDate": "2026-09-04T15:10:00.000Z" }
        ],
        "comment": {
          "comments": [
            { "id": "20003", "author": { "accountId": "712020:2b3c4d5e-0000-4000-8000-000000000b0b", "displayName": "Bob Leroy" }, "created": "2026-09-03T14:30:00.000+0200", "updated": "2026-09-03T14:30:00.000+0200",
              "body": { "type": "doc", "version": 1, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Cause : arrondi flottant; corrigé avec des " }, { "type": "text", "text": "centimes entiers", "marks": [ { "type": "strong" } ] }, { "type": "text", "text": "." } ] } ] } }
          ],
          "maxResults": 1, "total": 1, "startAt": 0
        }
      }
    },
    {
      "id": "10004",
      "key": "KB-4",
      "fields": {
        "summary": "Écrire les tests 3-D Secure",
        "issuetype": { "id": "10003", "name": "Sub-task", "subtask": true, "hierarchyLevel": -1 },
        "project": { "id": "10000", "key": "KB", "name": "Kýdos Boutique" },
        "status": { "id": "10001", "name": "To Do", "statusCategory": { "id": 2, "key": "new", "name": "To Do", "colorName": "blue-gray" } },
        "priority": { "id": "3", "name": "Medium" },
        "resolution": null,
        "resolutiondate": null,
        "assignee": { "accountId": "712020:2b3c4d5e-0000-4000-8000-000000000b0b", "displayName": "Bob Leroy", "active": true },
        "reporter": { "accountId": "712020:1a2b3c4d-0000-4000-8000-00000000a11c", "displayName": "Alice Durand", "emailAddress": "alice.durand@example.com", "active": true },
        "created": "2026-09-07T10:02:00.000+0200",
        "updated": "2026-09-07T10:02:00.000+0200",
        "duedate": "2026-09-15",
        "versions": [],
        "fixVersions": [ { "id": "10100", "name": "1.0.0", "archived": false, "released": false, "releaseDate": "2026-09-30" } ],
        "components": [],
        "labels": [],
        "parent": { "id": "10002", "key": "KB-2", "fields": { "summary": "Payer par carte", "issuetype": { "name": "Story", "hierarchyLevel": 0 } } },
        "description": null,
        "environment": null,
        "timeoriginalestimate": 7200,
        "timeestimate": 7200,
        "timespent": null,
        "aggregatetimeoriginalestimate": 7200,
        "customfield_10016": null,
        "customfield_10020": [
          { "id": 2, "name": "KB Sprint 2", "state": "active", "boardId": 1, "goal": "3-D Secure et corrections", "startDate": "2026-09-07T07:00:00.000Z", "endDate": "2026-09-18T15:00:00.000Z" }
        ],
        "comment": { "comments": [], "maxResults": 0, "total": 0, "startAt": 0 }
      }
    },
    {
      "id": "10005",
      "key": "KB-5",
      "fields": {
        "summary": "Configurer le webhook Stripe",
        "issuetype": { "id": "10002", "name": "Task", "subtask": false, "hierarchyLevel": 0 },
        "project": { "id": "10000", "key": "KB", "name": "Kýdos Boutique" },
        "status": { "id": "10001", "name": "To Do", "statusCategory": { "id": 2, "key": "new", "name": "To Do", "colorName": "blue-gray" } },
        "priority": { "id": "4", "name": "Low" },
        "resolution": null,
        "resolutiondate": null,
        "assignee": null,
        "reporter": { "accountId": "5f8a9b0c1d2e3f0012345678", "displayName": "Carole Martin", "emailAddress": "carole.martin@example.com", "active": true },
        "created": "2026-09-10T08:45:00.000+0200",
        "updated": "2026-09-11T18:10:00.000+0200",
        "duedate": null,
        "versions": [],
        "fixVersions": [ { "id": "10101", "name": "1.1.0", "archived": false, "released": false, "releaseDate": "2026-10-30" } ],
        "components": [ { "id": "10200", "name": "API" } ],
        "labels": [ "stripe" ],
        "parent": { "id": "10001", "key": "KB-1", "fields": { "summary": "Paiement en ligne", "issuetype": { "name": "Epic", "hierarchyLevel": 1 } } },
        "description": {
          "type": "doc", "version": 1,
          "content": [
            { "type": "heading", "attrs": { "level": 3 }, "content": [ { "type": "text", "text": "Contexte" } ] },
            { "type": "paragraph", "content": [ { "type": "text", "text": "Recevoir les événements " }, { "type": "text", "text": "payment_intent.succeeded", "marks": [ { "type": "strong" } ] }, { "type": "text", "text": "." } ] },
            { "type": "bulletList", "content": [
              { "type": "listItem", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Vérifier la signature" } ] } ] },
              { "type": "listItem", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Rejouer en cas d'échec (\"retry\")" } ] } ] }
            ] }
          ]
        },
        "environment": null,
        "timeoriginalestimate": 14400,
        "timeestimate": 14400,
        "timespent": null,
        "aggregatetimeoriginalestimate": 14400,
        "customfield_10016": 3,
        "customfield_10020": [
          { "id": 3, "name": "KB Sprint 3", "state": "future", "boardId": 1, "goal": "Webhooks et historique", "startDate": "2026-09-21T07:00:00.000Z", "endDate": "2026-10-02T15:00:00.000Z" }
        ],
        "comment": { "comments": [], "maxResults": 0, "total": 0, "startAt": 0 }
      }
    },
    {
      "id": "10006",
      "key": "KB-6",
      "fields": {
        "summary": "Historique des paiements",
        "issuetype": { "id": "10001", "name": "Story", "subtask": false, "hierarchyLevel": 0 },
        "project": { "id": "10000", "key": "KB", "name": "Kýdos Boutique" },
        "status": { "id": "10000", "name": "Backlog", "statusCategory": { "id": 2, "key": "new", "name": "To Do", "colorName": "blue-gray" } },
        "priority": { "id": "5", "name": "Lowest" },
        "resolution": null,
        "resolutiondate": null,
        "assignee": null,
        "reporter": { "accountId": "5f8a9b0c1d2e3f0012345678", "displayName": "Carole Martin", "emailAddress": "carole.martin@example.com", "active": true },
        "created": "2026-09-11T09:00:00.000+0200",
        "updated": "2026-09-11T09:00:00.000+0200",
        "duedate": null,
        "versions": [],
        "fixVersions": [ { "id": "10101", "name": "1.1.0", "archived": false, "released": false, "releaseDate": "2026-10-30" } ],
        "components": [ { "id": "10201", "name": "Web" } ],
        "labels": [],
        "description": { "type": "doc", "version": 1, "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Afficher la liste des paiements du client." } ] } ] },
        "environment": null,
        "timeoriginalestimate": null,
        "timeestimate": null,
        "timespent": null,
        "aggregatetimeoriginalestimate": null,
        "customfield_10016": 8,
        "customfield_10020": null,
        "comment": { "comments": [], "maxResults": 0, "total": 0, "startAt": 0 }
      }
    }
  ]
}
```

### 7.3 `board-sprints.json` (réponse `GET /rest/agile/1.0/board/1/sprint`)

```json
{
  "maxResults": 50,
  "startAt": 0,
  "isLast": true,
  "values": [
    { "id": 1, "self": "https://example.atlassian.net/rest/agile/1.0/sprint/1", "state": "closed", "name": "KB Sprint 1", "startDate": "2026-08-24T07:00:00.000Z", "endDate": "2026-09-04T15:00:00.000Z", "completeDate": "2026-09-04T15:10:00.000Z", "createdDate": "2026-08-20T09:00:00.000Z", "originBoardId": 1, "goal": "Paiement carte de bout en bout" },
    { "id": 2, "self": "https://example.atlassian.net/rest/agile/1.0/sprint/2", "state": "active", "name": "KB Sprint 2", "startDate": "2026-09-07T07:00:00.000Z", "endDate": "2026-09-18T15:00:00.000Z", "createdDate": "2026-09-01T09:00:00.000Z", "originBoardId": 1, "goal": "3-D Secure et corrections" },
    { "id": 3, "self": "https://example.atlassian.net/rest/agile/1.0/sprint/3", "state": "future", "name": "KB Sprint 3", "startDate": "2026-09-21T07:00:00.000Z", "endDate": "2026-10-02T15:00:00.000Z", "createdDate": "2026-09-10T09:00:00.000Z", "originBoardId": 1, "goal": "Webhooks et historique" }
  ]
}
```

### 7.4 `project-versions.json` (réponse `GET /rest/api/3/project/KB/versions`)

```json
[
  { "self": "https://example.atlassian.net/rest/api/3/version/10099", "id": "10099", "name": "0.9.0", "description": "Bêta privée", "archived": false, "released": true, "releaseDate": "2026-07-15", "userReleaseDate": "15/Jul/26", "projectId": 10000 },
  { "self": "https://example.atlassian.net/rest/api/3/version/10100", "id": "10100", "name": "1.0.0", "description": "Lancement public", "archived": false, "released": false, "startDate": "2026-08-24", "releaseDate": "2026-09-30", "overdue": false, "userStartDate": "24/Aug/26", "userReleaseDate": "30/Sep/26", "projectId": 10000 },
  { "self": "https://example.atlassian.net/rest/api/3/version/10101", "id": "10101", "name": "1.1.0", "archived": false, "released": false, "releaseDate": "2026-10-30", "overdue": false, "userReleaseDate": "30/Oct/26", "projectId": 10000 }
]
```

### 7.5 Résultats attendus

Conditions :
- import dans un projet Kýdos `KB` **nouvellement créé** (taxonomies par défaut, `Counter` à 0) ;
- `timezone: 'Europe/Paris'`, `hoursPerDay: 8`, `mode: 'upsert'`, correspondances pré-remplies acceptées ;
- un seul utilisateur Kýdos pertinent : `Alice Durand` (`alice.durand@example.com`) ; Bob et Carole n'existent pas.

**Taxonomies**

| Kind | Attendu (CSV §7.1) | Différences avec le JSON (§7.2 + §7.3 + §7.4) |
|---|---|---|
| status | `In Progress` donne `onprocess`, `Done` donne `finished`, `To Do` donne `pending`, `Backlog` donne `draft` ; aucune création | idem |
| priority | `Highest` P0, `High` P1, `Medium` P2, `Low` P3, `Lowest` P3 (+ `PRIORITY_MERGED`) | idem |
| type | créés : `epic` (isEpic), `story`, `task`, `subtask` (isSubtask) ; `Bug` donne `bug` existant | idem (`hierarchyLevel` renseigné depuis le JSON) |
| sprint | `kb-sprint-1` finished, `kb-sprint-2` active, `kb-sprint-3` draft ; `stateSource: 'heuristic'`, dates `null`, 3 × `SPRINT_DATES_MISSING` | mêmes clés ; `stateSource: 'jira'`, `jiraId` 1/2/3, dates, `goal`, `completeDate` pour le sprint 1 |
| version | `0.9.0`, `1.0.0`, `1.1.0` créées ; `released` inconnu (`VERSION_META_MISSING`) | `0.9.0` `released: true` (2026-07-15) ; `1.0.0` 2026-09-30 ; `1.1.0` 2026-10-30 |
| component | `api`, `web` | idem (+ `jiraId`) |
| Project | `currentSprint = 'kb-sprint-2'`, `Counter.KB = 6` | idem |

**Tâches** (valeurs identiques en CSV et en JSON sauf mention)

| taskId | externalKey / Id | type | status | priority | sprint | sprintHistory | carryOver | complexity | estimate / duration | version / fixVersions | parent / epic | assignee | autres |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `KB-001` | KB-1 / 10001 | epic | onprocess | P1 | `null` | `[]` | 0 | 0 | `''` / `''` | 1.0.0 / [1.0.0] | null / null | `null`, `externalAssignee.displayName` = Carole Martin | labels [paiement], components [api], dueDate 2026-09-30 |
| `KB-002` | KB-2 / 10002 | story | onprocess | P2 | `kb-sprint-2` | [kb-sprint-1, kb-sprint-2] | 1 | 5 | `1j` / `4h` | 1.0.0 / [1.0.0, 1.1.0] | KB-001 / KB-001 | Alice (CSV : `name` ; JSON : `email`) | labels [paiement, front], components [api, web], timeRemainingSec 14400, 2 commentaires (1er auteur Alice, 2e `authorLabel` Carole Martin) |
| `KB-003` | KB-3 / 10003 | bug | finished | P0 | `kb-sprint-1` | [kb-sprint-1] | 0 | 2 | `2h` / `1h 30min` | 1.0.0 / [1.0.0] | KB-001 / KB-001 | `null`, externe Bob Leroy | affectsVersions [0.9.0], resolution Done, resolvedAt `2026-09-03T12:31:00.000Z`, description se terminant par `Environnement : Chrome 128 / Windows 11`, 1 commentaire (texte contenant `;`) |
| `KB-004` | KB-4 / 10004 | subtask | pending | P2 | `kb-sprint-2` | [kb-sprint-2] | 0 | 0 | `2h` / `''` | 1.0.0 / [1.0.0] | KB-002 / KB-001 | `null`, externe Bob Leroy | dueDate 2026-09-15 |
| `KB-005` | KB-5 / 10005 | task | pending | P3 | `kb-sprint-3` | [kb-sprint-3] | 0 | 3 | `4h` / `''` | 1.1.0 / [1.1.0] | KB-001 / KB-001 | `null`, pas d'externe | labels [stripe] ; description normalisée `contexte recevoir les événements paymentintent.succeeded. vérifier la signature rejouer en cas d'échec ("retry")` |
| `KB-006` | KB-6 / 10006 | story | draft | P3 | `null` | `[]` | 0 | 8 | `''` / `''` | 1.1.0 / [1.1.0] | null / null | `null` | components [web] |

Dates : `KB-002.createdAt = 2026-07-02T09:30:00.000Z` et `updatedAt = 2026-09-12T07:41:00.000Z` (CSV et JSON identiques). Reporter : Alice pour KB-003 et KB-004 ; l'utilisateur importateur (avec `externalReporter` = Carole Martin) pour les autres.

Rapport CSV attendu : `created 6, updated 0, unchanged 0, errors 0`. Avertissements : `PRIORITY_MERGED` (ligne 6), `SPRINT_STATE_GUESSED` ×3, `SPRINT_DATES_MISSING` ×3, `VERSION_META_MISSING` ×3.

### 7.6 Cas de test à écrire (`server/test/import/*.test.js`)

Unitaires (sans base) :
1. `parseCsv` : 7 lignes, 40 colonnes, cellule multi-lignes de KB-5 et `""` restitué en `"`.
2. `normalizeHeader` et alias : `Fix Version/s` = `Fix versions`, `Custom field (Story Points)` donne `cf:story points`, `Σ Original estimate` ignoré, `Work type` = `Issue Type`.
3. Dates : `14/Sep/26 9:05 AM`, `01/Jul/26 12:00 AM` (minuit), `04/Sep/26 12:20 PM`, `30/Sep/26`, `2026-09-14T09:05:12.345+0200`, heure d'été (`zonedToUtc(2026,2,29,2,30,'Europe/Paris')` sans exception), valeur invalide donne `null` + avertissement.
4. `secondsToDuration` et `parseDurationToSeconds` : table §1.2.7, aller-retour.
5. `parseCommentCell` : texte avec `;`, cellule sans métadonnées.
6. `adfToText` et `wikiToText` : équivalence normalisée sur KB-5 ; bloc `{code}` contenant `* pas une liste` intact.
7. `parseLegacySprint` : `com.atlassian.greenhopper.service.sprint.Sprint@1bf75fd[id=1,rapidViewId=1,state=CLOSED,name=Sprint 1, équipe A,startDate=2026-08-24T09:00:00.000+02:00,endDate=<null>,completeDate=<null>,sequence=1,goal=]` (nom contenant une virgule).
8. `assignSprint` : KB-2 (actif + clos), KB-3 (clos + terminé), issue non terminée avec uniquement des sprints clos (backlog, `carryOverCount` 2 pour deux sprints).
9. Heuristique §2.4.3 sur la fixture CSV : 1 clos, 2 actif, 3 futur.
10. `primaryVersion` : `[1.0.0, 1.1.0]` non livrées donne `1.0.0` ; toutes livrées donne la plus récente.
11. Détection §1.5 : les 4 fixtures, un XML (`UNSUPPORTED_FORMAT`), un CSV non Jira (`CSV_NOT_JIRA`).
12. `plan` : mêmes compteurs et identifiants pour CSV et JSON ; plan identique entre dry-run et exécution (`planHash`).

Intégration (API + Mongo, via `server/test/helpers.js`) :
13. Import CSV dans `KB` vierge : résultats §7.5 ; 403 pour un `developer`.
14. **Idempotence** : second import du même CSV donne `unchanged: 6`, aucun commentaire dupliqué, `Counter` inchangé.
15. **CSV puis JSON** : `updated` ne concerne que les champs issus du JSON (dates de sprints en taxonomie, `jiraId`) ; commentaires rapprochés par empreinte (KB-3 : texte en gras en JSON, même empreinte) et `externalId` remplacé.
16. **Fusion à trois voies** : après import, modification locale de `KB-006.priority` en `P1`, modification de `Lowest` en `Low` dans le fichier, ré-import : conflit signalé ; `P3` appliqué avec `conflictPolicy: 'jira'`, `P1` conservé avec `'kydos'`. Modification locale seule (fichier inchangé) : conservée sans conflit.
17. **Renumérotation** : import dans `DEMO` (`Counter` 12) donne `DEMO-013` à `DEMO-018`, `DEMO-014.parent = 'DEMO-013'`, `DEMO-016` (sous-tâche KB-4) a `parent` `DEMO-014` et `epic` `DEMO-013`.
18. **Collision** : `KB` contenant `KB-002` manuelle donne KB-2 en `KB-007` et `Counter` = 7.
19. **Mode `create`** : ré-import donne `skip: 6`.
20. **Annulation** : rollback supprime les 6 tâches et les taxonomies créées ; une tâche modifiée après l'import est conservée (`ROLLBACK_SKIPPED_MODIFIED`).
21. Limites : `content` de 21 Mo donne 413 ; 10 001 issues donne `TOO_MANY_ISSUES` ; deux imports simultanés donnent 409.
22. Export §5.3 : aller-retour.

Scrum :
23. Démarrage : sprint sans objectif donne 400 ; snapshot `committedPoints` = Σ points non terminés.
24. Clôture : un ajout en cours de sprint, un retrait, une ré-estimation ; vérification de chaque métrique §6.1.4 ; report vers le sprint suivant avec historique et `carryOverCount`.
25. Burndown : scénario daté (dates d'historique injectées) ; `remaining`, `completed` et `scope` jour par jour ; ligne idéale.
26. Vélocité : 3 sprints (10, 14, 12) donnent `average` 12, `median` 12, `min` 10, `max` 14.
27. DoD `block` : 409 ; `forceDod` superadmin avec note donne une entrée `history{field:'dod'}`.
28. Poker : votes masqués pendant le vote ; `[3,5,5]` donne `near` et `suggested` 5 ; `[2,8]` donne `none` et `outliers`.
29. Alertes : `WIP_LIMIT`, `CARRY_OVER_REPEAT`, `OVERCOMMIT` (non calculée avec moins de 2 sprints).

---

## 8. Incertitudes et vérifications à faire sur un export réel

Avant de figer le parseur, demander au propriétaire **un export CSV « All fields » et un export JSON réels** (anonymisés) de son instance, et vérifier les points suivants. Chaque point est déjà couvert par une tolérance dans la spécification.

| # | Incertitude | Tolérance prévue |
|---|---|---|
| U1 | Casse et libellés exacts des en-têtes Cloud en 2026 (`Original estimate` ou `Original Estimate`) et effet du renommage « issue » en « work item » (`Work type`, `Work item key`) | Normalisation insensible à la casse et alias §1.2.4 |
| U2 | Présence de `Status Category` en CSV DC et « current fields » | Déduction §2.3.1 (`STATUS_CATEGORY_GUESSED`) |
| U3 | Colonnes de parenté : Cloud `Parent` (Issue id) + `Parent summary` ; existence de `Parent key` / `Parent id` selon version ; `Epic Link` sur les instances non migrées | Détection id ou clé, alias multiples §2.6 |
| U4 | Format de date : dépend de la configuration d'instance et peut-être de la langue de l'utilisateur (mois localisés) | Détection par fichier, dictionnaire FR, choix manuel §1.2.6 |
| U5 | Auteur des commentaires CSV : accountId (Cloud) ou username (DC) | Rapprochement par `ref` générique §2.7 |
| U6 | Fidélité de la conversion ADF vers wiki dans le CSV Cloud | Conversion tolérante §1.2.9, texte brut en dernier recours |
| U7 | Ordre des colonnes `Sprint` supposé chronologique | Heuristique signalée et éditable §2.4.3 ; JSON sprints recommandé |
| U8 | Identifiants des champs personnalisés (`customfield_10020`, `10016`) variables | `names`, forme de valeur, choix manuel §1.3.3 |
| U9 | `emailAddress` masqué par les réglages de confidentialité | Rapprochement par nom et correspondance mémorisée |
| U10 | Bugs de pagination de `/search/jql` ; troncature de `expand=changelog` et des commentaires | Garde anti-boucle du script ; `COMMENTS_TRUNCATED` |
| U11 | Structure XML exacte (noms d'éléments et attributs) | XML non supporté en V1 |
| U12 | Découpage des valeurs multiples dans les exports « current fields » | Découpage des labels seulement §1.2.5 |
| U13 | Import de sprint par **nom** dans l'importeur CSV Jira (export §5) ; rapprochement des utilisateurs par e-mail | Documenté comme non garanti |
| U14 | Séparateur configurable en DC ; encodage windows-1252 après passage par Excel | Détection du délimiteur, avertissement d'encodage |
| U15 | Colonnes `Flagged`, liens d'issues et `Attachment` : format exact | Ignorées ou optionnelles en V1 |
| U16 | Mongoose : `createdAt` des sous-documents (commentaires) conservé ou écrasé lors d'un `push` | `timestamps: false`, test d'intégration 13 |
| U17 | Mongo sans replica set (pas de transactions) à confirmer dans `docker-compose.yml` | Stratégie sans transaction + annulation compensatoire |

## 9. Sources consultées

Documentation Atlassian :
- Export CSV depuis Jira Cloud (All fields / Current fields, un commentaire par colonne `Comment`) : https://support.atlassian.com/jira/kb/how-to-export-issues-from-jira-cloud-in-csv-format/
- Import de données CSV (en-têtes répétés pour les valeurs multiples, commentaires `date;accountId;texte`, estimations en secondes, hiérarchie par `Parent` = id) : https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/
- Questions CSV courantes (formats de date, `yyyy-MM-dd HH:mm:ss` pour les champs système à l'import) : https://support.atlassian.com/jira-cloud-administration/docs/common-csv-file-questions-and-known-issues/
- Format date/heure des exports (*Apparence > Formats de date/heure*, SimpleDateFormat) : https://support.atlassian.com/jira/kb/incorrect-date-time-format-in-exported-issues/
- Incohérence des dates CSV dans Excel et Google Sheets (JRACLOUD-67150) : https://jira.atlassian.com/browse/JRACLOUD-67150
- Estimations exportées en secondes : https://support.atlassian.com/jira/kb/time-estimate-fields-are-showing-values-in-seconds-in-the-exported-csv-excel-instead-of-w-d-h-m-format/
- Calcul de l'Original Estimate (8 h/jour, 100 800 s pour « 3d 4h ») : https://support.atlassian.com/jira/kb/understand-how-the-original-estimate-field-value-is-calculated-when-viewing-the-data-export-in-jira-cloud/
- Commentaires avec auteur et date à l'import CSV (`31/Mar/24 6:49 AM;<accountId>;texte`) : https://support.atlassian.com/jira/kb/how-to-import-comments-with-author-and-date-using-the-csv-importer/ et https://confluence.atlassian.com/jirakb/how-to-export-issue-and-comment-in-csv-with-proper-format-to-import-in-jira-741934059.html
- Conservation de la hiérarchie à l'import CSV (colonne `Parent` = Issue id numérique, `Epic Link` déprécié) : https://support.atlassian.com/jira/kb/keep-issue-parent-child-mapping-during-csv-import-to-jira-cloud/
- Sprint exporté par nom uniquement (JRASERVER-65781) : https://jira.atlassian.com/browse/JRASERVER-65781
- Représentation JSON des sprints (fin du format toString) : https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-tostring-representation-of-sprints-in-get-issue-response/
- API REST v3, recherche d'issues (`/search/jql`) : https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
- API Agile, boards et sprints (page consultée mais tronquée : structure confirmée par la source Mike Bowler) : https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/
- API versions de projet (page consultée mais tronquée : exemple de réponse reconstitué, **à vérifier**) : https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-versions/
- Export des résultats de recherche (formats disponibles, dont XML) : https://support.atlassian.com/jira-software-cloud/docs/export-search-results/
- `isLast` sur la recherche JQL améliorée (JRACLOUD-94648) : https://jira.atlassian.com/browse/JRACLOUD-94648

Communauté et tiers :
- Retrait de `/rest/api/2|3/search` (410 Gone) et migration vers `/search/jql` : https://community.atlassian.com/forums/Jira-questions/When-are-JQL-search-endpoints-rest-api-2-search-and-rest-api-3/qaq-p/3029221
- Sprints dans l'API (champ `customfield_10020`, réponse `/board/{id}/sprint`, `endDate` / `completeDate`, noms avec virgules) : https://blog.mikebowler.ca/2026/01/29/jira-api-sprints/
- Pièges de l'export CSV (en-têtes dupliqués, `Assignee Id`, `Custom field (Story Points)` / `Story point estimate`, plafonds 1 000 / 10 000) : https://scrumpy.it/blog/export-jira-issues-to-csv
- Structure XML RSS (exemple minimal) : https://docs.roost.ai/books/export-jira-ticket-in-xml/export/html
- Mapping Parent / Epic à l'import CSV : https://community.atlassian.com/forums/Jira-questions/CSV-Uploader-Import-Wizard-Mapping-Parent-Epic-properly/qaq-p/2944884

Vus uniquement dans des résultats de recherche (non ouverts) : https://community.developer.atlassian.com/t/jira-server-rest-api-string-representation-of-sprint-field/45871 (format toString des sprints en Server), https://jira.atlassian.com/browse/JRASERVER-71512 (export XML et navigateurs).

Éléments issus de l'expérience, sans source consultée et marqués **[INCERTAIN]** dans le texte : noms d'éléments XML, format des colonnes de liens, `Log Work` et `Attachment`, mois localisés dans les exports, limite de `expand=changelog`.
