# Architecture de Kýdos Board

## Vue d'ensemble

```
client/ (React 18 + TS + Vite, react-query)  ──/api (proxy Vite :7001 → :7002)──▶  server/ (Express 4 + Mongoose 8)  ──▶  MongoDB
```

En production (Docker), le serveur sert aussi le build du client (`client/dist`).

## Serveur (`server/src`)

```
index.js                     montage : JSON 25 Mo pour /import, 2 Mo ailleurs ; routeurs via mount() (catchAsyncErrors) ; 404 /api ; erreurs {error, code}
config.js, db.js             env (server/.env), connexion (URI masquée)
middleware/auth.js           requireAuth (JWT), requireRole (rôle global)
middleware/project.js        loadProject (+ req.projectRole), requireProjectRole, requireWriteAccess, blockWritesIfArchived, projectRoleFor
models/                      User, Project, Taxonomy, Task, Event, Counter, SavedFilter, Dashboard, ImportJob
routes/                      auth, users, projects, members, taxonomies, sprints, versions, tasks, events, filters, dashboards, analytics, import, export
utils/taskQuery.js           compileTaskQuery(filters, ctx) : grammaire unique des filtres (jetons, catégories, dates relatives, recherche)
utils/taskHistory.js         applyPatchWithHistory : seule façon de modifier les champs suivis (historique + resolvedAt/statusChangedAt/durationHours)
utils/taxonomyMeta.js        catégories de statut, fusion de meta et clés réservées, statusContext(projectId)
utils/asyncErrors.js         capture des rejets async + mapping des erreurs Mongoose
analytics/timeline.js        valueAt(task, field, t) et sprintTimeline (burndown / burnup)
dashboards/widgets.js        catalogue et validation des widgets, modèles de dashboards
import/csv.js                parseur RFC 4180 + toCsv
import/jira/                 parseFiles (détection, CSV, JSON), dates, markup (ADF / wiki), suggest (correspondances), importer (plan + écriture + rollback)
migrations/2026-09-lot1.js   migration idempotente des données antérieures au Lot 1
seed/seed.js                 import de tasks.json (projet KB), n'écrase rien sans --overwrite
```

### Modèle de données

| Collection | Points clés |
|---|---|
| `Project` | `key` unique ; `access` (open / members) + `members[{user, role}]` ; `currentSprint` piloté par le cycle de vie ; timezone, workingDays, estimation, defaults ; archivage |
| `Taxonomy` | une collection pour `status, priority, area, type, techno, category, version, sprint, eventType` ; les tâches référencent la **clé** ; `meta` libre mais clés de cycle de vie réservées ; index unique `(project, kind, key)` |
| `Task` | champs métier + `labels, parent, components, fixVersions, affectsVersions, sprintHistory, dueDate, resolvedAt, statusChangedAt, durationHours` ; `external` (source, key, id, url, importJob, importHash) avec index unique partiel ; `comments[]` (auteur ou `authorLabel`, `externalId`, `parent`, `mentions`, `reactions[{emoji, users}]`) ; `history[]` (champs suivis, textes en extrait, événements `comment`) |
| `SavedFilter` | propriétaire, filtres assainis, vue / regroupement / tri, visibilité, `starredBy`, `defaultFor` |
| `Dashboard` | widgets `{id, type, layout, source, config}`, `globalFilters`, `revision` (concurrence optimiste) |
| `ImportJob` | fichiers (sha1), options, mapping, compteurs, lignes du rapport, tâches créées, valeurs avant / après des mises à jour, taxonomies créées |
| `Event` | rituel : type, sprint, participants, tâches liées, décisions, actions, ADR |
| `Counter` | séquence par projet pour les identifiants `KB-042` |
| `Activity` | journal projet : `at, actor, scope, action, taskId, field, from, to, note, sprints[], versions[], data` ; index `(project, at)`, `(project, actor)`, `(project, taskId)`, `(project, sprints)` |
| `Notification` | `user, project, type, taskId, commentId, actor, excerpt, read` ; index `(user, read, createdAt)` |
| `Attachment` | image binaire (`data`), `publicId` aléatoire unique, type vérifié, uploader, tâche |

### Mécanismes transverses

- **Accès** : `loadProject` calcule le rôle effectif ; un projet restreint répond 404 aux non-membres.
  Chaîne type d'un routeur projet : `requireAuth, loadProject, blockWritesIfArchived, requireWriteAccess`,
  puis `requireProjectRole('admin')` sur les routes d'administration.
- **Catégorie de statut** (`todo | inprogress | done`) : source de vérité de « terminé » pour les stats,
  la clôture de sprint, les burndowns, `resolvedAt` et les filtres `statusCategory`. Repli pour les
  données non migrées (`isDone`, clés historiques).
- **Historique** : chaque changement de champ suivi crée une entrée `{at, by, field, from, to, note}` ;
  les analyses reconstruisent l'état passé en remontant ces entrées (`valueAt`).
- **Cycle de vie de sprint** : écritures de `meta.status/startSnapshot/report` réservées à
  `sprints.routes.js` ; la clôture reporte d'abord les tâches (rejouable sans transaction), puis fige le rapport.
- **Import Jira** : `parseImportFiles` → bundle normalisé ; `runJiraImport` calcule tout le plan
  (correspondances, sprints, versions, identifiants, parents, valeurs mappées et hash) ; si
  `dryRun: false`, écrit dans l'ordre taxonomies → compteur → créations (`insertMany`,
  `timestamps: false`) → mises à jour (`applyPatchWithHistory`) → projet → job. Idempotence par
  `external.id / external.key` et `importHash`.
- **Journal et notifications** : les routes appellent `logActivity(taskActivities(...))` ou
  `projectActivity(...)` (`utils/activity.js`) après chaque écriture métier, et `notify()`
  (`utils/notify.js`, destinataires par priorité, jamais l'auteur, erreurs journalisées sans faire
  échouer l'action). `Task.history` reste la source des burndowns ; `Activity` couvre en plus le
  cycle de vie des sprints / versions, les imports et les actions groupées.
- **Texte riche** : Markdown restreint rendu en éléments React (`RichText.tsx`), URL filtrées
  (http(s), `/api/files/`, `/projects/…`), couleurs validées ; images stockées dans `Attachment`.
- **Analyses** : chaque partie de filtre (global, filtre enregistré, critères du widget) est compilée
  séparément puis combinée en `$and`.

## Client (`client/src`)

```
api/            client fetch (ApiError.code), hooks react-query par ressource, invalidate.ts, download.ts
hooks/          useProjectRole
pages/          Board, Dashboard, Events, Task, ProjectSettings, Admin (utilisateurs), Projects, Login
components/     Board (vues, Filters, SavedFiltersBar), Dashboard (grille, widgets, config, layout, registry),
                Charts (SVG), ProjectSettings (onglets), Admin (taxonomies, utilisateurs), Task, Event, Layout, common
utils/          boardUrlState (état du board ⇄ URL), status (catégories, rôles), dates, versions, format
styles/         themes.css (variables par thème) + global.css
```

- Toutes les données serveur passent par react-query ; les actions à effets multiples invalident le
  périmètre projet via `useInvalidateProject`. Les mutations de tâches invalident aussi `['analytics', projectKey]`.
- Le board n'a pas d'état local de filtres : l'URL est la source de vérité.
- Les droits UI viennent de `project.myRole` (`useProjectRole`) ; le serveur reste l'autorité.

## Tests et vérification

- `cd server && npm test` : `node:test`, un fichier = un processus = une base `*_test` vidée
  (`test/helpers.js`). Couvre API de base, socle (rôles, filtres, archivage, taxonomies), migration,
  filtres enregistrés, sprints / versions, import Jira (jeux `test/fixtures/jira/` issus de la spec),
  dashboards et analyses.
- `cd client && npx tsc -b && npm run build`.
- Parcours d'interface : validés avec Puppeteer (Chrome headless) sur une pile de test (API :7102
  sur une base e2e, Vite :7101 avec `VITE_API_PROXY_TARGET`), jamais sur la base réelle.

## Exploitation

- Ports : API 7002, client 7001 (dev). Docker : `docker compose up --build -d` (port 7002).
- Montée de version depuis une base antérieure au Lot 1 : `cd server && npm run migrate -- --dry-run`
  puis `npm run migrate` (idempotent).
- `node --watch` peut continuer à servir l'ancien code après l'ajout de nouveaux fichiers de routes :
  redémarrer le serveur après une mise à jour.
