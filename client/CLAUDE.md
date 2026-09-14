# client/ — SPA React + TypeScript

## Structure

```
src/
  main.tsx, App.tsx        providers et routes (board, dashboards/:id?, events, tasks/:id, settings/:tab?, admin/users)
  types.ts                 types partagés (miroir des modèles serveur)
  api/                     client.ts (api, ApiError{status, code, body}), invalidate.ts (useInvalidateProject), download.ts,
                           hooks : projects, tasks, taxonomies, filters, sprints, versions, members, dashboards (+ useAnalytics), imports, users, events
  hooks/useProjectRole.ts  rôle effectif (isAdmin, canWrite, isViewer, isArchived)
  pages/                   BoardPage, DashboardPage, EventsPage, TaskPage, ProjectSettingsPage, AdminPage (utilisateurs), ProjectsPage, LoginPage
  components/Board/        GroupedBoard, JiraBoard, ListBoard, Filters (dropdowns + jetons), SavedFiltersBar, GroupStats
  components/Dashboard/    Widgets (rendu + sourceBody), WidgetConfigModal, layout (collisions/compactage), registry
  components/Charts/       VerticalBars, HorizontalBars, Donut, LineChart, GroupedBars (SVG maison)
  components/ProjectSettings/  GeneralTab, SprintsTab, VersionsPanel, MembersTab, WorkflowTab, ImportExportTab, DangerZoneTab, ReplaceValueDialog
  components/Admin/        TaxonomyAdmin, UsersAdmin
  utils/                   boardUrlState, status (catégories, SPRINT_STATUS_META, rôles), dates, versions, format, useDebounced
  styles/                  themes.css (variables) + global.css (tout le style)
```

## Conventions

- Données serveur uniquement via react-query. Clés : `[ressource, projectKey, …]`. Après une action
  aux effets multiples (sprint, import, réaffectation), appeler `useInvalidateProject(projectKey)`.
- **Board** : l'état (vue, regroupement, tri, filtres, recherche, filtre enregistré) vit dans l'URL
  (`utils/boardUrlState.ts`) ; passer par `setBoard()` dans `BoardPage`.
- Droits : masquer / désactiver selon `useProjectRole` ; le serveur reste l'autorité (403/423).
- Erreurs : `errorMessage(e)` pour l'affichage, `e instanceof ApiError && e.code === '…'` pour les cas métier.
- Téléchargements authentifiés : `downloadFile(path, name)` (pas de lien direct).
- Couleurs / espacements : variables CSS de `themes.css` uniquement ; tout le style dans `global.css`.
- Dates de sprint / version (minuit UTC) : `toDateInput`, `fmtDay` ; `datetime-local` : `toLocalDateTimeInput`.
- Textes UI en français.

## Vérification

`npx tsc -b` propre, `npm run build` avant livraison. Pour valider un parcours d'interface, lancer
une API de test séparée et Vite avec `VITE_API_PROXY_TARGET` (jamais contre la base réelle).
