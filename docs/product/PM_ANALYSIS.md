# Kýdos Board — Analyse produit et spécifications (Lot 1 et suivants)

| | |
|---|---|
| Date | 2026-09-14 |
| Base analysée | commit `6b90845` + travail non commité présent dans l'arbre de travail le 2026-09-14 (voir §1.4) |
| Statut | Proposition à valider par le propriétaire |
| Objectif produit | Offrir **plus que Jira** : import Jira, dashboard très flexible, admin projet complète, filtres sauvegardés par utilisateur |
| Contrainte | Aucune nouvelle dépendance lourde. Graphes en SVG maison. Stack inchangée (Express/Mongoose CommonJS, React 18/TS/Vite/react-query/dnd-kit) |

Conventions du document :
- Toutes les routes sont préfixées par `/api`. `:key` = clé projet (`KB`).
- Les erreurs gardent le format actuel `{ error: string }` ; on ajoute un champ `code` machine (`{ error, code }`) pour les cas métier listés.
- « Admin projet » = rôle projet `admin` (défini en §5.4) ; `superadmin` est toujours admin de tous les projets.
- MoSCoW : **M** Must, **S** Should, **C** Could, **W** Won't (pour l'instant).

---

## Sommaire

1. Inventaire des fonctionnalités actuelles
2. Analyse d'écart vs Jira
3. Spécification du Dashboard flexible
4. Spécification des filtres sauvegardés
5. Refonte de l'IHM d'administration du module projet (dont import Jira)
6. Roadmap priorisée et critères d'acceptation du Lot 1
- Annexe A — Évolutions de modèle communes
- Annexe B — Format des exports Jira et règles de conversion
- Annexe C — Migration des données existantes
- Annexe D — Points de vigilance

---

## 1. Inventaire des fonctionnalités actuelles

### 1.1 Architecture et données

| Élément | Réalité du code | Fichiers |
|---|---|---|
| API | Express, routes montées dans `index.js`, JWT Bearer, 2 rôles globaux | `server/src/index.js`, `server/src/middleware/auth.js` |
| Chargement projet | `loadProject` résout `:projectKey` → `req.project`, **sans vérifier l'archivage ni l'appartenance** | `server/src/middleware/project.js` |
| `User` | `username`, `displayName`, `role` (`superadmin`/`developer`), `color`, `active` (suppression douce) | `server/src/models/User.js` |
| `Project` | `key` unique, `name`, `vendor`, `description`, `owner`, `currentVersion` (texte libre), `complexityScale` (texte), `sprintDurationValue/Unit`, `currentSprint` (clé de sprint), `archived` | `server/src/models/Project.js` |
| `Taxonomy` | Collection unique, `kind` ∈ status/priority/area/type/techno/category/version/sprint/eventType, `key` immuable, `label`, `color`, `order`, `meta` libre, `archived`. Index unique `(project, kind, key)` | `server/src/models/Taxonomy.js` |
| `Task` | Champs dimension stockés **en clé texte** (status, priority, type, sprint…), `complexity` (points, coercition numérique), `estimate`/`duration` texte, `instructions[]`, `acceptance[]`, `assignee`/`reporter` (ObjectId), `comments[]` et `history[]` embarqués | `server/src/models/Task.js` |
| Historique | `applyPatchWithHistory` : 1 entrée par champ suivi modifié (title, status, priority, assignee, sprint, version, type, category, techno, area, complexity), note optionnelle | `server/src/utils/taskHistory.js` |
| `Event` | Rituel agile : type (taxonomie `eventType`), sprint, participants, tâches liées (note/outcome/presenter/order), agenda, décisions, actions, ADR | `server/src/models/Event.js`, `server/src/routes/events.routes.js` |
| `Counter` | Séquence par projet pour `KB-155` | `server/src/models/Counter.js` |
| Seed | Import unique de `tasks.json` (format maison) : taxonomies, versions, sprints déduits des versions (1 sprint = 1 version), tâches, historique de statut | `server/src/seed/seed.js`, `tasks.json` |

### 1.2 Fonctionnalités par domaine

| Domaine | Fonctionnalité | Fichiers |
|---|---|---|
| Auth | Login, `/auth/me`, token en `localStorage` | `server/src/routes/auth.routes.js`, `client/src/context/AuthContext.tsx`, `client/src/api/client.ts` |
| Projets | Liste (non archivés), création (superadmin) avec taxonomies par défaut, `PATCH` (superadmin, accepte `archived` mais aucune UI), `/stats` (total, terminées via `meta.isDone`, bugs = `type === 'bug'` codé en dur, points) | `server/src/routes/projects.routes.js`, `client/src/pages/ProjectsPage.tsx` |
| Board | 3 vues : `grouped` (mini-boards par groupe), `jira` (kanban par statut), `list` (tableau triable, tri en état local) | `client/src/pages/BoardPage.tsx`, `client/src/components/Board/GroupedBoard.tsx`, `JiraBoard.tsx`, `ListBoard.tsx` |
| Regroupement | Par sprint/version/catégorie/techno/domaine/type/priorité/statut/assigné/aucun, barre latérale des groupes, sprint courant mis en avant | `client/src/components/Board/groupUtils.ts`, `GroupSidebar.tsx` |
| Stats de groupe | Nb, points, heures, points à faire/en cours/terminés, non assignés. **En cours = liste de clés codée en dur** (`onprocess`, `needreview`, `needconfirmation`, `tested`) | `client/src/components/Board/GroupStats.tsx` |
| Filtres | Multi-sélection par dimension + assigné (dont `unassigned`) + recherche texte ; **état React local, perdu au rechargement** | `client/src/components/Board/Filters.tsx`, `client/src/types.ts` (`TaskFilters`) |
| API tâches | `GET /tasks` filtres `$in`, recherche **en mémoire après chargement complet**, pas de pagination, renvoie `comments` et `history` complets | `server/src/routes/tasks.routes.js` |
| KPIs | 5 tuiles fixes (total, terminées, bugs, points, vue filtrée) ; les 4 premières ignorent les filtres | `client/src/pages/BoardPage.tsx` |
| Tâche | Popup ou page dédiée, édition des champs, décalage sprint précédent/suivant, commentaires (édition/suppression par auteur ou superadmin), historique, suppression (**tout utilisateur**) | `client/src/components/Task/TaskDetail.tsx`, `CommentList.tsx`, `HistoryList.tsx`, `client/src/pages/TaskPage.tsx` |
| Drag & drop | Changement de statut par glisser-déposer, journalisé | `JiraBoard.tsx`, `GroupedBoard.tsx`, `StatusColumn.tsx` |
| Rituels | Liste filtrable par sprint/type, création, détail avec sections pilotées par `meta.features`, ajout rapide d'une tâche à un événement | `client/src/pages/EventsPage.tsx`, `client/src/components/Event/*`, `client/src/components/Task/AddToEventPopup.tsx` |
| Admin | Page à 3 onglets en état local : Taxonomies (CRUD, archivage, sprints avec statut/dates/objectif éditables librement, types d'événement), Utilisateurs (global, affiché dans l'admin **d'un projet**), Projet (formulaire) | `client/src/pages/AdminPage.tsx`, `client/src/components/Admin/TaxonomyAdmin.tsx`, `UsersAdmin.tsx`, `ProjectSettings.tsx` |
| Sprints | Création chaînée côté client (dates calculées dans `TaxonomyAdmin.add`), statut `draft/ready/active/finished` modifiable sans règle, `Project.currentSprint` indépendant du statut | `TaxonomyAdmin.tsx`, `ProjectSettings.tsx` |
| Thèmes | 4 thèmes | `client/src/context/ThemeContext.tsx`, `client/src/styles/themes.css` |

### 1.3 Constats techniques qui conditionnent la suite

1. **Deux sources de vérité** : `Project.currentSprint` et `sprint.meta.status === 'active'` peuvent diverger ; `status.meta.isDone` coexiste avec la liste codée en dur de `GroupStats.tsx`. Le seed marque `tested` comme terminé, les taxonomies par défaut non.
2. **`PATCH /taxonomies/:id` remplace `meta` en entier** : un client qui envoie un `meta` périmé écrase tout (bloquant pour stocker des instantanés de sprint).
3. **Aucun contrôle d'accès par projet**, aucun blocage des écritures sur un projet archivé.
4. **`GET /tasks` non scalable** : pas de pagination, recherche en mémoire, charge utile incluant l'historique complet. Acceptable pour ~150 tâches (`tasks.json` en contient 154), pas pour un import Jira de plusieurs milliers de tickets.
5. **Pas de backlog explicite** : la taxonomie par défaut crée un sprint `backlog` alors que `Task.sprint` accepte aussi `null`.
6. **Pas de dates métier** sur la tâche (résolution, échéance, dernier changement de statut) : le vieillissement et le temps de cycle doivent être reconstruits depuis `history`.
7. **Pas de champ étiquettes, parent/epic ou référence externe** sur `Task`, alors que `SavedFilter` (§1.4) prévoit déjà `labels`.

### 1.4 Travail en cours non commité (constaté le 2026-09-14)

Ces éléments existent dans l'arbre de travail mais pas dans `6b90845`. La spec s'aligne dessus :

| Élément | Contenu | Fichier |
|---|---|---|
| Modèle `SavedFilter` | `project`, `owner`, `name` (≤ 80, unique par propriétaire et projet), `description`, `filters` (nettoyé par `sanitizeFilters`), `view`, `groupBy`, `sort {key, dir}`, `visibility` `private`/`shared`, `starredBy[]`, `defaultFor[]` | `server/src/models/SavedFilter.js` |
| Routes filtres | `GET/POST /projects/:key/filters`, `PATCH/DELETE /:id` (propriétaire ou superadmin), `PUT /:id/star`, `PUT /:id/default` (un seul défaut par utilisateur et par projet) | `server/src/routes/savedFilters.routes.js` |
| Robustesse | `catchAsyncErrors` (les rejets async remontent au middleware d'erreur), mapping CastError→400, 11000→409, 404 JSON sur `/api/*` | `server/src/utils/asyncErrors.js`, `server/src/index.js` |
| Import | Limite JSON de 25 Mo **déjà réservée** au préfixe `/api/projects/:projectKey/import` (aucune route derrière pour l'instant) | `server/src/index.js` |
| Taxonomies | `GET ?includeArchived=1` | `server/src/routes/taxonomies.routes.js` |
| Tests | Harnais d'intégration `node --test` contre un vrai MongoDB (base dont le nom contient `test`), `npm test` | `server/test/helpers.js`, `api.test.js`, `savedFilters.test.js` |

Aucune dépendance n'a été ajoutée : la stratégie de tests du Lot 1 réutilise ce harnais.

---

## 2. Analyse d'écart vs Jira

### 2.1 Tableau d'écart

Légende « Kýdos aujourd'hui » : ✅ équivalent, 🟡 partiel, ❌ absent, ⭐ supérieur.

| # | Fonctionnalité | Jira Software (Cloud) | Kýdos aujourd'hui | Priorité | Lot |
|---|---|---|---|---|---|
| 1 | Import depuis Jira | N/A (import CSV d'autres outils, sans aperçu à blanc ni retour arrière) | ❌ (seed maison `tasks.json`) | **M** | 1 |
| 2 | Export du projet | CSV/Excel de recherche, export complet réservé à l'admin site | ❌ | **S** | 1 (JSON + CSV) |
| 3 | Filtres sauvegardés | Filtres JQL, favoris, partage | 🟡 backend en cours (§1.4), aucune UI | **M** | 1 |
| 4 | Valeurs dynamiques de filtre | `currentUser()`, `openSprints()`, `unreleasedVersions()` | ❌ | **M** | 1 |
| 5 | Langage de requête (JQL) | Oui | ❌ | **C** | 3 |
| 6 | Dashboards et gadgets | Dashboards partageables, ~20 gadgets, grille à colonnes fixes | ❌ (5 KPIs figés) | **M** | 1 (v1), 2 (v2) |
| 7 | Burndown / burnup de sprint | Rapport | ❌ | **M** | 1 |
| 8 | Vélocité | Rapport | ❌ | **M** | 1 |
| 9 | Diagramme de flux cumulé | Rapport | ❌ | **S** | 2 |
| 10 | Control chart / temps de cycle | Rapport | ❌ | **S** | 2 |
| 11 | Démarrer / clôturer un sprint, report des tickets non terminés | Oui | 🟡 statut éditable à la main, pas de report | **M** | 1 |
| 12 | Versions / releases (date, publiée) | Oui | 🟡 taxonomie `version` sans date ni statut | **M** | 1 |
| 13 | Rôles et membres de projet | Rôles, schémas de permissions | ❌ 2 rôles globaux | **M** | 1 (membres + 3 rôles) |
| 14 | Archivage / suppression de projet | Oui | 🟡 API `archived` sans UI ni blocage | **M** | 1 |
| 15 | Workflow : catégories de statut | To Do / In Progress / Done | 🟡 `meta.isDone` seulement | **M** | 1 |
| 16 | Workflow : transitions autorisées | Oui | ❌ | **S** | 2 |
| 17 | Limites WIP par colonne | Oui (board) | ❌ | **S** | 2 |
| 18 | Swimlanes | Par requête, assigné, epic, sous-tâches | ⭐ regroupement par **toute** dimension, avec stats par groupe | — | — |
| 19 | Vue backlog avec rang | Oui (glisser-déposer) | ❌ | **S** | 2 |
| 20 | Epics / hiérarchie parent-enfant | Oui | ❌ | **S** | 1 (champ `parent` stocké), 2 (UI) |
| 21 | Étiquettes (labels) | Oui | ❌ | **S** | 1 (champ + filtre) |
| 22 | Liens entre tickets | Bloque, duplique… | ❌ | **C** | 3 |
| 23 | Édition en masse | Oui | ❌ | **S** | 2 |
| 24 | Champs personnalisés | Oui, administration lourde | ⭐ taxonomies libres par projet avec `meta` | **C** (types de champ libres) | 3 |
| 25 | Historique des modifications | Oui | ✅ | — | — |
| 26 | Commentaires | Oui, @mentions | 🟡 sans mentions | **C** | 2 |
| 27 | Notifications / observateurs | E-mail, in-app | ❌ | **S** | 2 |
| 28 | Pièces jointes | Oui | ❌ | **C** | 3 |
| 29 | Suivi du temps (worklogs) | Oui | 🟡 `estimate`/`duration` en texte | **C** | 3 |
| 30 | Automatisation | Règles no-code | ❌ | **C** | 3 |
| 31 | Rituels agiles (refinement, démo, rétro, ADR) | ❌ (Confluence ou apps tierces) | ⭐ natif, relié aux tâches et aux sprints | — | — |
| 32 | Timeline / roadmap | Oui | ❌ | **C** | 3 |
| 33 | API tokens / webhooks | Oui | ❌ | **C** | 3 |
| 34 | Recherche plein texte performante | Oui | 🟡 en mémoire | **M** | 1 (socle) |
| 35 | Synchro Jira en direct (API) | N/A | ❌ | **W** pour l'instant | 3 |

### 2.2 Là où Kýdos dépasse déjà Jira

1. **Rituels intégrés** (`Event`) : refinement, grooming, point technique, ADR, préparation de démo, rétrospective, rattachés au sprint et aux tâches, avec sections configurables par type. Jira n'a rien de natif.
2. **Taxonomies libres par projet** : 8 dimensions de tâche éditables par l'admin, avec couleur, ordre, archivage et `meta`. Dans Jira, obtenir « techno » ou « domaine » demande un champ personnalisé, un écran et un schéma de contexte.
3. **Multi-boards groupés** : chaque groupe de n'importe quelle dimension devient un mini-board avec sa barre de stats. Les swimlanes Jira sont limitées et sans agrégat de points par groupe.
4. **Historique uniforme** sur tous les champs de dimension, y compris le sprint, ce qui permet de reconstruire burndown et vélocité sans table d'événements séparée.

### 2.3 Différenciateurs à construire pour dépasser Jira (inclus dans les specs)

| Différenciateur | Où |
|---|---|
| Import Jira avec **aperçu à blanc, mapping des valeurs, idempotence et retour arrière** | §5.7 |
| Filtres avec **jetons dynamiques** (`@me`, `@current`, `@open`, `@none`, dates relatives) et synchronisation URL complète | §4 |
| Widgets reliant **rituels et métriques** : résumé de sprint avec ses rituels, actions de rétro ouvertes | §3.3 |
| Clôture de sprint qui **crée la rétrospective** pré-remplie (tâches reportées, points livrés) | §5.5 |
| Dashboard avec **filtre global** et widgets qui en héritent (un seul dashboard sert tous les sprints) | §3.4 |
| Regroupement de widget par **n'importe quelle taxonomie**, y compris celles créées par l'admin | §3.3 |

---

## 3. Spécification du Dashboard flexible

### 3.1 Principes

- Un projet possède **plusieurs dashboards**. Chaque dashboard appartient à un utilisateur ; il est `private` ou `shared` (même vocabulaire que `SavedFilter`).
- Chaque utilisateur peut marquer des dashboards en favori et en choisir un par défaut par projet (même mécanique que `starredBy`/`defaultFor`).
- Grille de **12 colonnes**, lignes de hauteur fixe (`ROW_HEIGHT = 80px`). Chaque widget a `x, y, w, h` en unités de grille.
- Chaque widget a une **source de données** (filtre sauvegardé référencé, requête inline, ou héritage du filtre global) et une **config typée**.
- Tous les calculs lourds sont faits côté serveur (agrégations Mongo ou reconstruction depuis `history`) ; le client ne fait que dessiner en SVG.

### 3.2 Routes client et navigation

| Route | Écran |
|---|---|
| `/projects/:key/dashboards` | Redirige vers le dashboard par défaut de l'utilisateur, sinon le premier favori, sinon l'écran de choix de modèle |
| `/projects/:key/dashboards/:id` | Dashboard en lecture |
| `/projects/:key/dashboards/:id?edit=1` | Mode édition |

`client/src/components/Layout/Header.tsx` : ajouter l'entrée `Dashboards` entre `Board` et `Rituels`.

### 3.3 Catalogue des widgets

Tailles en unités de grille (`w × h`). « Source » : `query` signifie que le widget accepte une source de tâches (§3.4).

| `type` | Titre UI | Lot | Source | Taille par défaut / min | Rendu |
|---|---|---|---|---|---|
| `kpi` | Indicateur | 1 | query | 3×2 / 2×1 | Grand nombre, libellé, variation optionnelle, couleur par seuil |
| `breakdown` | Répartition | 1 | query | 4×4 / 3×3 | Barres verticales, barres horizontales, donut ou tableau |
| `sprintBurndown` | Burndown / burnup | 1 | sprint | 6×4 / 4×3 | Courbes SVG réel, idéal, périmètre |
| `velocity` | Vélocité | 1 | sprints clos | 6×4 / 4×3 | Barres groupées engagé / livré + ligne de moyenne |
| `workload` | Charge par assigné | 1 | query | 4×4 / 3×3 | Barres horizontales empilées par catégorie de statut, ligne de capacité |
| `taskList` | Liste de tâches | 1 | query (souvent un filtre sauvegardé) | 6×5 / 4×3 | Tableau compact, clic = `TaskModal` |
| `recentActivity` | Activité récente | 1 | query | 4×5 / 3×3 | Flux d'entrées d'historique |
| `sprintSummary` | Sprint en cours | 1 | sprint | 4×3 / 3×2 | Objectif, dates, jours restants, % livré, rituels du sprint |
| `aging` | Vieillissement | 2 | query | 6×4 / 4×3 | Histogramme par tranche d'âge + 10 plus anciennes |
| `cfd` | Flux cumulé | 2 | query + période | 8×4 / 6×3 | Aires empilées par statut |
| `matrix` | Tableau croisé | 2 | query | 6×4 / 4×3 | Dimension lignes × dimension colonnes (équivalent du gadget Jira « Two Dimensional Filter Statistics ») |
| `versionProgress` | Avancement des versions | 2 | versions | 4×4 / 3×2 | Barres de progression par version non publiée |
| `upcomingEvents` | Rituels à venir | 2 | events | 4×4 / 3×3 | Rituels des N prochains jours + actions de rétro ouvertes |
| `createdVsResolved` | Créées vs résolues | 2 | query + période | 6×4 / 4×3 | Deux courbes cumulées |
| `note` | Note | 2 | — | 4×2 / 2×1 | Texte (markdown minimal) |

#### Configuration par widget (`config`)

Types partagés :

```ts
type Metric = 'count' | 'points' | 'hours';
type Dimension = 'status' | 'statusCategory' | 'priority' | 'type' | 'category' | 'techno'
  | 'area' | 'version' | 'sprint' | 'assignee' | 'reporter' | 'labels';
```

| `type` | `config` | Valeurs par défaut |
|---|---|---|
| `kpi` | `{ metric: Metric \| 'avgCycleDays' \| 'openBugs'; compareTo: null \| 'previousSprint'; thresholds: { op: '>=' \| '<='; value: number; color: string }[]; suffix?: string }` | `{ metric: 'count', compareTo: null, thresholds: [] }` |
| `breakdown` | `{ groupBy: Dimension; splitBy: Dimension \| null; metric: Metric; chart: 'bar' \| 'hbar' \| 'donut' \| 'table'; topN: number; showEmpty: boolean; sort: 'taxonomy' \| 'valueDesc' }` | `{ groupBy: 'status', splitBy: null, metric: 'count', chart: 'bar', topN: 12, showEmpty: false, sort: 'taxonomy' }` |
| `sprintBurndown` | `{ sprint: string \| '@current'; unit: 'points' \| 'count'; mode: 'burndown' \| 'burnup'; showIdeal: boolean; showScope: boolean }` | `{ sprint: '@current', unit: 'points', mode: 'burndown', showIdeal: true, showScope: true }` |
| `velocity` | `{ last: number (1..20); unit: 'points' \| 'count'; showAverage: boolean }` | `{ last: 6, unit: 'points', showAverage: true }` |
| `workload` | `{ metric: Metric; capacityPerUser: number \| null; includeUnassigned: boolean }` | `{ metric: 'points', capacityPerUser: null, includeUnassigned: true }` |
| `taskList` | `{ columns: ('taskId'\|'title'\|'status'\|'priority'\|'assignee'\|'sprint'\|'version'\|'complexity'\|'updatedAt')[]; sort: { key: string; dir: 1 \| -1 }; limit: number (1..100) }` | `{ columns: ['taskId','title','status','assignee','complexity'], sort: { key: 'updatedAt', dir: -1 }, limit: 20 }` |
| `recentActivity` | `{ fields: string[]; limit: number (1..50) }` (champs d'historique, vide = tous) | `{ fields: [], limit: 20 }` |
| `sprintSummary` | `{ sprint: string \| '@current'; showEvents: boolean }` | `{ sprint: '@current', showEvents: true }` |
| `aging` | `{ statusCategory: ('todo'\|'inprogress')[]; buckets: number[] }` (bornes en jours) | `{ statusCategory: ['inprogress'], buckets: [2, 5, 10, 20] }` |
| `cfd` | `{ from: string; to: string; statuses: string[] }` (dates ISO ou relatives `-30d`, `@sprintStart`) | `{ from: '-30d', to: 'now', statuses: [] }` |
| `matrix` | `{ rows: Dimension; cols: Dimension; metric: Metric }` | `{ rows: 'assignee', cols: 'status', metric: 'count' }` |
| `versionProgress` | `{ versions: string[] \| '@unreleased'; unit: 'points' \| 'count' }` | `{ versions: '@unreleased', unit: 'points' }` |
| `upcomingEvents` | `{ days: number; types: string[]; showOpenActions: boolean }` | `{ days: 14, types: [], showOpenActions: true }` |
| `createdVsResolved` | `{ from: string; to: string; cumulative: boolean }` | `{ from: '-30d', to: 'now', cumulative: true }` |
| `note` | `{ text: string (≤ 5000) }` | `{ text: '' }` |

Validation serveur : `server/src/dashboards/widgetSchemas.js` exporte un validateur par `type` (fonctions JS pures, sans bibliothèque) qui applique les défauts, borne les nombres et rejette les clés inconnues. Type inconnu → `400 { code: 'WIDGET_TYPE_UNKNOWN' }`.

### 3.4 Modèle de données

Nouveau fichier `server/src/models/Dashboard.js` :

```js
const widgetSchema = new Schema({
  id:     { type: String, required: true },          // crypto.randomUUID() côté client
  type:   { type: String, required: true },
  title:  { type: String, trim: true, maxlength: 80, default: '' },
  layout: {
    x: { type: Number, min: 0, max: 11, required: true },
    y: { type: Number, min: 0, required: true },
    w: { type: Number, min: 1, max: 12, required: true },
    h: { type: Number, min: 1, max: 12, required: true },
  },
  source: {
    mode:     { type: String, enum: ['global', 'filter', 'inline', 'none'], default: 'global' },
    filterId: { type: Schema.Types.ObjectId, ref: 'SavedFilter', default: null },
    filters:  { type: Schema.Types.Mixed, default: {} },   // même forme que SavedFilter.filters
    combineWithGlobal: { type: Boolean, default: true },   // ET logique avec le filtre global
  },
  config: { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const dashboardSchema = new Schema({
  project:     { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  owner:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:        { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, trim: true, default: '' },
  visibility:  { type: String, enum: ['private', 'shared'], default: 'private' },
  globalFilters: { type: Schema.Types.Mixed, default: {} }, // ex. { sprint: ['@current'] }
  widgets:     { type: [widgetSchema], default: [] },      // max 30
  starredBy:   [{ type: Schema.Types.ObjectId, ref: 'User' }],
  defaultFor:  [{ type: Schema.Types.ObjectId, ref: 'User' }],
  revision:    { type: Number, default: 1 },               // concurrence optimiste
}, { timestamps: true, minimize: false });

dashboardSchema.index({ project: 1, owner: 1, name: 1 }, { unique: true });
```

Résolution de la source d'un widget, dans l'ordre :
1. `mode: 'none'` : widgets sans tâches (`note`, `upcomingEvents`).
2. `mode: 'filter'` : charger le `SavedFilter`. S'il n'existe plus ou n'est plus visible pour le lecteur, le widget affiche l'état « Filtre indisponible » (pas d'erreur 500).
3. `mode: 'inline'` : `source.filters`.
4. `mode: 'global'` : `dashboard.globalFilters`.
5. Si `combineWithGlobal` et `mode ∈ {filter, inline}` : combinaison champ par champ. Pour un champ présent des deux côtés, on prend l'**intersection** des valeurs résolues ; si elle est vide, le widget affiche « Aucune tâche (filtres incompatibles) ».

Règles de droits :

| Action | Propriétaire | Autre membre (dashboard `shared`) | Autre membre (`private`) | Admin projet | superadmin |
|---|---|---|---|---|---|
| Voir | oui | oui | non (404) | non (404) | non (404) |
| Modifier / supprimer | oui | non (403) | — | oui si `shared` | oui si `shared` |
| Dupliquer | oui | oui | — | oui si `shared` | oui si `shared` |
| Favori / défaut | oui | oui | — | oui si `shared` | oui si `shared` |

Un lecteur ne voit que les tâches du projet auxquelles il a accès ; les widgets d'un dashboard partagé ne donnent jamais accès à un filtre privé d'un autre utilisateur (un widget `mode: 'filter'` pointant vers un filtre privé d'autrui s'affiche « Filtre indisponible »).

### 3.5 API Dashboards

| Méthode et route | Corps / query | Réponse | Erreurs |
|---|---|---|---|
| `GET /projects/:key/dashboards` | — | `{ dashboards: [{ _id, name, description, visibility, owner, widgetCount, isOwner, isStarred, isDefault, updatedAt }] }` (sans `widgets`) | — |
| `POST /projects/:key/dashboards` | `{ name, description?, visibility?, template?: 'blank' \| 'sprint' \| 'po' \| 'dev', isDefault?, isStarred? }` | `201 { dashboard }` | `409` nom déjà pris pour ce propriétaire |
| `GET /projects/:key/dashboards/:id` | — | `{ dashboard }` avec `isOwner`, `isStarred`, `isDefault` | `404` |
| `PATCH /projects/:key/dashboards/:id` | `{ revision (obligatoire), name?, description?, visibility?, globalFilters?, widgets? }` (`widgets` = remplacement complet) | `{ dashboard }` avec `revision + 1` | `409 { code: 'REVISION_CONFLICT', current: { revision, updatedAt, updatedBy } }`, `400` widget invalide |
| `DELETE /projects/:key/dashboards/:id` | — | `{ ok: true }` | `403`, `404` |
| `POST /projects/:key/dashboards/:id/duplicate` | `{ name }` | `201 { dashboard }` (propriétaire = appelant, `private`) | `409` |
| `PUT /projects/:key/dashboards/:id/star` | `{ starred: boolean }` | `{ dashboard }` | — |
| `PUT /projects/:key/dashboards/:id/default` | `{ isDefault: boolean }` | `{ dashboard }` (retire le défaut des autres dashboards du projet pour cet utilisateur) | — |

Écriture du `PATCH` : `findOneAndUpdate({ _id, project, revision }, { $set: {...}, $inc: { revision: 1 } })`. Aucun document trouvé alors que le dashboard existe → `409 REVISION_CONFLICT`.

Modèles (`server/src/dashboards/templates.js`, constantes) :
- `sprint` : `sprintSummary` (0,0,4,3), `sprintBurndown` (4,0,8,4), `workload` (0,3,4,4), `breakdown` statut en donut (4,4,4,4), `taskList` « bloquants ouverts » `priority: ['P0'], statusCategory: ['todo','inprogress']` (8,4,4,4). Filtre global `{ sprint: ['@current'] }`.
- `po` : `velocity`, `breakdown` par version, `kpi` points restants, `breakdown` par type, `recentActivity`.
- `dev` : `taskList` `assignee: ['@me'], statusCategory: ['todo','inprogress']`, `kpi` mes points restants, `recentActivity` `assignee: ['@me']`.

### 3.6 API d'analyse (calculs des widgets)

Fichier `server/src/routes/analytics.routes.js` monté sur `/api/projects/:key/analytics`. Toutes les routes acceptent `filterId` et/ou `filters` (même forme que `SavedFilter.filters`, résolue par `compileTaskQuery`, §4.3).

| Route | Entrée | Sortie |
|---|---|---|
| `POST /analytics/aggregate` | `{ filters?, filterId?, metric, groupBy?, splitBy?, topN? }` | `{ total, buckets: [{ key, label, color, value, split?: [{ key, label, color, value }] }] }` |
| `POST /analytics/kpi` | `{ filters?, filterId?, metric, compareTo? }` | `{ value, previous?: number, deltaPct?: number }` |
| `GET /analytics/sprints/:sprintKey/burndown` | `?unit=points\|count` (`:sprintKey` accepte `@current`) | `{ sprint: { key, label, status, startDate, endDate }, unit, committed, days: [{ date, scope, completed, remaining }], ideal: [{ date, value }], scopeChanges: [{ date, taskId, delta, kind: 'added'\|'removed'\|'resized' }], warnings: string[] }` |
| `GET /analytics/velocity` | `?last=6&unit=points` | `{ sprints: [{ key, label, endDate, committed, completed, carriedOver, source: 'lifecycle'\|'computed'\|'import' }], average }` |
| `POST /analytics/tasks` | `{ filters?, filterId?, sort, limit, fields }` | `{ tasks: [...projection...], total }` |
| `POST /analytics/activity` | `{ filters?, filterId?, fields?, limit }` | `{ entries: [{ at, taskId, title, field, from, to, by: UserRef\|null, byLabel, note }] }` |
| `POST /analytics/sprint-summary` | `{ sprint }` | `{ sprint, daysLeft, committed, completed, pctDone, events: [{ _id, type, title, status, scheduledAt }] }` |
| Lot 2 : `POST /analytics/aging`, `POST /analytics/cfd`, `POST /analytics/matrix`, `POST /analytics/created-resolved`, `GET /analytics/versions` | — | — |

Règles de calcul :

- **Libellés et couleurs** résolus côté serveur depuis `Taxonomy` (archivées incluses pour l'historique). Valeur absente → clé `__none__`, libellé `— Non défini —`, couleur `#6b7280`. Assigné absent → `unassigned` / `Non assigné`.
- **`statusCategory`** : dérivé de `status.meta.category` (Annexe A.2).
- **`hours`** : même règle que `hoursOf()` (`client/src/utils/format.ts`) déplacée dans `server/src/utils/duration.js` et partagée ; `Nh` → N, `Nj` → N × 8.
- **`aggregate`** : pipeline Mongo `$match` (filtre compilé) → `$unwind` optionnel pour `labels` → `$group` sur la dimension (+ splitBy) → somme `1`, `$complexity` ou heures pré-calculées (Annexe A.1 `durationHours`).
- **`openBugs`** : tâches de `type` marqué `meta.isBug: true` (nouvelle convention sur la taxonomie `type`, défaut posé par la migration sur la clé `bug`) et catégorie ≠ `done`. On supprime le `type === 'bug'` codé en dur de `/stats`.

#### Algorithme du burndown (points ou nombre)

Fichier `server/src/analytics/timeline.js`.

1. Fenêtre `[start, end]` : `sprint.meta.startedAt ?? sprint.meta.startDate` → `sprint.meta.closedAt ?? sprint.meta.endDate`. Sans dates → `422 { code: 'SPRINT_WITHOUT_DATES' }`.
2. Tâches candidates : `sprint === key` OU `history` contient une entrée `field: 'sprint'` avec `from === key` ou `to === key`.
3. `valueAt(task, field, t)` : partir de la valeur actuelle, parcourir les entrées `field` de `history` triées par `at` décroissant ; pour chaque entrée avec `at > t`, valeur := `entry.from`. Avant `task.createdAt`, la tâche n'existe pas.
4. Cas de `from === null` sur `status` (historiques importés par le seed) : la valeur antérieure est inconnue ; on la traite comme « non terminée » et on ajoute `warnings: ['HISTORY_INCOMPLETE']`.
5. Échantillonnage quotidien à la fin de chaque jour dans le fuseau `project.timezone` (défaut `Europe/Paris`), plus un point à `now` si le sprint est actif :
   - `inSprint = valueAt(sprint, d) === key`
   - `done = category(valueAt(status, d)) === 'done'`
   - `pts = unit === 'points' ? valueAt(complexity, d) : 1`
   - `scope = Σ pts (inSprint)`, `completed = Σ pts (inSprint && done)`, `remaining = scope - completed`
6. `committed` = `sprint.meta.startSnapshot.committedPoints` (ou `committedCount`) si présent, sinon `scope` au jour `start`.
7. Idéal : droite de `committed` au jour `start` vers 0 au jour `end`. Jours calendaires en Lot 1 ; `project.workingDays` pris en compte en Lot 2 (paliers les jours non ouvrés).
8. `scopeChanges` : entrées `sprint` (ajout/retrait) et `complexity` (redimensionnement) avec `at ∈ ]start, end]`.

**Vélocité** : sprints `meta.status === 'finished'`, triés par `endDate` décroissante, limités à `last`. `committed`/`completed`/`carriedOver` lus dans `meta.report` s'il existe (`source` = `lifecycle` ou `import`), sinon recalculés par l'algorithme ci-dessus au jour `end` (`source: 'computed'`). `average` = moyenne des `completed`.

Performance : les calculs de timeline chargent les tâches candidates avec la projection `{ taskId, title, status, sprint, complexity, createdAt, history }` uniquement. Cache mémoire LRU maison (Map, 200 entrées, TTL 60 s) indexé par `(projectId, route, hash(params), maxUpdatedAt des tâches du projet)`.

### 3.7 Grille et IHM (sans dépendance supplémentaire)

Fichiers client :

```
client/src/pages/DashboardPage.tsx
client/src/api/dashboards.ts            // hooks react-query CRUD
client/src/api/analytics.ts             // hooks par route d'analyse
client/src/components/Dashboard/DashboardGrid.tsx
client/src/components/Dashboard/WidgetFrame.tsx       // en-tête, menu, états chargement/erreur/vide
client/src/components/Dashboard/WidgetConfigDrawer.tsx
client/src/components/Dashboard/AddWidgetDialog.tsx
client/src/components/Dashboard/layoutUtils.ts        // collisions, compactage, conversions pixel↔cellule
client/src/components/Dashboard/widgets/registry.ts   // type → { label, defaultLayout, min, defaultConfig, View, ConfigForm }
client/src/components/Dashboard/widgets/*.tsx
client/src/components/Charts/{BarChart,DonutChart,LineChart,StackedArea,Sparkline}.tsx
client/src/hooks/useElementSize.ts                    // ResizeObserver
```

Rendu de la grille : `display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 80px; gap: 12px`. Widget : `grid-column: ${x+1} / span ${w}; grid-row: ${y+1} / span ${h}`.

Mode édition :
- **Déplacement** : `@dnd-kit/core` (déjà présent). La poignée est l'en-tête du widget. Au `onDragEnd`, conversion du delta pixel en cellules : `dx = round(delta.x / (cellWidth + gap))`, `dy = round(delta.y / (80 + gap))`, puis bornage `0 ≤ x ≤ 12 - w`.
- **Redimensionnement** : poignée en bas à droite, `pointerdown`/`pointermove`/`pointerup` natifs, arrondi à la cellule, bornage par `min` du registre et `x + w ≤ 12`. Aperçu visuel via une ombre de placement.
- **Collisions** (`layoutUtils.resolveCollisions(widgets, movedId)`) : le widget déplacé garde sa position ; tout widget qui le chevauche est descendu à `moved.y + moved.h`, en cascade. Puis `compactVertical(widgets)` : trier par `(y, x)`, remonter chaque widget au plus petit `y ≥ 0` sans chevauchement. Fonctions pures, testées unitairement.
- **Brouillon local** : les modifications restent en état React jusqu'à « Enregistrer ». « Annuler » restaure la version serveur. Quitter la page avec un brouillon modifié → confirmation.
- **Conflit** (`409 REVISION_CONFLICT`) : bandeau « Ce dashboard a été modifié par {displayName} à {heure}. [Recharger et perdre mes changements] [Enregistrer comme copie] ».

Mobile (< 900 px) : chaque widget passe à `w = 12` dans l'ordre `(y, x)`, hauteur conservée, pas de mode édition.

Charts SVG : `viewBox` dimensionné par `useElementSize`, axes avec 4 à 6 graduations « rondes », info-bulle en `<div>` positionnée au survol, couleurs issues des taxonomies, bascule « Voir en tableau » dans le menu de chaque widget (accessibilité et export copier-coller).

Chaque widget se rafraîchit via react-query (`staleTime: 30s`). Les mutations de tâches (`useUpdateTask`, `useCreateTask`, `useDeleteTask`) invalident `['analytics', projectKey]`.

Wireframe lecture :

```
┌ Kýdos Board  [Projet ▾]  Board  Dashboards  Rituels  Administration ─────────────────┐
│ Dashboard : [★ Sprint en cours ▾]   Filtre global : Sprint = @current ✎   [Modifier] [⋯] │
├───────────────────────────┬─────────────────────────────────────────────────────────────┤
│ SPRINT 12.4.4  ● actif     │ BURNDOWN (points)                                ⋯          │
│ « Livrer la 12.4.4 »       │ 40 ┤╲ ideal                                                  │
│ 3 j restants · 62 % livré  │ 20 ┤  ╲___réel                                               │
│ Rituels : 🔍 Refinement mar│  0 ┼────────────────────                                     │
├───────────────────────────┼──────────────────────────────┬──────────────────────────────┤
│ CHARGE PAR ASSIGNÉ   ⋯     │ RÉPARTITION PAR STATUT   ⋯   │ BLOQUANTS OUVERTS        ⋯    │
│ Ameur  ████▓▓░░ 13 pts     │      ◯ donut                  │ KB-142 Auth mobile  En cours │
│ Hamido ██▓░ 8 pts          │  À faire 12 · En cours 5 …   │ KB-150 Crash socket À faire  │
└───────────────────────────┴──────────────────────────────┴──────────────────────────────┘
```

Wireframe édition :

```
│ Mode édition — Sprint en cours      [+ Ajouter un widget] [Filtre global] [Annuler] [Enregistrer] │
│ ┌──────────── ⠿ BURNDOWN ─── ⚙ ✕ ┐                                                            │
│ │                                 │   ← glisser par ⠿, ⚙ ouvre le panneau de config            │
│ └───────────────────────────────◢┘   ← ◢ redimensionner                                        │
│ Panneau droit « Configurer : Burndown »                                                        │
│   Titre [Burndown]   Sprint [@current ▾]   Unité (•) points ( ) nombre                          │
│   Mode (•) burndown ( ) burnup   [x] ligne idéale   [x] périmètre                               │
│   Source : ( ) filtre global (•) filtre enregistré [Bugs P0 ▾] ( ) filtres personnalisés        │
│            [x] combiner avec le filtre global                                                   │
```

---

## 4. Spécification des filtres sauvegardés

### 4.1 État existant et écarts à combler

Le backend en cours (§1.4) couvre : CRUD, privé/partagé, favori et défaut par utilisateur, unicité du nom par propriétaire, nettoyage des clés. Il manque :

| # | Écart | Décision |
|---|---|---|
| F-1 | Jetons dynamiques (`@me`, `@current`…) | Acceptés dans `filters`, résolus au moment de la requête (§4.3) |
| F-2 | Champs de filtre supplémentaires | `statusCategory[]`, `reporter[]`, `parent[]`, `createdFrom/To`, `updatedFrom/To` (dates ISO ou relatives) ; `labels` n'a d'effet qu'une fois `Task.labels` ajouté (Annexe A.1) |
| F-3 | `GET /tasks?filterId=` | Applique un filtre sauvegardé côté serveur (réutilisé par dashboards et liens) |
| F-4 | Duplication | `POST /filters/:id/duplicate` |
| F-5 | Suppression d'un filtre utilisé par des widgets | `409 { code: 'FILTER_IN_USE', dashboards: [{ _id, name }] }` sauf `?force=1` |
| F-6 | Filtre partagé : édition par admin projet | `canEdit` = propriétaire, admin projet (si `shared`), superadmin (si `shared`) ; aujourd'hui superadmin peut éditer un filtre qu'il ne peut pas voir s'il est privé (sans effet car `findVisible` renvoie 404, à garder cohérent) |
| F-7 | Accès membre (§5.4) | `loadProject` refuse les non-membres d'un projet `access: 'members'` |
| F-8 | Validation de `groupBy` et `sort.key` | Liste blanche : `groupBy` ∈ `GROUP_OPTIONS` (`groupUtils.ts`) ; `sort.key` ∈ colonnes de `ListBoard` |
| F-9 | Colonnes de la vue liste | `columns: string[]` optionnel (Lot 2, quand `ListBoard` aura des colonnes configurables) |

### 4.2 Modèle (cible)

Conserver `server/src/models/SavedFilter.js` tel qu'en cours, avec ces ajouts :

```js
// FILTER_ARRAY_FIELDS
[... 'status','priority','type','category','techno','version','sprint','area','assignee','labels',
 'statusCategory', 'reporter', 'parent']
// champs scalaires dans filters
search: String (≤ 200)
createdFrom, createdTo, updatedFrom, updatedTo: String (ISO 8601 ou /^-\d+[dwm]$/ ou '@sprintStart' | '@sprintEnd')
```

Forme stockée d'un filtre (exemple) :

```json
{
  "_id": "66e5…",
  "project": "66a1…",
  "owner": "66a0…",
  "name": "Mes bloquants du sprint",
  "description": "",
  "filters": {
    "status": [], "priority": ["P0", "P1"], "type": [], "category": [], "techno": [],
    "version": [], "sprint": ["@current"], "area": [], "assignee": ["@me"], "labels": [],
    "statusCategory": ["todo", "inprogress"], "reporter": [], "parent": [],
    "search": "", "createdFrom": "", "createdTo": "", "updatedFrom": "-14d", "updatedTo": ""
  },
  "view": "jira",
  "groupBy": "assignee",
  "sort": { "key": "priority", "dir": 1 },
  "visibility": "private"
}
```

Présentation API (existante) : `isOwner`, `isStarred`, `isDefault`, `starCount`, `owner` peuplé ; `starredBy`/`defaultFor` jamais exposés.

### 4.3 Compilation des filtres (socle partagé)

Nouveau `server/src/utils/taskQuery.js` :

```js
/**
 * @param {object} filters  forme SavedFilter.filters (déjà nettoyée)
 * @param {object} ctx      { project, user, taxonomies }  (taxonomies non archivées + archivées)
 * @returns {{ match: object, resolved: object, warnings: string[] }}
 */
function compileTaskQuery(filters, ctx) { ... }
function parseTaskQueryParams(query) { ... }      // req.query → filters (tableaux répétés ou "a,b")
function normalizeFilters(filters) { ... }        // tri + dédoublonnage + suppression des vides → clé stable
```

Jetons dynamiques :

| Champ | Jeton | Résolution |
|---|---|---|
| `assignee`, `reporter` | `@me` | `ctx.user._id` |
| `assignee` | `unassigned` (existant) | `null` |
| `sprint` | `@current` | `project.currentSprint` (aucun → aucune tâche, `warnings: ['NO_CURRENT_SPRINT']`) |
| `sprint` | `@open` | clés des sprints `meta.status ∈ {draft, ready, active}` |
| `sprint` | `@none` | `null` (backlog, voir Annexe C) |
| `version` | `@current` | `project.currentVersion` |
| `version` | `@unreleased` | clés des versions `meta.status !== 'released'` |
| `statusCategory` | `todo`/`inprogress`/`done` | clés de statut de cette catégorie, fusionnées en `$in` sur `status` (intersection si `status` est aussi renseigné) |
| dates | `-7d`, `-2w`, `-1m` | `now - N` (jours, semaines, mois de 30 jours) |
| dates | `@sprintStart`, `@sprintEnd` | dates du sprint courant |

Recherche : remplacer le filtrage en mémoire par `$or` de `$regex` échappées (`escapeRegExp`), insensibles à la casse, sur `taskId`, `title`, `module`, `description`, `instructions`, `acceptance`. Le comportement observable reste identique (sous-chaîne, insensible à la casse) ; testé par le test existant `tasks: create, patch with history, filter and search`.

`GET /projects/:key/tasks` évolue ainsi (rétrocompatible) :

| Paramètre | Effet |
|---|---|
| paramètres existants | inchangés |
| nouveaux champs de §4.2 | ajoutés |
| `filterId` | charge le filtre (visible par l'appelant, sinon 404) ; les paramètres explicites de la requête **remplacent** le champ correspondant du filtre |
| `fields=summary` | projection sans `comments`, `history`, `instructions`, `acceptance`, `spec` (le board l'utilise ; `TaskDetail` continue d'appeler `GET /tasks/:taskId`) |
| `limit`, `skip` | optionnels, `limit ≤ 1000` ; en-tête `X-Total-Count` |
| `sort` | `key:asc\|desc` (ex. `updatedAt:desc`), défaut `taskId:asc` (même encodage que l'URL du board) |

### 4.4 Endpoints (cible)

| Méthode et route | Statut | Notes |
|---|---|---|
| `GET /projects/:key/filters` | existe | ajouter `?scope=mine\|shared\|starred` (défaut : tous visibles) |
| `POST /projects/:key/filters` | existe | valider `groupBy`/`sort.key` (F-8) |
| `GET /projects/:key/filters/:id` | **à ajouter** | pour charger un lien `?filter=:id` |
| `PATCH /projects/:key/filters/:id` | existe | droits F-6 |
| `DELETE /projects/:key/filters/:id` | existe | F-5 |
| `POST /projects/:key/filters/:id/duplicate` | **à ajouter** | `{ name }` ; copie `private` appartenant à l'appelant |
| `PUT /projects/:key/filters/:id/star` | existe | `{ starred: boolean }` |
| `PUT /projects/:key/filters/:id/default` | existe | `{ isDefault: boolean }` |
| `GET /projects/:key/tasks?filterId=` | **à ajouter** | §4.3 |

### 4.5 UX

#### Barre des filtres enregistrés (au-dessus de `Filters`)

Composant `client/src/components/Board/SavedFiltersBar.tsx`, API `client/src/api/filters.ts` (tous deux en cours de création dans l'arbre de travail ; la spec ci-dessous sert de référence de recette).

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ ★ Mes tâches   ★ Sprint courant   ★ Bugs P0      [Tous les filtres ▾]                         │
│ Filtre actif : « Mes bloquants du sprint » • modifié    [Enregistrer] [Enregistrer sous…] [↺] [⋯] │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- Pastilles : filtres favoris de l'utilisateur, ordre alphabétique, le filtre par défaut marqué d'un point. Clic = appliquer.
- `Tous les filtres ▾` : liste déroulante avec recherche et 3 sections : **Favoris**, **Mes filtres**, **Partagés avec le projet** (nom du propriétaire en gris). Chaque ligne : ☆/★, nom, pastille « par défaut », menu `⋯`.
- Menu `⋯` d'un filtre : Renommer (propriétaire), Dupliquer, Rendre partagé / privé (propriétaire), Définir par défaut / Retirer le défaut, Copier le lien, Supprimer (propriétaire, confirmation, message dédié si `FILTER_IN_USE`).
- **État « modifié »** : `normalizeFilters(courant) !== normalizeFilters(filtreActif)` OU `view`, `groupBy`, `sort` différents. Pastille `• modifié`.
- **Enregistrer** : visible si filtre actif et `isOwner` (ou droits F-6) et modifié → `PATCH` avec `filters`, `view`, `groupBy`, `sort`. Sinon désactivé avec info-bulle « Enregistrez une copie ».
- **Enregistrer sous…** : modale `Nom*`, `Description`, `Visibilité (•) Privé ( ) Partagé avec le projet`, `[x] Ajouter aux favoris` (coché), `[ ] Utiliser par défaut sur ce projet` → `POST` ; le nouveau filtre devient actif. `409` affiché sous le champ nom.
- **↺ Réinitialiser** : revient à l'état enregistré du filtre actif ; sans filtre actif, vide tous les filtres (`EMPTY_FILTERS`, vue `grouped`, `groupBy: 'sprint'`).
- **Jetons dans `Filters.tsx`** : pastilles supplémentaires `Moi` (assigné), `Sprint courant`, `Sprints ouverts`, `Backlog` (sprint), `Version courante` ; stockées sous forme de jeton, pas de valeur figée.
- Un filtre partagé modifié par son propriétaire se met à jour chez les autres au prochain chargement (invalidation react-query au focus).

#### Chargement initial du board (ordre de priorité)

1. L'URL contient `filter` et/ou des paramètres de filtre → état issu de l'URL.
2. Sinon, filtre par défaut de l'utilisateur sur ce projet (`isDefault`) → l'appliquer et écrire `?filter=:id` dans l'URL (`replace`).
3. Sinon, état vide : `EMPTY_FILTERS`, `view=grouped`, `groupBy=sprint`, `sort=taskId:1`.

Le chargement n'affiche pas les tâches avant la résolution du filtre par défaut (pas de flash du board complet) : la requête `useTasks` a `enabled: filtersResolved`.

#### Synchronisation URL

Conversion état ↔ URL dans `client/src/utils/boardUrlState.ts` (fichier en cours de création dans l'arbre de travail : `boardStateFromParams` / `boardStateToParams`), branchée sur `useSearchParams` (react-router 6, déjà présent).

| Paramètre | Exemple | Règle |
|---|---|---|
| `filter` | `filter=66e5…` | id du filtre actif |
| dimensions | `status=pending&status=onprocess&sprint=@current` | paramètres répétés, comme l'API (`buildQuery` dans `client/src/api/tasks.ts`) |
| `q` | `q=login` | recherche, écrite avec un anti-rebond de 300 ms |
| `view` | `view=list` | `grouped` omis (défaut) |
| `groupBy` | `groupBy=assignee` | `sprint` omis |
| `sort` | `sort=priority:desc` | `asc`/`desc` ; `taskId:asc` omis (encodage déjà retenu par `client/src/utils/boardUrlState.ts` en cours) |
| dates | `updatedFrom=-14d` | |

- Filtre actif **non modifié** : l'URL ne contient que `filter=:id` (+ rien d'autre). Le lien partagé reflète toujours la dernière version enregistrée.
- Filtre actif **modifié** : l'URL contient `filter=:id` et **l'état complet** ; à l'ouverture, l'état de l'URL prime et la barre affiche « modifié ».
- Bascule d'une pastille, saisie : `setSearchParams(…, { replace: true })`. Changement de filtre enregistré, de vue : `push` (le bouton Retour revient au filtre précédent).
- `filter=:id` introuvable ou invisible → toast « Filtre introuvable ou non partagé », suppression du paramètre, application des règles 2-3.
- `ListBoard.tsx` : le tri passe de l'état local à des props contrôlées (`sort`, `onSortChange`).

### 4.6 Critères d'acceptation spécifiques (reportés en §6.3)

Voir CA-F1 à CA-F12.

---

## 5. Refonte de l'IHM d'administration du module projet

### 5.1 Structure cible

L'administration des **utilisateurs** est globale : elle sort de l'admin projet.

| Route | Accès | Contenu |
|---|---|---|
| `/admin/users` | superadmin | `UsersAdmin.tsx` actuel, lien « Administration globale » dans le menu utilisateur du header |
| `/projects/:key/settings/:tab` | lecture : membres ; écriture : admin projet | Nouvelle page `client/src/pages/ProjectSettingsPage.tsx` |
| `/projects/:key/admin` | — | Redirection vers `/projects/:key/settings/general` (compatibilité des favoris navigateur) |

Onglets (`:tab`) et fichiers :

| Onglet | `:tab` | Composant | Lot |
|---|---|---|---|
| Général | `general` | `components/ProjectSettings/GeneralTab.tsx` (remplace `Admin/ProjectSettings.tsx`) | 1 |
| Sprints & versions | `sprints` | `SprintsTab.tsx`, `VersionsPanel.tsx`, `CloseSprintDialog.tsx` | 1 |
| Membres & rôles | `members` | `MembersTab.tsx` | 1 |
| Workflow & statuts | `workflow` | `WorkflowTab.tsx` | 1 (catégories, ordre, couleurs), 2 (transitions, WIP) |
| Taxonomies | `taxonomies` | `Admin/TaxonomyAdmin.tsx` existant, **sans** les kinds `status`, `sprint`, `version` (déplacés) | 1 |
| Import / Export | `import` | `ImportExportTab.tsx`, `JiraImportWizard.tsx` | 1 |
| Zone dangereuse | `danger` | `DangerZoneTab.tsx` | 1 |

Gabarit commun :

```
┌ Paramètres du projet · Kýdos Belote (KB) ─────────────────────────── rôle : admin ┐
│ Général │ Sprints & versions │ Membres │ Workflow │ Taxonomies │ Import/Export │ ⚠ Zone dangereuse │
├──────────────────────────────────────────────────────────────────────────────────┤
│ (contenu de l'onglet)                                                             │
│                                                   [Annuler] [Enregistrer] (si modifié) │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Règles communes : champs désactivés et bandeau « Lecture seule » si l'utilisateur n'est pas admin projet ; détection de modification non enregistrée avec confirmation au changement d'onglet ; toast de succès ; erreurs serveur affichées sous le champ concerné quand `field` est renvoyé.

### 5.2 Onglet Général

```
┌ Identité ───────────────────────────────┐ ┌ Aperçu ─────────────────────────────┐
│ Clé           [KB] (non modifiable)      │ │ 154 tâches · 38 ouvertes             │
│ Nom*          [Kýdos Belote          ]   │ │ 5 membres · 12 sprints (1 actif)     │
│ Éditeur       [Cephalo Sophie        ]   │ │ Dernière activité : il y a 2 h       │
│ Responsable   [Ameur Hamdouni ▾] (admins)│ │ Créé le 20/07/2026                   │
│ Description   [                      ]   │ └──────────────────────────────────────┘
├ Planification ───────────────────────────┤
│ Version courante  [12.4.4 ▾] (versions non archivées)                     │
│ Cadence des sprints [1] [semaine(s) ▾]  N'affecte que les prochains sprints │
│ Fuseau horaire      [Europe/Paris ▾]                                      │
│ Jours ouvrés        [L][M][M][J][V][ ][ ]                                  │
├ Estimation ───────────────────────────────┤
│ Unité      (•) Points  ( ) Heures                                          │
│ Échelle    [Fibonacci ▾]  1 · 2 · 3 · 5 · 8 · 13   ( Personnalisée : [1,2,4,8] ) │
│ Tâche par défaut : statut [À faire ▾]  type [feature ▾]  priorité [Moyenne ▾] │
└───────────────────────────────────────────────────────────────────────────┘
```

Changements :
- `Project` : `timezone`, `workingDays`, `estimation { unit, scale }`, `defaults { status, type, priority }` (Annexe A.3). `complexityScale` (texte) devient un libellé dérivé, conservé en lecture pour compatibilité.
- `currentVersion` devient un select sur la taxonomie `version` (la valeur libre existante est conservée si absente de la liste, marquée « hors référentiel »).
- `currentSprint` **disparaît** de cet onglet : il est piloté par le cycle de vie des sprints (§5.3).
- `GET /projects/:key/overview` → `{ taskCount, openCount, memberCount, sprintCount, activeSprint, lastActivityAt, createdAt }`.
- `PATCH /projects/:key` : ajouter les nouveaux champs ; autorisation `requireProjectRole('admin')` au lieu de `requireRole('superadmin')` ; validation `defaults.*` ∈ clés de taxonomie existantes (`400 { field }`).
- `NewTaskModal.tsx` utilise `project.defaults` et propose les valeurs de `estimation.scale`.

### 5.3 Onglet Sprints & versions

#### Cycle de vie d'un sprint

```
 draft ──(préparer)──▶ ready ──(démarrer)──▶ active ──(clôturer)──▶ finished
   ▲                     │                                             │
   └──────(repasser en brouillon)                     (rouvrir, admin) ┘
```

Règles :
- **Un seul sprint `active` par projet** en Lot 1 (paramètre `allowParallelSprints` en Lot 3).
- `Project.currentSprint` = clé du sprint actif ; `null` si aucun. Il n'est plus modifiable directement (`PATCH /projects/:key` ignore `currentSprint` → documenté, testé).
- Les champs de cycle de vie de `sprint.meta` (`status`, `startedAt`, `startedBy`, `startSnapshot`, `closedAt`, `closedBy`, `report`) ne sont modifiables que par les routes ci-dessous. `PATCH /taxonomies/:id` sur un sprint les ignore (Annexe A.2).

Wireframe :

```
┌ Sprints ──────────────────────────────────────────── [+ Nouveau sprint] ┐
│ ● ACTIF  Sprint 12.4.4   20/08 → 26/08 (J-3)   21/34 pts  ▓▓▓▓▓▓░░░ 62 %          │
│          Objectif : Livrer la version 12.4.4          [Modifier] [Clôturer le sprint…] │
├──────────────────────────────────────────────────────────────────────────┤
│ ◌ PRÊT   Sprint 12.5.0   27/08 → 02/09   14 tâches · 29 pts   [Modifier] [Démarrer]  │
│ ◌ BROUIL Sprint 12.6.0   —               3 tâches · 8 pts     [Modifier] [Prêt] [⋯]  │
├ Terminés (repliable) ────────────────────────────────────────────────────┤
│ ✓ Sprint 12.4.3  13/08 → 19/08  engagé 30 · livré 26 · reporté 2  [Rapport] [⋯ Rouvrir] │
└──────────────────────────────────────────────────────────────────────────┘
```

Dialogue de démarrage :

```
Démarrer « Sprint 12.5.0 »
  Début [27/08/2026]  Fin [02/09/2026]  (proposée : début + cadence)
  Objectif [Livrer la 12.5.0                         ]
  Engagement : 14 tâches · 29 points (instantané enregistré au démarrage)
  ⚠ 2 tâches sans estimation
                                                   [Annuler] [Démarrer le sprint]
```

Dialogue de clôture :

```
Clôturer « Sprint 12.4.4 »
  Terminées : 18 tâches · 26 pts          Non terminées : 4 tâches · 8 pts
  ┌ Non terminées ─────────────────────────────────────────── garder dans ce sprint ┐
  │ KB-142 Auth mobile           En cours   5 pts  Ameur      [ ]                     │
  │ KB-150 Crash socket          À faire    2 pts  —          [ ]                     │
  │ …                                                                                  │
  └────────────────────────────────────────────────────────────────────────────────┘
  Reporter les tâches non terminées vers :
    (•) Sprint suivant [Sprint 12.5.0 ▾]   ( ) Backlog   ( ) Nouveau sprint [nom]
  [x] Démarrer immédiatement le sprint cible (s'il est « prêt » ou « brouillon »)
  [x] Créer la rétrospective (rituel « Rétrospective » pré-rempli)
                                                   [Annuler] [Clôturer le sprint]
```

API sprints (`server/src/routes/sprints.routes.js`, monté sur `/api/projects/:key/sprints`) :

| Méthode et route | Corps | Effet | Erreurs |
|---|---|---|---|
| `GET /sprints` | `?status=` | `{ sprints: [{ key, label, order, meta, stats: { taskCount, points, donePoints } }] }` | — |
| `POST /sprints` | `{ label, key?, startDate?, endDate?, goal?, linkedVersion? }` | Crée la taxonomie `sprint` ; `key` par défaut = slug du label unique ; dates par défaut = jour suivant la fin du dernier sprint, durée `project.effectiveSprintDays()` (logique déplacée depuis `TaxonomyAdmin.add`) ; `status: 'draft'` | `409` clé existante |
| `PATCH /sprints/:sprintKey` | `{ label?, startDate?, endDate?, goal?, linkedVersion?, order? }` | Hors champs de cycle de vie | `400 { code: 'LIFECYCLE_FIELD' }` si `status` envoyé |
| `POST /sprints/:sprintKey/ready` | — | `draft → ready` | `409 { code: 'INVALID_TRANSITION' }` |
| `POST /sprints/:sprintKey/draft` | — | `ready → draft` | `409 INVALID_TRANSITION` |
| `POST /sprints/:sprintKey/start` | `{ startDate, endDate, goal? }` | `draft\|ready → active` ; `meta.startedAt = now`, `startedBy`, `startSnapshot = { at, committedPoints, committedCount, taskIds }` ; `project.currentSprint = key` | `409 { code: 'ACTIVE_SPRINT_EXISTS', activeSprint }`, `400` `endDate < startDate` |
| `GET /sprints/:sprintKey/close-preview` | — | `{ done: { count, points }, notDone: [{ taskId, title, status, complexity, assignee }], targets: [{ key, label, status }] }` | `409` si non actif |
| `POST /sprints/:sprintKey/close` | `{ carryOver: { mode: 'sprint'\|'backlog'\|'newSprint', targetKey?, newSprint?: { label, startDate?, endDate?, goal? } }, keep: string[], startTarget: boolean, createRetro: boolean }` | Voir déroulé ci-dessous | `409 INVALID_TRANSITION`, `400 { code: 'CARRY_TARGET_INVALID' }` (cible = sprint clos ou lui-même), `409 ACTIVE_SPRINT_EXISTS` si `startTarget` et un autre sprint est actif |
| `POST /sprints/:sprintKey/reopen` | — | `finished → active` (admin projet ; **ne défait pas** les reports) ; `meta.report` conservé avec `reopenedAt` | `409 ACTIVE_SPRINT_EXISTS` |
| `DELETE /sprints/:sprintKey` | — | Autorisé seulement si aucune tâche, aucune entrée d'historique ni événement ne le référence ; sinon archiver | `409 { code: 'SPRINT_IN_USE', tasks, events }` |

Déroulé de `close` (ordre strict, idempotent en cas de nouvelle tentative) :
1. Recharger le sprint ; `meta.status !== 'active'` → `409`.
2. Résoudre la cible : `sprint` → clé existante `draft|ready|active`, ≠ sprint clos ; `backlog` → `null` ; `newSprint` → créer le sprint (`POST /sprints` interne).
3. `notDone` = tâches `sprint === key` dont la catégorie de statut ≠ `done`, moins celles listées dans `keep`.
4. Pour chaque tâche de `notDone` : `applyPatchWithHistory(task, { sprint: target }, user, 'Report automatique à la clôture de « Sprint 12.4.4 »')` puis `save`. Écriture par lots de 100 (`bulkWrite`) avec les mêmes entrées d'historique.
5. `meta.report = { completedPoints, completedCount, committedPoints (snapshot), carriedOverTaskIds, carriedTo, keptTaskIds, source: 'lifecycle' }`, `meta.closedAt`, `meta.closedBy`, `meta.status = 'finished'`.
6. `project.currentSprint = null` ; puis si `startTarget` : démarrage du sprint cible avec ses dates (ou proposées), `currentSprint = target`.
7. Si `createRetro` et que le type d'événement `retro` existe (non archivé) : `Event.create({ type: 'retro', title: 'Rétrospective — Sprint 12.4.4', sprint: key, status: 'draft', participants: assignees distincts du sprint, tasks: tâches reportées avec note 'Reportée', notes: résumé chiffré })`.
8. Réponse : `{ sprint, target, carriedOver: n, retroEventId? }`.

Sans transactions Mongo (instance standalone probable), l'étape 4 précède l'étape 5 : une nouvelle tentative après échec ne reporte que les tâches encore dans le sprint et termine la clôture.

#### Versions

`version.meta` : `{ status: 'unreleased' | 'released', startDate?, releaseDate?, releasedAt?, description? }`.

```
┌ Versions ───────────────────────────────────────────── [+ Nouvelle version] ┐
│ 12.5.0  non publiée  sortie prévue 02/09   22 tâches (18 terminées)  [Publier…] [⋯] │
│ 12.4.4  ★ courante   non publiée           34 tâches (34 terminées)  [Publier…] [⋯] │
│ 12.4.3  publiée le 19/08                    41 tâches                       [⋯] │
└──────────────────────────────────────────────────────────────────────────────┘
Publier « 12.4.4 » : date [26/08/2026]   3 tâches non terminées → déplacer vers [12.5.0 ▾] / ( ) laisser
                     [x] Définir « 12.5.0 » comme version courante
```

| Méthode et route | Corps | Effet |
|---|---|---|
| `GET /projects/:key/versions` | — | Liste + `stats` |
| `POST /projects/:key/versions` | `{ key, label?, startDate?, releaseDate?, description? }` | Crée la taxonomie `version` |
| `PATCH /projects/:key/versions/:versionKey` | `{ label?, startDate?, releaseDate?, description?, order? }` | — |
| `POST /projects/:key/versions/:versionKey/release` | `{ releasedAt?, moveOpenTo?: versionKey \| null, setCurrent?: versionKey }` | `status: 'released'` ; déplace les tâches non terminées avec historique ; met à jour `project.currentVersion` |
| `POST /projects/:key/versions/:versionKey/unrelease` | — | `status: 'unreleased'` |

### 5.4 Onglet Membres & rôles

Modèle (Annexe A.3) : `Project.access: 'open' | 'members'` (défaut `open`), `Project.members: [{ user, role: 'admin' | 'member' | 'viewer', addedAt, addedBy }]`.

Rôle effectif (`server/src/middleware/project.js`, calculé dans `loadProject` et exposé en `req.projectRole`) :

| Utilisateur | `access: 'open'` | `access: 'members'` |
|---|---|---|
| superadmin | `admin` | `admin` |
| `Project.owner` | `admin` | `admin` |
| membre listé | son rôle | son rôle |
| autre utilisateur actif | `member` (comportement actuel) | **404** `Projet introuvable` (ne pas révéler l'existence) |

Matrice de permissions :

| Action | viewer | member | admin |
|---|---|---|---|
| Lire tâches, rituels, dashboards partagés | ✅ | ✅ | ✅ |
| Filtres et dashboards personnels, favoris, défaut | ✅ | ✅ | ✅ |
| Créer / modifier tâches, commenter, glisser-déposer | ❌ | ✅ | ✅ |
| Supprimer une tâche | ❌ | ❌ (**changement** : aujourd'hui tout utilisateur) | ✅ |
| Créer / modifier / supprimer un rituel | ❌ | ✅ (suppression : créateur uniquement) | ✅ |
| Taxonomies, sprints (cycle de vie), versions, workflow | ❌ | ❌ | ✅ |
| Paramètres, membres, import/export, archivage | ❌ | ❌ | ✅ |
| Suppression définitive du projet | ❌ | ❌ | superadmin uniquement |

Middleware : `requireProjectRole('member' | 'admin')` ; `viewer` bloqué sur toute méthode non `GET` des routes tâches, commentaires et rituels (`403 { code: 'READ_ONLY_ROLE' }`). Les routes personnelles (`/filters`, `/dashboards` étoile/défaut, création privée) restent ouvertes au viewer.

```
┌ Accès au projet ──────────────────────────────────────────────────────────────┐
│ (•) Ouvert : tout utilisateur actif est membre   ( ) Restreint aux membres listés │
├ Membres (5) ─────────────────────────────── [Rechercher…] [+ Ajouter des membres] ┤
│ ● Ameur Hamdouni   ameur    superadmin · propriétaire   admin (fixe)               │
│ ● Hamido           hamido   superadmin                  admin (fixe)               │
│ ● Sofia Ben        sofia    développeur  [membre ▾]  12 tâches ouvertes   [Retirer] │
│ ● Karim            karim    développeur  [lecteur ▾]  0                    [Retirer] │
└──────────────────────────────────────────────────────────────────────────────┘
Retirer « Sofia Ben » : ses 12 tâches ouvertes restent assignées. [ ] Les désassigner   [Retirer]
```

| Méthode et route | Corps | Réponse / erreurs |
|---|---|---|
| `GET /projects/:key/members` | — | `{ access, members: [{ user: PublicUser, role, effective: true\|false, addedAt, openTaskCount }] }` (en mode `open`, inclut les utilisateurs actifs non listés avec `effective: false`) |
| `POST /projects/:key/members` | `{ userIds: string[], role }` | `201 { members }` ; utilisateurs déjà membres ignorés |
| `PATCH /projects/:key/members/:userId` | `{ role }` | `409 { code: 'LAST_ADMIN' }` si on retire le dernier admin non superadmin et qu'aucun superadmin actif n'existe |
| `DELETE /projects/:key/members/:userId` | `?unassignOpenTasks=1` | `409 LAST_ADMIN` ; désassignation avec historique |
| `PATCH /projects/:key` | `{ access }` | passage à `members` refusé si l'appelant ne serait plus membre (`409 { code: 'SELF_LOCKOUT' }`) |

Effets de bord :
- `GET /projects` ne liste que les projets accessibles et ajoute `myRole` à chaque projet ; `GET /projects/:key` renvoie `myRole`.
- Les sélecteurs d'assigné (`TaskDetail`, `NewTaskModal`, `Filters`, `UserMultiSelect`) utilisent `GET /projects/:key/members` (membres effectifs, hors viewers pour l'assignation) au lieu de `GET /users`.
- Côté client, un hook `useProjectRole(projectKey)` remplace les tests `user?.role === 'superadmin'` des écrans projet.

### 5.5 Onglet Workflow & statuts

Lot 1 :

```
┌ Statuts (glisser pour réordonner) ─────────────────────────────── [+ Statut] ┐
│ ⠿ ● Brouillon     draft             [À faire ▾]      12 tâches   [⋯]         │
│ ⠿ ● À faire       pending           [À faire ▾]      20 tâches   [⋯]         │
│ ⠿ ● En cours      onprocess         [En cours ▾]      5 tâches   [⋯]         │
│ ⠿ ● À relire      needreview        [En cours ▾]      2 tâches   [⋯]         │
│ ⠿ ● Terminée      finished          [Terminé ▾]      90 tâches   [⋯]         │
└──────────────────────────────────────────────────────────────────────────────┘
[⋯] : Renommer · Couleur · Archiver · Supprimer et réaffecter les tâches vers [statut ▾]
```

- Catégorie obligatoire `todo | inprogress | done` (`status.meta.category`) ; `meta.isDone` est recalculé côté serveur (`category === 'done'`) pour compatibilité.
- Réordonnancement par `@dnd-kit/sortable` (déjà présent) → `PUT /projects/:key/taxonomies/order` `{ kind: 'status', keys: string[] }` (nouvelle route, applicable à tous les kinds).
- **Supprimer et réaffecter** (tous kinds sauf `eventType`) : `POST /projects/:key/taxonomies/:id/replace` `{ replacementKey }` → met à jour les tâches concernées avec historique (`note: 'Valeur « X » supprimée, remplacée par « Y »'`), met à jour `SavedFilter.filters` et `Dashboard.*.filters` qui la référencent, puis supprime l'entrée. Réponse `{ tasksUpdated, filtersUpdated }`. Garde : il reste au moins un statut par catégorie `todo` et `done` (`409 { code: 'CATEGORY_REQUIRED' }`).
- `GroupStats.tsx`, `/stats` et les analyses utilisent la catégorie : suppression de `IN_PROGRESS_STATUSES` codé en dur.

Lot 2 :
- `status.meta.wipLimit: number | null` → en-tête de colonne `JiraBoard` « 5 / 4 » en rouge si dépassé (avertissement, pas de blocage).
- `status.meta.allowedTo: string[] | null` (`null` = toutes transitions) + `Project.workflow.enforceTransitions: boolean`. Matrice de cases à cocher `de × vers`. `PATCH /tasks/:taskId` refuse une transition non autorisée `422 { code: 'TRANSITION_NOT_ALLOWED', allowed }` ; un admin peut passer outre avec `force: true` (historique `note: 'Transition forcée'`). Pendant le glisser-déposer, les colonnes interdites sont grisées.

### 5.6 Onglet Taxonomies

Composant existant `TaxonomyAdmin.tsx` conservé pour `priority`, `type`, `category`, `techno`, `area`, `eventType` ; ajouts :
- `type.meta.isBug` (case « compte comme bug ») ;
- action « Supprimer et réaffecter » (§5.5) ;
- réordonnancement par glisser-déposer au lieu du champ numérique `order`.

### 5.7 Onglet Import / Export (import Jira)

#### 5.7.1 Périmètre

| Source | Lot | Contenu | Obtention côté Jira |
|---|---|---|---|
| CSV Jira « Tous les champs » | 1 | Tickets : clé, résumé, type, statut, catégorie de statut, priorité, assigné, rapporteur, dates, sprints, versions corrigées, composants, étiquettes, story points, parent, description, commentaires | Recherche de tickets → Exporter → CSV (tous les champs). **Jira Cloud limite l'export à 1 000 tickets** : l'assistant accepte plusieurs fichiers successifs |
| JSON des versions | 1 (optionnel) | Nom, publié, dates de début et de sortie, description | `GET /rest/api/3/project/{projectKey}/versions`, réponse copiée dans un fichier |
| JSON des sprints | 1 (optionnel) | Nom, état, dates de début/fin/clôture, objectif | `GET /rest/agile/1.0/board/{boardId}/sprint?maxResults=50` (pages `startAt`), réponses concaténées ou tableau `values` |
| Connexion API directe (jeton) | 3 | Synchronisation | — |
| Pièces jointes, worklogs, liens | 3 | — | — |

Format des colonnes et règles de conversion : Annexe B.

#### 5.7.2 Assistant (4 étapes)

```
① Fichiers ─── ② Correspondance des champs ─── ③ Correspondance des valeurs ─── ④ Aperçu & import
```

**① Fichiers**

```
Tickets (CSV Jira)*   [Choisir…] jira-export-1.csv (842 Ko, 1 000 lignes) · jira-export-2.csv (312 lignes)
Versions (JSON)       [Choisir…] versions.json (14 versions)
Sprints (JSON)        [Choisir…] sprints.json (22 sprints)
Séparateur détecté : « , »   Encodage : UTF-8 (BOM retiré)
                                                                           [Analyser]
```

**② Correspondance des champs** (suggestions automatiques, modifiables)

```
Champ Kýdos        Colonne Jira                        Exemple
Titre*             [Summary ▾]                         « Auth mobile »
Type               [Issue Type ▾]                      « Story »
Statut*            [Status ▾]                          « In Progress »
Priorité           [Priority ▾]                        « High »
Assigné            [Assignee ▾] (+ Assignee Id)        « Sofia Ben »
Sprint             [Sprint ▾] (3 colonnes)             « KB Sprint 12 »
Version            [Fix Version/s ▾] (2 colonnes)      « 12.4.4 »
Points             [Custom field (Story Points) ▾]     « 5 »
Domaine            [Component/s ▾]                     « server »
Catégorie          [— ignorer — ▾]
Techno             [— ignorer — ▾]
Étiquettes         [Labels ▾] (4 colonnes)             « mobile, auth »
Parent / epic      [Parent ▾]  Traiter les epics : (•) parent  ( ) catégorie  ( ) ignorer
Description        [Description ▾]
Commentaires       [Comment ▾] (7 colonnes)
Identifiant        (•) Garder la clé Jira si le préfixe = KB, sinon renuméroter  ( ) Toujours renuméroter
Tickets existants  (•) Mettre à jour  ( ) Ignorer
```

**③ Correspondance des valeurs** (une section par dimension ; valeurs détectées avec leur nombre)

```
Statuts                                     Utilisateurs
« To Do » (412)        → [À faire ▾]        « Sofia Ben » (221)   → [Sofia Ben ▾]  (correspondance par nom/e-mail)
« In Progress » (37)   → [En cours ▾]       « J. Martin » (18)    → [— non assigné — ▾]
« Code Review » (9)    → [+ Créer « Code Review » (En cours) ▾]
« Done » (842)         → [Terminée ▾]
Types : « Story » → feature · « Bug » → bug · « Task » → chore · « Epic » → [parent ▾] · « Sub-task » → chore
Sprints : « KB Sprint 12 » → [+ Créer (dates du JSON : 20/08 → 26/08, clos)] …
```

Valeurs spéciales : `__create__` (créer la taxonomie), `__skip_row__` (ignorer les tickets ayant cette valeur, ex. type `Epic` si epics ignorés), `__none__` (laisser vide).

**④ Aperçu & import**

```
Simulation (aucune écriture) :
  1 312 tickets lus · 1 204 à créer · 96 à mettre à jour · 12 ignorés
  Taxonomies à créer : 1 statut, 22 sprints, 3 versions, 14 étiquettes (champ libre)
  Commentaires : 2 874 · Tickets parents résolus : 118 / 121
  ⚠ 23 dates non reconnues (format 14/sept./26) → [voir les lignes]
  ⚠ 3 parents introuvables (KB-9, KB-10, KB-11) → champ parent vidé
  Aperçu des 20 premiers tickets : [tableau]
                                        [Télécharger le rapport CSV] [Retour] [Lancer l'import]
Progression : ▓▓▓▓▓▓▓░░░ 700 / 1 312 …
Terminé : 1 204 créés · 96 mis à jour · 12 ignorés · 0 erreur   [Voir le board] [Annuler cet import]
```

#### 5.7.3 API d'import

Toutes sous `/api/projects/:key/import` (limite JSON 25 Mo déjà configurée). Le client lit les fichiers en texte (`File.text()`) et envoie un JSON ; aucune dépendance d'upload multipart.

| Méthode et route | Corps | Réponse |
|---|---|---|
| `POST /import/jira/analyze` | `{ files: [{ name, csv: string }], versionsJson?: string, sprintsJson?: string }` | `{ jobId, fileHashes: string[], rowCount, columns: [{ name, occurrences, sample }], detected: { keyPrefixes: [{ value, count }], issueTypes, statuses: [{ value, count, category? }], priorities, sprints: [{ value, count, fromJson?: { state, startDate, endDate, completeDate, goal } }], versions, components, labels, users: [{ name, accountId?, count, suggestedUserId? }], dateFormat: string \| null }, suggestedMapping: Mapping }` |
| `POST /import/jira/preview` | `{ jobId, files, versionsJson?, sprintsJson?, mapping }` | `{ jobId, summary: { toCreate, toUpdate, skipped, comments, taxonomiesToCreate: { status: [], sprint: [], version: [] }, parentsResolved, parentsMissing }, warnings: [{ row, issueKey, code, message }], sample: TaskPreview[20] }` |
| `POST /import/jira/commit` | `{ jobId, files, versionsJson?, sprintsJson?, mapping }` | `202 { jobId }` ; traitement asynchrone dans le processus |
| `GET /import/jobs/:jobId` | — | `{ job }` (statut, progression, compteurs, 500 premières erreurs) |
| `GET /import/jobs` | — | Historique des imports du projet |
| `GET /import/jobs/:jobId/report.csv` | — | Rapport ligne à ligne (`row, issueKey, taskId, action, warnings`) |
| `POST /import/jobs/:jobId/rollback` | — | Supprime les tâches **créées** par le job non modifiées depuis (`updatedAt ≤ job.finishedAt`), les taxonomies créées non référencées ; ne défait pas les mises à jour. Réponse `{ tasksDeleted, tasksKept: [{ taskId, reason }], taxonomiesDeleted }` |

Le client renvoie les fichiers à chaque étape (serveur sans état de fichiers) ; le serveur vérifie `sha256(files) === job.fileHashes` au `commit` (`409 { code: 'FILES_CHANGED' }`).

Structure `Mapping` :

```ts
interface JiraMapping {
  fields: Partial<Record<
    'title'|'description'|'type'|'status'|'statusCategory'|'priority'|'assignee'|'reporter'|'sprint'
    |'version'|'complexity'|'area'|'category'|'techno'|'labels'|'parent'|'created'|'updated'
    |'resolved'|'dueDate'|'estimate'|'timeSpent'|'comments'|'issueKey'|'issueId'|'assigneeId'|'reporterId',
    string | null>>;                                   // nom de colonne Jira
  values: {
    status: Record<string, string>;                    // valeur Jira → clé Kýdos | '__create__' | '__skip_row__'
    priority: Record<string, string>;
    type: Record<string, string>;
    sprint: Record<string, string>;
    version: Record<string, string>;
    area?: Record<string, string>;
    category?: Record<string, string>;
    techno?: Record<string, string>;
    users: Record<string, string>;                     // accountId ou nom → userId | '__none__'
  };
  options: {
    taskIdStrategy: 'keepIfSamePrefix' | 'renumber';
    onExisting: 'update' | 'skip';
    epicMode: 'parent' | 'category' | 'skip';
    multiSprint: 'last';                               // seul mode Lot 1
    multiVersion: 'highest' | 'first';
    dateFormat: string | null;                         // null = détection
    importComments: boolean;
    createdStatusCategory: Record<string, 'todo'|'inprogress'|'done'>; // pour les statuts '__create__'
  };
}
```

Modèle `server/src/models/ImportJob.js` :

```js
{
  project: ObjectId, createdBy: ObjectId,
  source: { type: String, enum: ['jira-csv'] },
  status: { type: String, enum: ['analyzed', 'previewed', 'running', 'done', 'failed', 'rolledBack'] },
  fileNames: [String], fileHashes: [String],
  mapping: Mixed,
  progress: { processed: Number, total: Number },
  stats: { created: Number, updated: Number, skipped: Number, errors: Number, comments: Number },
  errors: [{ row: Number, issueKey: String, code: String, message: String }],   // max 500
  createdTaskIds: [ObjectId], updatedTaskIds: [ObjectId], createdTaxonomyIds: [ObjectId],
  startedAt: Date, finishedAt: Date,
}
```

Implémentation serveur (`server/src/import/`) :
- `csv.js` (amorcé dans l'arbre de travail) : analyseur RFC 4180 maison (guillemets, `""`, retours ligne dans les champs, CRLF, BOM, détection `,`/`;`), **conserve les en-têtes dupliqués** sous forme de tableau de valeurs.
- `jiraDates.js` : formats de l'Annexe B.4.
- `jiraMapper.js` : ligne CSV + mapping → `{ taskFields, comments, sprints[], warnings[] }` (fonction pure, testée).
- `jiraImporter.js` : orchestration, écriture par lots de 200 via `Task.bulkWrite(ops, { timestamps: false })` (même technique que le seed, pour conserver `createdAt`/`updatedAt` Jira), mise à jour de `job.progress` toutes les 200 lignes.
- Verrou : un seul job `running` par projet (`409 { code: 'IMPORT_RUNNING' }`). Au redémarrage du serveur, les jobs `running` passent `failed` avec message « interrompu ».

Règles métier de l'import :

| Règle | Détail |
|---|---|
| Idempotence | Clé naturelle `(project, external.source = 'jira', external.key)`, index unique partiel (Annexe A.1). Réimporter le même fichier ne crée aucun doublon |
| Mise à jour | `onExisting: 'update'` → `applyPatchWithHistory` avec `note: 'Import Jira (job …)'` : les écarts apparaissent dans l'historique |
| Identifiant | `keepIfSamePrefix` : `KB-123` conservé si le préfixe = `project.key` et qu'aucune tâche non importée n'a cet id ; sinon `nextTaskNumber`. Puis `Counter.$max(seq)` |
| Sprints multiples | Sprint de la tâche = dernier sprint listé ; les précédents génèrent des entrées d'historique `field: 'sprint'` datées à la fin du sprint concerné (si JSON fourni) ou à `created` (sinon, avec avertissement) |
| Sprints (JSON) | `future → draft`, `active → active` (un seul ; sinon le plus récent actif, les autres `finished` avec avertissement), `closed → finished`, `startDate`, `endDate`, `closedAt = completeDate`, `goal`. `project.currentSprint` = sprint actif importé si le projet n'en a pas |
| Rapport des sprints clos importés | `meta.report = { committedCount/Points: tickets listant ce sprint, completedCount/Points: tickets résolus dans [start, completeDate] dont ce sprint est le dernier, carriedOverTaskIds: tickets listant ce sprint puis un suivant, source: 'import' }` → vélocité exploitable immédiatement |
| Sprints (sans JSON) | Créés `draft`, sans dates, avertissement « vélocité et burndown indisponibles pour ces sprints » |
| Versions (JSON) | `released → meta.status`, `releaseDate`, `startDate`, `description`, `archived → archived` |
| Statut | Historique initial : une entrée `field: 'created'` (à `created`) et, si `resolved`, une entrée `field: 'status'` `{ from: null, to: statut, at: resolved, note: 'Résolu dans Jira' }`. L'historique complet des transitions n'existe pas dans le CSV |
| Dates | `createdAt = Created`, `updatedAt = Updated`, `resolvedAt = Resolved`, `dueDate = Due date` |
| Estimation | `Original Estimate` et `Time Spent` sont en **secondes** → `estimate = '4h'`, `duration = '3.5 h'` |
| Commentaires | Format `date;accountId;texte` (Annexe B.3). Auteur = utilisateur mappé, sinon l'importateur avec préfixe `[Nom Jira] `. Déduplication par `(date, auteur, sha1(texte))` lors des réimports |
| Parent / epic | `epicMode: 'parent'` → `Task.parent = taskId Kýdos du parent` (résolu après création de toutes les tâches, 2e passe). `category` → taxonomie `category` au nom de l'epic (tickets de type Epic eux-mêmes ignorés). `skip` → ignoré |
| Utilisateurs | Aucun compte créé automatiquement en Lot 1 (pas de mot de passe). Non mappé → non assigné, nom Jira conservé dans `external.assigneeName` et affiché en info-bulle |
| Description | Texte brut conservé (balisage wiki Jira non converti en Lot 1) |
| Erreurs | Une ligne en erreur n'arrête pas l'import ; elle est comptée et listée |
| Droits | Admin projet ; projet non archivé |

#### 5.7.4 Export

| Méthode et route | Effet |
|---|---|
| `GET /projects/:key/export?format=json` | Bundle `{ schema: 'kydos-project/1', exportedAt, project, taxonomies, tasks (avec comments, history), events, savedFilters (partagés), dashboards (partagés) }`, `Content-Disposition: attachment` ; identifiants utilisateurs remplacés par `username` |
| `GET /projects/:key/export?format=csv&filterId=…` | Tâches du filtre, colonnes `taskId,title,status,priority,type,category,techno,area,version,sprint,complexity,assignee,reporter,labels,parent,createdAt,updatedAt,resolvedAt` ; générateur CSV maison, séparateur `;` optionnel (`&sep=semicolon`) pour Excel FR |
| Lot 2 : `POST /projects/:key/import/kydos` | Réimport d'un bundle `kydos-project/1` (remplacera `tasks.json` comme format de migration entre instances) |

Le téléchargement côté client passe par `fetch` avec le jeton puis `URL.createObjectURL` (le lien direct ne porterait pas l'en-tête `Authorization`).

```
┌ Import ───────────────────────────────────────────────────────────────────────┐
│ [Importer depuis Jira…]                                                         │
│ Historique : 12/09 14:02  Sofia  jira-export-1.csv  1 204 créés · 96 maj  [Rapport] [Annuler] │
├ Export ───────────────────────────────────────────────────────────────────────┤
│ Projet complet (JSON)            [Télécharger]                                   │
│ Tâches (CSV)  Filtre [— toutes — ▾]  Séparateur [; ▾]   [Télécharger]            │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 5.8 Zone dangereuse

```
┌ ⚠ Zone dangereuse ────────────────────────────────────────────────────────────┐
│ Transférer la responsabilité     [Choisir un admin ▾]                [Transférer] │
│ Archiver le projet               Le projet passe en lecture seule et disparaît de │
│                                  la liste (visible via « Projets archivés »).   [Archiver] │
│ Supprimer définitivement         Réservé au superadmin. Projet archivé requis.    │
│                                  Tapez « KB » pour confirmer : [    ]  [Supprimer] │
└───────────────────────────────────────────────────────────────────────────────┘
```

| Méthode et route | Droits | Effet | Erreurs |
|---|---|---|---|
| `POST /projects/:key/archive` | admin projet | `archived: true`, `archivedAt`, `archivedBy` | — |
| `POST /projects/:key/unarchive` | admin projet | `archived: false` | — |
| `POST /projects/:key/transfer` | admin projet | `{ userId }` → `owner` ; le nouvel owner doit être membre (ajouté `admin` s'il ne l'est pas) | `400` utilisateur inactif |
| `DELETE /projects/:key` | superadmin | `{ confirmKey }` ; supprime Tasks, Taxonomies, Events, SavedFilters, Dashboards, ImportJobs, Counter puis Project ; réponse `{ deleted: { tasks, taxonomies, events, filters, dashboards, imports } }` | `409 { code: 'NOT_ARCHIVED' }`, `400 { code: 'CONFIRM_MISMATCH' }` |
| `GET /projects?archived=1` | admin projet / superadmin | Liste des projets archivés accessibles | — |

Projet archivé : middleware `blockWritesIfArchived` après `loadProject` → toute méthode non `GET` sur tâches, commentaires, rituels, taxonomies, sprints, versions, import renvoie `423 { code: 'PROJECT_ARCHIVED' }`. Restent autorisés : `unarchive`, `DELETE /projects/:key`, `export`, filtres et dashboards personnels. Bandeau client « Projet archivé — lecture seule » sur toutes les pages du projet.

---

## 6. Roadmap priorisée

### 6.1 Vue d'ensemble

| Lot | Contenu | Dépend de |
|---|---|---|
| **1.0 Socle** | Catégories de statut, `compileTaskQuery` + recherche Mongo + `fields=summary`, champs `Task` (A.1), fusion de `meta` et champs réservés, rôles projet et `loadProject`, blocage archivé, migration (Annexe C) | — |
| **1.1 Filtres sauvegardés** | Finaliser le backend en cours (écarts F-1 à F-8), barre de filtres, URL, filtre par défaut | 1.0 |
| **1.2 Admin projet v1** | Page à onglets : Général, Sprints & versions (cycle de vie complet), Membres, Workflow (catégories, ordre, remplacement), Taxonomies, Zone dangereuse ; users globaux déplacés | 1.0 |
| **1.3 Import Jira + export** | Assistant 4 étapes, CSV + JSON versions/sprints, idempotence, rapport, retour arrière ; export JSON/CSV | 1.0, 1.2 (sprints/versions meta) |
| **1.4 Dashboard v1** | Modèle, API, grille éditable, 8 widgets Lot 1, 3 modèles | 1.0, 1.1, 1.2 (snapshots de sprint) |
| **2** | Widgets v2 (aging, CFD, matrice, versions, rituels à venir, créées/résolues, note) ; transitions et WIP ; vue backlog avec rang ; UI parent/epic et étiquettes ; édition en masse ; notifications in-app, observateurs, @mentions ; import/export bundle Kýdos ; jours ouvrés dans le burndown ; colonnes configurables en vue liste | Lot 1 |
| **3** | Connexion API Jira (synchro), jetons API et webhooks, automatisations, pièces jointes, worklogs, timeline, liens entre tickets, sprints parallèles, types de champs personnalisés, requêtes textuelles façon JQL, temps réel (SSE) | Lot 2 |

Ordre de livraison du Lot 1 : 1.0 → (1.1 et 1.2 en parallèle) → 1.3 → 1.4. Chaque sous-lot est livrable seul et laisse l'application fonctionnelle.

Tests : chaque sous-lot ajoute ses tests au harnais existant `server/test/` (`npm test`, MongoDB réel) ; les fonctions pures (`layoutUtils`, `csv.js`, `jiraMapper.js`, `jiraDates.js`, `timeline.js`, `compileTaskQuery`) sont testées sans base. `npm run build` client (`tsc -b && vite build`) doit passer.

### 6.2 Détail du Lot 1

| Id | Élément | Fichiers principaux |
|---|---|---|
| S-1 | `status.meta.category`, `isDone` dérivé, `type.meta.isBug` | `taxonomies.routes.js`, `projects.routes.js` (défauts), `GroupStats.tsx`, `/stats` |
| S-2 | Fusion de `meta` en `PATCH /taxonomies/:id`, champs de cycle de vie réservés | `taxonomies.routes.js`, `server/src/utils/taxonomyMeta.js` |
| S-3 | `compileTaskQuery`, jetons, recherche Mongo, `filterId`, `fields=summary`, `limit/skip/sort` | `server/src/utils/taskQuery.js`, `tasks.routes.js`, `client/src/api/tasks.ts` |
| S-4 | Champs `Task` : `labels`, `parent`, `dueDate`, `resolvedAt`, `statusChangedAt`, `durationHours`, `external` + index | `Task.js`, `taskHistory.js` |
| S-5 | Rôles projet, `access`, `requireProjectRole`, `blockWritesIfArchived`, `myRole` | `Project.js`, `middleware/project.js`, toutes les routes projet |
| S-6 | Script de migration idempotent | `server/src/migrations/2026-09-lot1.js`, script `npm run migrate` |
| F | Filtres sauvegardés (§4) | `SavedFilter.js`, `savedFilters.routes.js`, `client/src/api/filters.ts`, `SavedFiltersBar.tsx`, `client/src/utils/boardUrlState.ts`, `BoardPage.tsx`, `Filters.tsx`, `ListBoard.tsx` |
| A | Admin projet v1 (§5.1–5.6, 5.8) | `ProjectSettingsPage.tsx`, `components/ProjectSettings/*`, `sprints.routes.js`, `versions.routes.js`, `members.routes.js`, `projects.routes.js`, `App.tsx`, `Header.tsx` |
| I | Import Jira et export (§5.7) | `server/src/import/*`, `ImportJob.js`, `import.routes.js`, `export.routes.js`, `JiraImportWizard.tsx` |
| D | Dashboard v1 (§3) | `Dashboard.js`, `dashboards.routes.js`, `analytics.routes.js`, `server/src/analytics/*`, `DashboardPage.tsx`, `components/Dashboard/*`, `components/Charts/*` |

### 6.3 Critères d'acceptation du Lot 1

Chaque critère est vérifiable par un test d'intégration (`server/test/`) ou une recette manuelle décrite.

#### Socle (S)

- **CA-S1** Après migration, chaque statut a `meta.category` ; `finished` et `confirmed` sont `done`, `onprocess`/`needreview`/`needconfirmation` sont `inprogress`, les autres `todo`. `isDone === (category === 'done')` pour tous.
- **CA-S2** `GroupStats` affiche les points « en cours » d'un statut nouvellement créé avec `category: 'inprogress'` sans modification de code.
- **CA-S3** `PATCH /taxonomies/:id` avec `meta: { goal: 'x' }` sur un sprint conserve `startDate`, `endDate`, `status`, `startSnapshot` existants ; `meta: { status: 'active' }` est ignoré (ou `400 LIFECYCLE_FIELD`) et le statut ne change pas.
- **CA-S4** `GET /tasks?assignee=@me&sprint=@current` renvoie exactement les tâches de l'appelant dans `project.currentSprint`.
- **CA-S5** `GET /tasks?search=LOGIN` renvoie les mêmes tâches que la version actuelle (test existant vert), sans charger toutes les tâches en mémoire (vérifié par revue : un seul `find` avec `$or`).
- **CA-S6** `GET /tasks?fields=summary` ne contient ni `history` ni `comments` ; le board s'affiche identique à avant.
- **CA-S7** Passage d'un statut dans la catégorie `done` : `resolvedAt` renseigné ; retour vers `todo` : `resolvedAt` remis à `null` ; `statusChangedAt` mis à jour à chaque changement de statut.
- **CA-S8** Projet `access: 'members'` : un développeur non membre reçoit `404` sur `GET /projects/:key`, `/tasks`, `/events`, `/filters` et ne voit pas le projet dans `GET /projects`.
- **CA-S9** Un `viewer` reçoit `403 READ_ONLY_ROLE` sur `POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/comments` ; un `member` reçoit `403` sur `DELETE /tasks/:id`.
- **CA-S10** Projet archivé : `POST /tasks` → `423 PROJECT_ARCHIVED` ; `GET /tasks` → `200`.
- **CA-S11** Le script de migration exécuté deux fois de suite produit le même état (aucune modification au second passage, compteur affiché `0`).

#### Filtres sauvegardés (F)

- **CA-F1** « Enregistrer sous » avec nom, visibilité privée, favori coché : le filtre apparaît en pastille, devient actif, l'URL devient `?filter=<id>`.
- **CA-F2** Rechargement de la page (F5) sur `?filter=<id>` : mêmes filtres, vue, regroupement et tri qu'à l'enregistrement.
- **CA-F3** Modification d'une pastille après application : indicateur « modifié » visible, URL contient l'état complet ; « Enregistrer » (propriétaire) met à jour le filtre et l'indicateur disparaît ; « ↺ » restaure l'état enregistré.
- **CA-F4** Un filtre défini par défaut s'applique à l'ouverture de `/projects/KB/board` sans paramètre ; aucun rendu intermédiaire du board non filtré (vérifié : une seule requête `GET /tasks`, portant les filtres).
- **CA-F5** Définir un autre filtre par défaut retire le précédent (un seul défaut par utilisateur et par projet) ; le défaut d'un utilisateur n'affecte pas les autres.
- **CA-F6** Un filtre privé est invisible (`404`) pour un autre utilisateur ; un filtre partagé est visible, applicable, mais « Enregistrer » est désactivé pour un non-propriétaire non admin, et `PATCH` renvoie `403`.
- **CA-F7** Un filtre contenant `sprint: ['@current']` suit le sprint courant : après démarrage d'un nouveau sprint, le même filtre affiche les tâches du nouveau sprint.
- **CA-F8** Un lien copié `?filter=<id>&status=pending` ouvert par un autre membre applique le filtre partagé avec `status` remplacé par `pending`, indicateur « modifié ».
- **CA-F9** `?filter=<id>` d'un filtre supprimé : toast « Filtre introuvable ou non partagé », paramètre retiré, filtre par défaut ou état vide appliqué.
- **CA-F10** Suppression d'un filtre utilisé par un widget de dashboard : `409 FILTER_IN_USE` listant les dashboards ; avec `?force=1`, suppression effective et le widget affiche « Filtre indisponible ».
- **CA-F11** Bouton Retour du navigateur après changement de filtre enregistré : revient au filtre précédent ; les bascules de pastilles ne créent pas d'entrée d'historique navigateur.
- **CA-F12** `groupBy: 'foo'` ou `sort.key: '$where'` → `400`.

#### Admin projet v1 (A)

- **CA-A1** `/projects/KB/admin` redirige vers `/projects/KB/settings/general` ; chaque onglet a une URL propre et survit au rechargement.
- **CA-A2** Un `member` voit tous les onglets en lecture seule (champs désactivés, aucun bouton d'action) ; les routes d'écriture renvoient `403`.
- **CA-A3** Général : modification du nom, du fuseau, de l'échelle d'estimation et des valeurs par défaut ; après enregistrement, `NewTaskModal` propose le statut, le type et la priorité par défaut et les valeurs de l'échelle.
- **CA-A4** Démarrer un sprint `ready` : statut `active`, `project.currentSprint` = ce sprint, `meta.startSnapshot.committedPoints` = somme des points des tâches du sprint à cet instant.
- **CA-A5** Démarrer un second sprint alors qu'un sprint est actif : `409 ACTIVE_SPRINT_EXISTS`, rien ne change.
- **CA-A6** Clôturer un sprint avec 4 tâches non terminées dont 1 cochée « garder », report vers le sprint suivant : 3 tâches changent de sprint avec une entrée d'historique `sprint` portant la note de report, 1 reste ; `meta.report.carriedOverTaskIds` contient les 3 ids ; statut `finished` ; `currentSprint` = cible si « démarrer immédiatement » coché, sinon `null`.
- **CA-A7** Clôture avec « Créer la rétrospective » : un `Event` de type `retro`, rattaché au sprint clos, liste les 3 tâches reportées et les participants = assignés distincts du sprint.
- **CA-A8** Clôture avec report vers « Backlog » : les tâches ont `sprint: null` et apparaissent dans le groupe « — Non défini — » / filtre `@none`.
- **CA-A9** `PATCH /projects/:key { currentSprint }` n'a plus d'effet ; `PATCH /sprints/:key { status }` → `400 LIFECYCLE_FIELD`.
- **CA-A10** Publier une version avec déplacement des tâches ouvertes : `meta.status: 'released'`, `releasedAt` renseigné, tâches non terminées déplacées avec historique, `project.currentVersion` mis à jour si demandé.
- **CA-A11** Membres : passage en `access: 'members'`, ajout de 2 membres (`member`, `viewer`) ; le viewer n'apparaît pas dans le sélecteur d'assigné ; retirer le dernier admin non superadmin sans superadmin actif → `409 LAST_ADMIN`.
- **CA-A12** Workflow : glisser un statut change l'ordre des colonnes du `JiraBoard` ; « Supprimer et réaffecter » un statut utilisé par 5 tâches → 5 tâches migrées avec historique, filtres enregistrés référant l'ancienne clé mis à jour ; suppression du dernier statut `done` → `409 CATEGORY_REQUIRED`.
- **CA-A13** Archivage : le projet disparaît de la liste, reste accessible via « Projets archivés », bandeau lecture seule affiché, création de tâche impossible (`423`) ; désarchivage rétablit tout.
- **CA-A14** Suppression définitive par un superadmin avec `confirmKey` correct sur un projet archivé : plus aucun document `Task`, `Taxonomy`, `Event`, `SavedFilter`, `Dashboard`, `ImportJob`, `Counter` pour ce projet ; sans archivage préalable → `409 NOT_ARCHIVED` ; clé erronée → `400 CONFIRM_MISMATCH` ; admin projet non superadmin → `403`.
- **CA-A15** L'administration des utilisateurs est accessible via `/admin/users` (superadmin) et n'apparaît plus dans les onglets du projet.

#### Import Jira et export (I)

Jeux d'essai à versionner dans `server/test/fixtures/jira/` : `export-en.csv` (format de date anglais, 3 colonnes Sprint, 2 Fix Version/s, commentaires, epics, sous-tâches, champs multilignes entre guillemets), `export-fr.csv` (séparateur `;`, dates françaises), `versions.json`, `sprints.json`.

- **CA-I1** `analyze` sur `export-en.csv` : nombre de lignes exact (champs multilignes compris), colonnes dupliquées regroupées avec `occurrences`, statuts/types/sprints/utilisateurs détectés avec leurs comptes, mapping suggéré pour `Summary`, `Status`, `Issue Type`, `Priority`, `Sprint`, `Fix Version/s`, `Story Points`.
- **CA-I2** `preview` n'écrit rien en base (compte des tâches et taxonomies identique avant/après) et annonce les créations, mises à jour, avertissements.
- **CA-I3** `commit` : les tâches créées ont titre, statut, type, priorité, points, assigné mappé, sprint = dernier sprint du ticket, version, étiquettes, `createdAt`/`updatedAt`/`resolvedAt` issus du CSV, `external.key` = clé Jira.
- **CA-I4** Réimport du même fichier : 0 création, 0 doublon, tâches inchangées marquées « mises à jour » sans nouvelle entrée d'historique ; une valeur modifiée dans le CSV produit exactement une entrée d'historique.
- **CA-I5** Avec `sprints.json` : sprints créés avec dates, objectif et statut (`closed → finished`) ; le widget vélocité affiche les sprints clos importés (`source: 'import'`) sans action supplémentaire.
- **CA-I6** Commentaires importés avec date d'origine et auteur mappé ; auteur non mappé → importateur, texte préfixé `[Nom Jira] `.
- **CA-I7** `epicMode: 'parent'` : chaque sous-ticket a `parent` = taskId Kýdos de son epic ; parent absent → avertissement et `parent: null`.
- **CA-I8** Clés `KB-…` sur un projet `KB` conservées ; clés `ABC-…` renumérotées `KB-…` ; créer ensuite une tâche à la main produit un id supérieur au max importé.
- **CA-I9** `export-fr.csv` (séparateur `;`, dates `14/sept./26 10:32`) importé sans erreur de date.
- **CA-I10** Une ligne invalide (titre vide) est ignorée, listée dans le rapport, et n'empêche pas l'import des autres.
- **CA-I11** Un second `commit` pendant un import en cours → `409 IMPORT_RUNNING` ; la progression est lisible via `GET /import/jobs/:id`.
- **CA-I12** Retour arrière : tâches créées et non modifiées supprimées ; une tâche créée puis modifiée à la main est conservée et listée dans `tasksKept` ; taxonomies créées et non référencées supprimées.
- **CA-I13** Import de 5 000 lignes terminé en moins de 60 s sur un poste de développement (MongoDB local), sans dépasser la limite de 25 Mo par requête.
- **CA-I14** Export JSON puis inspection : contient projet, taxonomies, tâches avec historique et commentaires, rituels ; aucun `passwordHash`. Export CSV d'un filtre : mêmes tâches que le board filtré, ouvrable dans Excel FR avec `sep=semicolon`.
- **CA-I15** Import refusé à un `member` (`403`) et sur projet archivé (`423`).

#### Dashboard v1 (D)

- **CA-D1** Création d'un dashboard depuis le modèle `sprint` : 5 widgets positionnés sans chevauchement, filtre global `sprint: @current`.
- **CA-D2** Mode édition : déplacer un widget sur un autre pousse le second en dessous, sans chevauchement ; redimensionner respecte les tailles minimales et la limite de 12 colonnes ; « Annuler » restaure l'état serveur.
- **CA-D3** « Enregistrer » puis rechargement : disposition et configuration identiques.
- **CA-D4** Deux onglets modifient le même dashboard : le second enregistrement reçoit `409 REVISION_CONFLICT` et le bandeau propose recharger ou enregistrer une copie.
- **CA-D5** `kpi` points avec filtre `statusCategory: ['todo','inprogress']` = somme des points des tâches correspondantes sur le board filtré à l'identique.
- **CA-D6** `breakdown` par `category` en donut : une part par catégorie présente, couleurs et libellés des taxonomies, somme = total ; bascule « Voir en tableau » affiche les mêmes valeurs.
- **CA-D7** `sprintBurndown` sur un sprint de test construit par API (démarrage J0 avec 20 points, 5 points terminés J2, 3 points ajoutés J3) : `committed = 20`, `remaining` J2 = 15, `scope` J3 = 23, `scopeChanges` contient l'ajout.
- **CA-D8** `velocity` sur 3 sprints clos via le cycle de vie : valeurs `committed`/`completed` = `meta.report`, moyenne correcte.
- **CA-D9** `workload` : une barre par assigné + « Non assigné », empilée par catégorie de statut, ligne de capacité si `capacityPerUser` renseigné.
- **CA-D10** `taskList` alimenté par un filtre sauvegardé : mêmes tâches que le board avec ce filtre (dans la limite `limit`) ; clic ouvre la tâche en popup.
- **CA-D11** Dashboard partagé : visible et consultable par un autre membre, non modifiable (`403`), duplicable ; un widget pointant vers un filtre privé de son propriétaire affiche « Filtre indisponible » pour les autres.
- **CA-D12** Modification d'une tâche (statut) depuis le dashboard ou le board : les widgets se mettent à jour sans rechargement de page.
- **CA-D13** Largeur 400 px : widgets empilés sur une colonne, pas de défilement horizontal de page, bouton « Modifier » masqué.
- **CA-D14** Aucune dépendance ajoutée à `client/package.json` ni `server/package.json` pour le dashboard.

---

## Annexe A — Évolutions de modèle communes

### A.1 `Task`

```js
labels:          { type: [String], default: [] },          // index { project: 1, labels: 1 }
parent:          { type: String, default: null },          // taskId du parent
dueDate:         { type: Date, default: null },
resolvedAt:      { type: Date, default: null },            // entrée dans la catégorie done
statusChangedAt: { type: Date, default: null },            // dernier changement de statut
durationHours:   { type: Number, default: 0 },             // dérivé de duration à l'écriture (hoursOf)
external: {
  source:       { type: String },                          // 'jira'
  key:          { type: String },                          // 'ABC-123'
  id:           { type: String },
  url:          { type: String },
  importJob:    { type: Schema.Types.ObjectId, ref: 'ImportJob' },
  assigneeName: { type: String },
},
```

Index :
- `{ project: 1, 'external.source': 1, 'external.key': 1 }` unique, `partialFilterExpression: { 'external.key': { $exists: true } }`
- `{ project: 1, sprint: 1 }`, `{ project: 1, assignee: 1 }`, `{ project: 1, updatedAt: -1 }`, `{ project: 1, labels: 1 }`

`taskHistory.js` :
- `TRACKED_FIELDS` += `labels`, `parent`, `dueDate`.
- `applyPatchWithHistory(task, patch, user, note, ctx)` : `ctx.doneKeys` (Set) pour maintenir `resolvedAt` ; `statusChangedAt = now` si le statut change ; `durationHours` recalculé si `duration` change.

### A.2 `Taxonomy.meta` par kind

| kind | Clés `meta` | Réservées (cycle de vie, non modifiables par `PATCH /taxonomies`) |
|---|---|---|
| `status` | `category: 'todo'\|'inprogress'\|'done'` (requis), `isDone` (dérivé), `wipLimit?` (Lot 2), `allowedTo?` (Lot 2) | `isDone` |
| `type` | `isBug?: boolean` | — |
| `sprint` | `startDate`, `endDate`, `goal`, `linkedVersion` | `status`, `startedAt`, `startedBy`, `startSnapshot { at, committedPoints, committedCount, taskIds }`, `closedAt`, `closedBy`, `report { committedPoints, committedCount, completedPoints, completedCount, carriedOverTaskIds, carriedTo, keptTaskIds, source }`, `reopenedAt` |
| `version` | `startDate`, `releaseDate`, `description` | `status`, `releasedAt` |
| `eventType` | `icon`, `features` | — |
| tous | `external?: { source, id, name }` | — |

`PATCH /taxonomies/:id` : `item.meta = { ...item.meta, ...omit(body.meta, RESERVED[kind]) }` puis `item.markModified('meta')`. Une clé envoyée à `null` est supprimée. Validation dans `server/src/utils/taxonomyMeta.js`.

### A.3 `Project`

```js
access:     { type: String, enum: ['open', 'members'], default: 'open' },
members:    [{
  user:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role:    { type: String, enum: ['admin', 'member', 'viewer'], default: 'member' },
  addedAt: { type: Date, default: Date.now },
  addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}],
timezone:    { type: String, default: 'Europe/Paris' },
workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },        // 0 = dimanche
estimation:  {
  unit:  { type: String, enum: ['points', 'hours'], default: 'points' },
  scale: { type: [Number], default: [1, 2, 3, 5, 8, 13] },
},
defaults: { status: String, type: String, priority: String },
workflow: { enforceTransitions: { type: Boolean, default: false } },  // Lot 2
archivedAt: Date,
archivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
```

Index : `{ 'members.user': 1 }`.

### A.4 Nouvelles collections

| Collection | Section |
|---|---|
| `SavedFilter` (en cours) | §4.2 |
| `Dashboard` | §3.4 |
| `ImportJob` | §5.7.3 |

### A.5 Nouvelles routes montées dans `server/src/index.js`

```js
mount('/api/projects/:projectKey/sprints', sprintsRoutes);
mount('/api/projects/:projectKey/versions', versionsRoutes);
mount('/api/projects/:projectKey/members', membersRoutes);
mount('/api/projects/:projectKey/dashboards', dashboardsRoutes);
mount('/api/projects/:projectKey/analytics', analyticsRoutes);
mount('/api/projects/:projectKey/import', importRoutes);   // après le express.json 25 Mo existant
mount('/api/projects/:projectKey/export', exportRoutes);
```

---

## Annexe B — Format des exports Jira et règles de conversion

### B.1 Colonnes CSV reconnues (Jira Cloud et Data Center, en-têtes anglais)

| Colonne Jira | Multiple | Champ Kýdos | Conversion |
|---|---|---|---|
| `Summary` | non | `title` | tronqué à 500 caractères |
| `Issue key` | non | `external.key`, `taskId` | voir `taskIdStrategy` |
| `Issue id` | non | `external.id` | — |
| `Issue Type` | non | `type` | mapping de valeurs |
| `Status` | non | `status` | mapping de valeurs |
| `Status Category` | non | catégorie des statuts créés | `To Do→todo`, `In Progress→inprogress`, `Done→done` |
| `Priority` | non | `priority` | défaut suggéré : `Highest→P0`, `High→P1`, `Medium→P2`, `Low→P3`, `Lowest→P3` |
| `Assignee` / `Assignee Id` | non | `assignee` | mapping utilisateurs (accountId prioritaire) |
| `Reporter` / `Reporter Id` | non | `reporter` | idem ; non mappé → importateur |
| `Created`, `Updated`, `Resolved`, `Due date` | non | `createdAt`, `updatedAt`, `resolvedAt`, `dueDate` | B.4 |
| `Sprint` | **oui** | `sprint` + historique | dernier non vide = sprint courant |
| `Fix Version/s` | **oui** | `version` | `highest` (tri sémantique, même fonction que `compareVersions` du seed) ou `first` |
| `Affects Version/s` | oui | ignoré en Lot 1 | — |
| `Component/s` | oui | `area` (défaut suggéré) | premier composant ; les autres ajoutés en `labels` avec préfixe `component:` |
| `Labels` | **oui** | `labels` | tel quel |
| `Custom field (Story Points)` / `Custom field (Story point estimate)` | non | `complexity` | nombre, virgule acceptée |
| `Original Estimate`, `Time Spent` | non | `estimate`, `duration` | secondes → `Nh` (arrondi 0,5) |
| `Parent`, `Parent id`, `Parent summary`, `Custom field (Epic Link)` | non | `parent` | clé ou id Jira résolus en 2e passe |
| `Description` | non | `description` | brut |
| `Comment` | **oui** | `comments[]` | B.3 |
| `Watchers`, `Attachment`, `Log Work`, `Outward issue link (*)` | oui | ignorés en Lot 1 (comptés dans l'analyse) | — |

Détection de colonne insensible à la casse et aux espaces ; en-têtes localisés (ex. `Résumé`, `État`, `Priorité`, `Responsable`) proposés via une table de synonymes `server/src/import/jiraHeaders.js`.

### B.2 JSON attendus

Versions (`GET /rest/api/3/project/{key}/versions`) : tableau de `{ id, name, description?, archived, released, startDate?: 'YYYY-MM-DD', releaseDate?: 'YYYY-MM-DD' }`.

Sprints (`GET /rest/agile/1.0/board/{boardId}/sprint`) : objet `{ values: [...] }`, tableau de tels objets (pages), ou tableau de sprints `{ id, name, state: 'future'|'active'|'closed', startDate?, endDate?, completeDate?, goal? }` (dates ISO 8601). Correspondance avec le CSV par `name` exact, puis insensible à la casse.

### B.3 Commentaires CSV

Valeur d'une colonne `Comment` : `<date>;<accountId ou username>;<texte>`. Découpage sur les **deux premiers** `;` uniquement (le texte peut contenir `;`). Si le format ne correspond pas (pas de date reconnue en tête), le commentaire entier devient le texte, date = `Updated`, avec avertissement `COMMENT_FORMAT`.

### B.4 Dates

Ordre de détection (sur les 50 premières valeurs non vides de `Created`) :
1. ISO 8601 (`2026-09-14T10:32:00.000+0200`)
2. `dd/MMM/yy h:mm a` (`14/Sep/26 10:32 AM`) — défaut Jira Cloud anglais
3. `dd/MMM/yy HH:mm` avec mois abrégés français (`janv.`, `févr.`, `mars`, `avr.`, `mai`, `juin`, `juil.`, `août`, `sept.`, `oct.`, `nov.`, `déc.`, points optionnels)
4. `yyyy-MM-dd HH:mm`
5. `dd/MM/yyyy HH:mm`

Fuseau : dates sans décalage interprétées dans `project.timezone`. Valeur non reconnue → avertissement `DATE_UNPARSED`, champ laissé vide (`createdAt` = date d'import).

---

## Annexe C — Migration des données existantes

Script `server/src/migrations/2026-09-lot1.js` (idempotent, `npm run migrate`, journal par étape) :

1. **Statuts** : `meta.category` absent → `done` si `meta.isDone`, `inprogress` si clé ∈ `onprocess, needreview, needconfirmation, tested` **et** `isDone` faux, sinon `todo`. Recalcul de `isDone`. (Le seed marquait `tested` comme terminé : il reste `done`, conformément aux données.)
2. **Types** : `meta.isBug = true` sur la clé `bug`.
3. **Backlog** : tâches `sprint: 'backlog'` → `sprint: null` (entrée d'historique `note: 'Migration : backlog explicite'`), taxonomie `sprint/backlog` archivée ; `DEFAULT_TAXONOMIES.sprint` vidé dans `projects.routes.js`.
4. **Sprints** : si plusieurs sprints `active`, garder celui égal à `project.currentSprint` (sinon le plus récent par `startDate`), les autres passent `finished` ; `project.currentSprint` pointant vers un sprint non actif → mis à `null` et consigné dans le journal (l'admin redémarre le sprint).
5. **Versions** : `meta.status` absent → `released` si la version est inférieure à `project.currentVersion` (comparaison sémantique), sinon `unreleased`.
6. **Tâches** : `resolvedAt` = `at` de la dernière entrée d'historique `status` vers une clé `done` (si statut actuel `done`) ; `statusChangedAt` = `at` de la dernière entrée `status`, sinon `updatedAt` ; `durationHours` depuis `duration` ; `labels: []`.
7. **Projets** : `access: 'open'`, `members: [{ user: owner, role: 'admin' }]` si vide, `timezone`, `workingDays`, `estimation`, `defaults` (`status` = premier statut `todo` d'ordre ≥ 1 sinon premier `todo`, `type` = `feature` si existe, `priority` = `P2` si existe).
8. **Seed** : `server/src/seed/seed.js` aligné (catégories, pas de sprint `backlog`, versions avec statut) pour qu'une base neuve soit directement à l'état migré.

---

## Annexe D — Points de vigilance

1. **Travail parallèle non commité** (`SavedFilter`, tests, route d'import réservée) : à commiter ou rebaser avant de démarrer 1.0 pour éviter les conflits ; la spec §4 s'y aligne volontairement (`shared`, `starredBy`, `defaultFor`, `PUT /star`, `PUT /default`).
2. **Sources de vérité uniques** : après Lot 1, le sprint courant est dérivé du cycle de vie et la « terminaison » d'un statut de sa catégorie. Tout nouveau code qui teste `isDone` ou une liste de clés en dur est à refuser en revue.
3. **Historique embarqué non borné** : `Task.history` grossit à chaque changement (limite 16 Mo par document, en pratique lointaine) ; les analyses font des `$unwind`. Surveiller au-delà de ~20 000 tâches par projet ; prévoir en Lot 3 une collection `TaskEvent` si nécessaire.
4. **Qualité du burndown** : fiable seulement pour les sprints démarrés après Lot 1 (instantané) ou importés avec JSON des sprints. L'historique du seed (`from: null`) et du CSV Jira (pas de transitions) donne des courbes approximatives : afficher l'avertissement `HISTORY_INCOMPLETE`, ne pas masquer.
5. **Variabilité des exports Jira** : langue de l'utilisateur exportateur (en-têtes et dates), noms des champs de story points, limite de 1 000 tickets par export Cloud. D'où fixtures réelles anonymisées indispensables avant de fermer 1.3.
6. **Pas de transactions MongoDB** supposées (instance standalone dans `docker-compose.yml`) : clôture de sprint, remplacement de taxonomie et import sont conçus pour être rejouables ; ne pas introduire de logique qui suppose l'atomicité multi-documents.
7. **Changement de droits perceptible** : les développeurs ne pourront plus supprimer de tâches ni éditer les paramètres ; à annoncer. Le mode `access: 'open'` par défaut évite toute perte d'accès à la migration.
8. **Confidentialité** : un superadmin ne voit pas les filtres et dashboards privés des autres (choix assumé, cohérent avec le code en cours) ; l'export JSON n'inclut que les éléments partagés.
9. **Fuseau horaire** : les agrégats quotidiens (burndown, CFD) dépendent de `project.timezone` ; le serveur Node doit calculer les bornes de jour avec `Intl.DateTimeFormat` et non avec l'heure locale de la machine.
10. **Charge des requêtes du board** : sans `fields=summary`, un projet importé de plusieurs milliers de tickets rendra le board lent (historique et commentaires envoyés) ; S-3 est un prérequis bloquant de 1.3.
11. **Téléchargements authentifiés** : le JWT est en `localStorage` et transmis en en-tête ; les exports doivent passer par `fetch` + blob, pas par un lien direct.
12. **Pas de dépendance ajoutée** : l'analyseur CSV, les graphes, la grille et le cache sont maison ; les écrire comme fonctions pures couvertes par `node --test` pour compenser.
