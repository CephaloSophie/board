# Contexte pour l'IA — état de l'existant

> But de ce document : permettre à un agent IA (ou un nouveau dev) de
> **comprendre rapidement tout ce qui existe** et de reprendre le travail
> sans re-explorer tout le code. À lire en premier.

## En une phrase

SPA React/TypeScript + API Node/Express/Mongoose (MongoDB) qui remplace un
board statique (`board.html` + `tasks.json`) par une vraie application type
Jira : boards multiples, drag & drop, sprints, rituels agiles, taxonomies
configurables, auth JWT à 2 rôles.

## Ce qui est FAIT (exhaustif)

- **Auth** : login JWT, `GET /me`, 2 rôles (`superadmin`, `developer`),
  hachage bcrypt, middleware `requireAuth` / `requireRole`.
- **Projets multiples** : CRUD, clé (`KB`), version courante, cadence de
  sprint, sprint courant, stats. Création d'un projet → taxonomies par défaut.
- **Taxonomies unifiées** : une seule collection `Taxonomy` pour 9 dimensions
  (`status, priority, area, type, techno, category, version, sprint,
  eventType`). CRUD + **archivage** + garde-fou de suppression.
- **Tâches** : CRUD, id auto (`KB-155` via `Counter`), filtres multi-select +
  recherche, commentaires, **historique auto** des champs suivis, assignation,
  sprint/version, points (`complexity`, coercition robuste).
- **3 vues de board** : groupé (mini-board par groupe + sidebar + stats),
  Jira (kanban simple), Liste (tableau triable). **Drag & drop** de statut.
- **Regroupement** dynamique par sprint/version/catégorie/techno/domaine/
  type/priorité/statut/assigné, avec stats par groupe.
- **Sprints** : statut (draft/ready/active/finished), dates, objectif ; durée
  par défaut (jours/semaines) qui n'affecte que les futurs sprints ; sprint
  courant ; boutons précédent/suivant sur une tâche.
- **Rituels/événements** : modèle `Event`, types configurables (`eventType`
  avec icône + `features`), sections pilotées par type (participants, backlog,
  estimation, agenda, décisions, actions, ADR, démo, notes). Rattachement à un
  sprint, participants, tâches liées. Ajout rapide depuis une tâche (icône ⊕).
- **Admin** : taxonomies, utilisateurs, paramètres projet.
- **4 thèmes** : dark (défaut), light, ubuntu, mac (variables CSS).
- **Ops** : Docker Compose, Dockerfile (client servi par l'API), PM2
  (server + client), `.env` par app, seed depuis `tasks.json`.

## Ce qui N'EST PAS fait / limites connues

- Pas de tests automatisés (unit/e2e) — vérifié par build + `node --check` +
  chargement des modules + smoke des routes.
- Pas d'inscription publique : le super admin crée les comptes.
- Suppression d'utilisateur = **désactivation** (soft delete) pour préserver
  les références (assigné, auteur de commentaire).
- Le `stats.totalPoints` somme `complexity` (nombre) ; d'anciennes données
  pouvaient contenir `"1 h"` → désormais coercées en nombre au seed et via un
  setter Mongoose.
- Environnement de build d'origine : pas d'accès à un MongoDB réel (binaire
  bloqué), donc pas de test bout-en-bout contre une vraie base pendant le dev.

## Carte du code (où toucher quoi)

### Backend (`server/src`)
| Besoin | Fichier |
|--------|---------|
| Config / env | `config.js` |
| Connexion DB | `db.js` |
| Montage routes / SPA | `index.js` |
| Modèle utilisateur | `models/User.js` |
| Modèle projet (cadence sprint) | `models/Project.js` |
| Taxonomies (9 kinds) | `models/Taxonomy.js` |
| Tâche (comments/history subdocs) | `models/Task.js` |
| Événement agile | `models/Event.js` |
| Id séquentiel projet | `models/Counter.js` |
| Auth + rôles | `middleware/auth.js` |
| Résolution projet | `middleware/project.js` |
| Journalisation champs tâche | `utils/taskHistory.js` |
| Import initial | `seed/seed.js` |

### Frontend (`client/src`)
| Besoin | Fichier |
|--------|---------|
| Client HTTP + token | `api/client.ts` |
| Hooks react-query | `api/{auth,users,projects,taxonomies,tasks,events}.ts` |
| Auth (contexte) | `context/AuthContext.tsx` |
| Thèmes | `context/ThemeContext.tsx` + `styles/themes.css` |
| Routes | `App.tsx` |
| En-tête + menu | `components/Layout/Header.tsx` |
| Vues board | `components/Board/{GroupedBoard,JiraBoard,ListBoard}.tsx` |
| Regroupement/stats | `components/Board/{groupUtils.ts,GroupStats.tsx,GroupSidebar.tsx}` |
| Filtres | `components/Board/Filters.tsx` |
| Détail tâche | `components/Task/TaskDetail.tsx` |
| Ajout tâche→événement | `components/Task/AddToEventPopup.tsx` |
| Événements | `components/Event/*` + `pages/EventsPage.tsx` |
| Admin | `components/Admin/*` + `pages/AdminPage.tsx` |
| Types partagés | `types.ts` |

## Conventions & pièges

- **Header hors des `<Routes>` imbriquées** : `useParams()` n'y voit pas
  `:projectKey`. Le Header le **dérive de `location.pathname`** (regex). Ne
  pas régresser vers `useParams` dans le Header.
- **Taxonomies** : toute dimension configurable passe par `Taxonomy` (kind).
  Ajouter une dimension = ajouter un `kind`, pas une collection.
- **Historique** : `PATCH /tasks/:id` journalise via `applyPatchWithHistory`
  (liste `TRACKED_FIELDS`). Ajouter un champ suivi = l'ajouter à cette liste.
- **Points** (`complexity`) : toujours coercer (setter modèle + `toPoints` du
  seed) ; des sources externes peuvent envoyer des chaînes.
- **eventType.features** : pilote les sections affichées d'un événement. Les
  clés valides sont dans `EventFeature` (`types.ts`) et l'UI
  (`components/Event/eventConfig.ts`, `EventDetail.tsx`).
- **Ports** : API `7002`, client `7001` (via `.env`). Le client proxifie
  `/api` vers l'API.
- **React Query** : invalidations par clés `['tasks', projectKey, filters]`,
  `['taxonomies', projectKey]`, `['events', projectKey]`, etc. Respecter ces
  clés lors d'ajouts.

## Modèle de données (résumé)

`User(role)` · `Project(key, currentVersion, sprintDurationValue/Unit,
currentSprint)` · `Taxonomy(project, kind, key, label, color, order, meta,
archived)` · `Task(taskId, status, priority, sprint, version, assignee,
complexity, comments[], history[])` · `Event(type, sprint, participants[],
tasks[], agenda, decisions[], actionItems[], adr{})` · `Counter(_id=projectKey,
seq)`.

Voir `docs/README.architecture.md` pour les détails et les décisions.

## Prochaines évolutions naturelles (non commencées)

- Tests (Jest/Vitest côté API, Playwright côté client).
- Réordonnancement des tâches dans une colonne (rang), pas seulement le statut.
- Notifications / activité temps réel.
- Export CSV / rapports de sprint (burndown).
