# server/ — API Express + Mongoose

## Structure

```
src/
  index.js              montage (mount() = catchAsyncErrors), JSON 25 Mo sur /import, 404 /api, handler {error, code, missing}
  middleware/auth.js    requireAuth, requireRole (rôle global)
  middleware/project.js loadProject (req.project, req.projectRole), requireProjectRole, requireWriteAccess, blockWritesIfArchived
  models/               User, Project (members, access…), Taxonomy, Task, Event, Counter, SavedFilter, Dashboard, ImportJob
  routes/               auth, users, projects, members, taxonomies, sprints, versions, tasks, events,
                        savedFilters, dashboards, analytics, import, export
  utils/                taskQuery (filtres), taskHistory (historique), taxonomyMeta (catégories/meta),
                        duration, versions, asyncErrors, httpError, jwt, password
  analytics/timeline.js valueAt + sprintTimeline (burndown/burnup)
  dashboards/widgets.js catalogue, validation et modèles de widgets
  import/csv.js         CSV RFC 4180 (lecture/écriture)
  import/jira/          parseFiles, dates, markup, suggest, importer (runJiraImport, rollbackImport),
                        externalJson (format « systèmes externes » → JSON search ; CLI scripts/jira-convert.js)
  migrations/           2026-09-lot1.js (exporte migrate(), CLI via npm run migrate)
  seed/seed.js          tasks.json → projet KB (insert-only ; --overwrite pour réécrire)
test/
  helpers.js            startTestServer() : base *_test vidée, users admin/dev, client fetch
  fixtures/jira/        exports Jira de référence (CSV Cloud, JSON search, sprints, versions, external-system)
  *.test.js             api, csv, socle, migration, savedFilters, sprints, import, importExternal, dashboards
```

## Conventions

- Routeur projet : `Router({ mergeParams: true })` puis
  `router.use(requireAuth, loadProject, blockWritesIfArchived, requireWriteAccess)` ; ajouter
  `requireProjectRole('admin')` sur les routes d'administration. Monter avec `mount()` dans index.js.
- Handlers `async` sans try/catch (erreurs mappées : CastError/Validation → 400, doublon → 409).
  Erreurs métier : `throw httpError(status, 'CODE', 'message FR', extra)`.
- Sélection de tâches (liste, stats filtrées, export, analytics) : toujours via `compileTaskQuery`.
- Modification de champs suivis d'une tâche : `applyPatchWithHistory(task, patch, user, note, { categoryOf })`
  avec `categoryOf` issu de `statusContext(projectId)`.
- « Terminé » = catégorie de statut (`statusCategoryOf`), jamais une liste de clés en dur.
- `meta` de taxonomie : `mergeMeta` ; les clés de cycle de vie (sprint/version) ne s'écrivent que
  dans `sprints.routes.js` / `versions.routes.js` ; utiliser `markModified('meta')`.
- Payloads libres assainis (`sanitizeFilters`, `sanitizeWidgets`).
- Nouveau widget : l'ajouter à `REGISTRY` (`dashboards/widgets.js`), si besoin une route dans
  `analytics.routes.js`, puis côté client `registry.ts`, `Widgets.tsx`, `WidgetConfigModal.tsx`.

## Tests

`npm test` = `node --test --test-concurrency=1 "test/**/*.test.js"`. Chaque fichier démarre l'app
(port aléatoire) via `startTestServer()` et `ctx.client(token)` (`get/post/patch/put/del` →
`{ status, body, headers }`). Pour des données datées (historique, burndown), insérer avec
`Task.insertMany(docs, { timestamps: false })`. Ajouter un test pour chaque route créée.
