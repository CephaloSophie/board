# client/ — SPA React + TypeScript

## Structure

```
src/
  main.tsx, App.tsx        providers et routes (board, planning, activity, dashboards/:id?, events, tasks/:id, settings/:tab?, admin/users)
  types.ts                 types partagés (miroir des modèles serveur)
  api/                     client.ts (api, ApiError{status, code, body}), invalidate.ts (useInvalidateProject), download.ts,
                           hooks : projects, tasks (+ bulk, commentaires, réactions), taxonomies, filters, sprints (+ leftovers, setCurrent), versions,
                           members, dashboards (+ useAnalytics), imports, users, events, activity (infini), notifications, attachments (uploadImage)
  hooks/useProjectRole.ts  rôle effectif (isAdmin, canWrite, isViewer, isArchived)
  hooks/useProjectPeople.ts membres indexés (mentionLabel, userName)
  pages/                   BoardPage, PlanningPage, ActivityPage (journal), DashboardPage, EventsPage, TaskPage, ProjectSettingsPage, AdminPage, ProjectsPage, LoginPage
  components/Board/        GroupedBoard (moteur kanban partagé, dépôt entre groupes), JiraBoard, ListBoard, Filters, SavedFiltersBar, GroupStats
  components/common/       RichText (Markdown sûr), RichTextEditor (barre d'outils, images, @mentions), Avatar, LabelsInput
  components/Activity/     ActivityFeed (journal par jour, pagination)
  components/Layout/       Header, NotificationBell
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
- Descriptions / commentaires : toujours `RichText` pour afficher, `RichTextEditor` pour saisir.
- Notifications : `useNotifications` ne se recharge jamais seul (pas de polling) ; mettre à jour le cache localement.

## Vérification

`npx tsc -b` propre, `npm run build` avant livraison. Pour valider un parcours d'interface, lancer
une API de test séparée et Vite avec `VITE_API_PROXY_TARGET` (jamais contre la base réelle).
