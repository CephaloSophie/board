# Architecture — Kýdos Board

## Vue d'ensemble

```
┌─────────────────────────┐        HTTP /api        ┌──────────────────────────┐
│  Client React (Vite)    │  ───────────────────▶   │  API Express (Node)      │
│  :7001                  │   Bearer JWT            │  :7002                   │
│  - react-query (cache)  │  ◀───────────────────   │  - middleware auth/role  │
│  - dnd-kit (drag&drop)  │        JSON             │  - routes REST           │
│  - 4 thèmes (CSS vars)  │                         │  - Mongoose ODM          │
└─────────────────────────┘                         └────────────┬─────────────┘
                                                                  │
                                                                  ▼
                                                         ┌──────────────────┐
                                                         │   MongoDB        │
                                                         │  collections:    │
                                                         │  users, projects,│
                                                         │  taxonomies,     │
                                                         │  tasks, events,  │
                                                         │  counters        │
                                                         └──────────────────┘
```

En développement, le client (Vite `:7001`) **proxifie `/api`** vers l'API
(`:7002`). En production Docker, l'API sert aussi le build statique du client
(`client/dist`), tout sur `:7002`.

## Modèle de données

### `User`
Compte applicatif. `role ∈ {superadmin, developer}`. Mot de passe stocké
haché (bcrypt). `toPublic()` masque le hash. Suppression = `active:false`
(soft delete) pour préserver les références.

### `Project`
Un projet = une **clé** unique (ex. `KB`) + métadonnées. Porte la **cadence
de sprint** : `sprintDurationValue` + `sprintDurationUnit` (`days|weeks`,
défaut 1 semaine) et `currentSprint`. Méthode `effectiveSprintDays()`.
> Décision : la durée n'est **pas** stockée sur chaque sprint ; chaque sprint
> garde ses propres `startDate/endDate`. Changer la cadence n'affecte donc que
> les **futurs** sprints — aucun recalcul rétroactif.

### `Taxonomy` (collection unifiée)
Une seule collection pour **9 dimensions configurables** par projet :
`status, priority, area, type, techno, category, version, sprint, eventType`.
Champs : `project, kind, key, label, color, order, meta, archived`. Index
unique `(project, kind, key)`.
> Décision : au lieu de 9 collections quasi identiques, une seule collection
> paramétrée par `kind`. L'admin CRUD est ainsi **générique**. Le champ `meta`
> (Mixed) porte les spécificités : `{isDone}` pour un statut, `{status,
> startDate, endDate, goal, linkedVersion}` pour un sprint, `{icon, features}`
> pour un `eventType`.

### `Task`
Cœur métier. Champs de dimension (`status, priority, sprint, version, type,
category, techno, area`) référencés par **clé de taxonomie** (chaînes, pas
d'ObjectId) — souple et lisible. `assignee`/`reporter` sont des refs `User`.
Deux **sous-documents** :
- `comments[]` — auteur, texte, dates.
- `history[]` — journal `{at, by, byLabel, field, from, to, note}`.
`complexity` (points) a un **setter** qui coerce toute valeur en nombre fini.
Index unique `(project, taskId)`, plus index texte `title/description`.

### `Event`
Cérémonie agile. `type` = clé d'un `eventType`. Rattachable à un `sprint`
(optionnel). Contient `participants[]` (refs User), `tasks[]` (backlog lié,
avec note/outcome/presenter/order), `agenda`, `decisions[]`, `actionItems[]`
(texte + assignee + done), `adr{context,decision,alternatives,consequences}`.
> Décision : **un seul schéma flexible** couvre tous les types ; l'UI n'affiche
> que les sections listées dans `eventType.meta.features`. Ajouter un type =
> une ligne de taxonomie, sans changement de schéma ni de code.

### `Counter`
Un document par projet (`_id = clé`, `seq`). `nextTaskNumber()` fait un
`$inc` atomique → identifiants `KB-155` sans course sur la collection `Task`.

## Flux principaux

### Authentification
`POST /auth/login` → vérifie bcrypt → signe un JWT `{sub, role}` →
le client stocke le token (localStorage) et l'envoie en `Bearer`.
`requireAuth` recharge le `User` et vérifie `active`. `requireRole` filtre
les actions super admin.

### Résolution de projet
Les routes imbriquées `/api/projects/:projectKey/...` passent par
`loadProject` qui met `req.project` à disposition (clé normalisée en
majuscules).

### Écriture d'une tâche + historique
`PATCH /tasks/:taskId` → `applyPatchWithHistory(task, patch, user, note)` :
compare chaque champ suivi (`TRACKED_FIELDS`), pousse une entrée d'historique
par changement, applique les champs libres (description, instructions…), puis
`save()`. Le drag & drop du board est un simple `PATCH {status}`.

### Filtrage des tâches
`GET /tasks` accepte des paramètres **répétables** (`?status=a&status=b` ou
`?status=a,b`) sur chaque dimension, plus `assignee` et `search` (texte sur
id/titre/description/instructions/acceptance). Le client construit ces query
strings dans `api/tasks.ts`.

## Frontend

### Routing (`App.tsx`)
`/login` public ; le reste sous `Protected` + `Layout`. Routes projet :
`/projects/:projectKey/{board,events,admin}` et `/tasks/:taskId`.
> Piège connu : le `Header` est **au-dessus** des `<Routes>` imbriquées, donc
> `useParams()` n'y voit pas `:projectKey`. Il le **dérive de l'URL**
> (`location.pathname`) pour afficher le menu et l'onglet actif.

### État serveur (react-query)
Toute donnée serveur passe par des hooks (`api/*.ts`) avec clés de cache
stables (`['tasks', projectKey, filters]`, `['taxonomies', projectKey]`,
`['events', projectKey]`…). Les mutations invalident les clés concernées ;
`useUpdateTask` fait en plus une **mise à jour optimiste** pour le drag & drop.

### Regroupement du board (`groupUtils.ts`)
`groupTasks(tasks, groupBy, taxonomies)` répartit les tâches en groupes
ordonnés/colorés d'après la taxonomie. Chaque vue (Grouped/Jira/List) rend un
bloc par groupe + une `GroupSidebar` (navigation) + `GroupStats` (points à
faire/en cours/terminés, non assignés). Le drag & drop utilise des identifiants
de zone `"<groupKey>::<statusKey>"` pour distinguer une même colonne répétée
dans plusieurs groupes.

### Thèmes
`ThemeContext` pose `data-theme` sur `<html>` et persiste le choix. Les 4
thèmes sont des jeux de **variables CSS** dans `styles/themes.css` ; tout le
reste (`global.css`) consomme ces variables.

## Sécurité

- JWT signé côté serveur, secret via `JWT_SECRET`.
- Mots de passe bcrypt (coût 10).
- Autorisations par rôle sur les mutations sensibles (`requireRole`).
- CORS restreint à `CLIENT_ORIGIN` (`*` possible en dev/Docker).
- Suppressions bloquées si la valeur est encore référencée (taxonomies).

## Décisions d'architecture (résumé)

1. **Taxonomie unique par `kind`** plutôt que N collections → CRUD générique,
   extensible (ajout d'une dimension = un `kind`).
2. **Dimensions référencées par clé** (chaînes) sur la tâche → lisibilité,
   filtres simples, moins de jointures.
3. **Cadence de sprint non rétroactive** → chaque sprint fige ses dates.
4. **Événements = un schéma flexible + `features`** → tous les types de rituel
   sans multiplier les modèles.
5. **Historique dénormalisé** dans `Task.history[]` → lecture immédiate de la
   chronologie sans agrégation.
6. **Compteur atomique par projet** → identifiants lisibles et sans course.
