# API Kýdos Board

Base : `/api`. Authentification : `Authorization: Bearer <jwt>` (sauf login et health).
Réponses JSON ; erreurs `{ error: "message FR", code?: "CODE_MACHINE", ... }`.

Codes courants : `400` validation / id mal formé (`CastError`), `401` session, `403` droits
(`PROJECT_ROLE_REQUIRED`, `READ_ONLY_ROLE`), `404` introuvable ou projet non accessible, `409`
conflit (doublon, `CATEGORY_REQUIRED`, `ACTIVE_SPRINT_EXISTS`, `REVISION_CONFLICT`…), `413` trop
volumineux, `422` données inexploitables (`MAPPING_INCOMPLETE`, `SPRINT_WITHOUT_DATES`), `423`
projet archivé (`PROJECT_ARCHIVED`).

Rôles projet : `viewer` < `member` < `admin` (super admin et responsable = admin). Colonne
« Droits » : minimum requis ; « lecture » = tout rôle.

## Authentification et utilisateurs

| Méthode | Route | Droits | Description |
|---|---|---|---|
| POST | `/auth/login` | public | `{ username, password }` → `{ token, user }` |
| GET | `/auth/me` | connecté | profil |
| GET | `/users` | connecté | utilisateurs actifs ; `?includeInactive=1` (super admin) |
| POST / PATCH / DELETE | `/users[/:id]` | super admin | créer, modifier (`password` pour réinitialiser, `active`), désactiver |

## Projets

| Méthode | Route | Droits | Description |
|---|---|---|---|
| GET | `/projects` | connecté | projets accessibles (+ `myRole`) ; `?archived=1` : archivés administrés |
| POST | `/projects` | super admin | `{ key, name, vendor?, description?, currentVersion? }` + taxonomies par défaut |
| GET | `/projects/:key` | lecture | projet + `myRole` |
| PATCH | `/projects/:key` | admin | name, vendor, description, currentVersion, sprintDurationValue/Unit, timezone, workingDays, estimation `{unit, scale}`, defaults `{status,type,priority}`, access (`SELF_LOCKOUT`) ; `currentSprint` ignoré |
| GET | `/projects/:key/stats` | lecture | total, done, inProgress, bugs, openBugs, totalPoints, donePoints |
| GET | `/projects/:key/overview` | lecture | tâches, ouvertes, membres, sprints, sprint actif, dernière activité |
| GET | `/projects/:key/labels` | lecture | étiquettes utilisées `{ value, count }` |
| POST | `/projects/:key/archive` · `/unarchive` · `/transfer` | admin | archivage ; `transfer { userId }` |
| DELETE | `/projects/:key` | super admin | projet archivé, `{ confirmKey }` (corps ou query) → compteurs supprimés |

## Membres

| Méthode | Route | Droits | Description |
|---|---|---|---|
| GET | `/projects/:key/members` | lecture | `{ access, members: [{ user, role, listed, isOwner, isSuperadmin, openTaskCount }] }` |
| POST | `/projects/:key/members` | admin | `{ userIds, role }` |
| PATCH | `/projects/:key/members/:userId` | admin | `{ role }` (`LAST_ADMIN`) |
| DELETE | `/projects/:key/members/:userId` | admin | `?unassignOpenTasks=1` |

## Tâches

| Méthode | Route | Droits | Description |
|---|---|---|---|
| GET | `/projects/:key/tasks` | lecture | filtres ci-dessous ; `filterId` ; `taskIds=KB-1,KB-2` ; `fields=summary` ; `sort=champ:asc\|desc` ; `limit`/`skip` (+ `X-Total-Count`) ; réponse `{ tasks, warnings }` |
| GET | `/projects/:key/tasks/:taskId` | lecture | tâche complète (historique, commentaires) |
| POST | `/projects/:key/tasks` | member | statut / type / priorité par défaut du projet si absents |
| PATCH | `/projects/:key/tasks/:taskId` | member | champs + `note` ; historique automatique |
| DELETE | `/projects/:key/tasks/:taskId` | admin | |
| POST | `/projects/:key/tasks/bulk` | member | `{ taskIds (≤ 500), patch: { sprint?, version?, assignee?, status?, priority?, type?, category?, techno?, area?, dueDate?, parent? }, note? }` → `{ updated, unchanged, notFound }` (`NO_TASKS`, `EMPTY_PATCH`, `TOO_MANY_TASKS`) |
| POST | `/projects/:key/tasks/:taskId/comments` | member | `{ text, parent? }` (réponse rattachée au commentaire racine) → `{ comments, commentId }` |
| PATCH / DELETE | `/projects/:key/tasks/:taskId/comments/:id` | auteur ou admin (`NOT_COMMENT_AUTHOR`) | modifier `{ text }` ; supprimer (avec ses réponses) |
| POST | `/projects/:key/tasks/:taskId/comments/:id/reactions` | member | `{ emoji }` bascule la réaction de l'utilisateur (`REACTION_INVALID`) → `{ comments, added }` |

Texte des descriptions et commentaires : Markdown restreint (voir `client/src/components/common/RichText.tsx`),
`@username` notifie les membres ayant accès au projet. Chaque changement (champs suivis, description,
instructions, critères, estimation, durée, commentaires) ajoute une entrée à `history` et au journal.

**Filtres** (paramètres répétables `?status=a&status=b`) : `status`, `statusCategory`
(`todo|inprogress|done`), `priority`, `type`, `category`, `techno`, `area`, `version`, `sprint`,
`assignee`, `reporter`, `labels`, `parent`, `search` (ou `q`), `createdFrom/To`, `updatedFrom/To`
(ISO, `-7d`, `-2w`, `-1m`, `@sprintStart`, `@sprintEnd`, `now`).
Jetons : `assignee|reporter=@me|unassigned`, `sprint=@current|@open|@none`,
`version=@current|@unreleased|@none`, `parent=@none`.

## Taxonomies

| Méthode | Route | Droits | Description |
|---|---|---|---|
| GET | `/projects/:key/taxonomies` | lecture | `?kind=` ; `?includeArchived=1` |
| POST | `/projects/:key/taxonomies` | admin | `{ kind, key, label, color?, meta? }` (clés réservées ignorées) |
| PATCH | `/projects/:key/taxonomies/:id` | admin | label, color, order, archived, `meta` fusionné (`CATEGORY_REQUIRED`) |
| PUT | `/projects/:key/taxonomies/order` | admin | `{ kind, keys }` |
| DELETE | `/projects/:key/taxonomies/:id` | admin | refusé si utilisé (`IN_USE`) |
| POST | `/projects/:key/taxonomies/:id/replace` | admin | `{ replacementKey }` → tâches (historisées) et filtres réaffectés, puis suppression |

Clés `meta` réservées : statut `isDone` (dérivé de `category`) ; sprint `status, startedAt,
startedBy, startSnapshot, closedAt, closedBy, report, reopenedAt` ; version `status, releasedAt`.

## Sprints et versions

| Méthode | Route | Droits | Description |
|---|---|---|---|
| GET | `/projects/:key/sprints` | lecture | sprints + stats (`taskCount, points, doneCount, donePoints`) |
| POST | `/projects/:key/sprints` | admin | `{ label, key?, startDate?, endDate?, goal? }` (enchaîné selon la cadence) |
| PATCH | `/projects/:key/sprints/:sprintKey` | admin | label, dates, objectif (`LIFECYCLE_FIELD` si `status`) |
| POST | `…/:sprintKey/ready` · `/draft` · `/reopen` | admin | transitions (`INVALID_TRANSITION`, `ACTIVE_SPRINT_EXISTS`) |
| POST | `…/:sprintKey/start` | admin | `{ startDate?, endDate?, goal? }` → instantané, sprint courant |
| GET | `…/:sprintKey/close-preview` | lecture | terminées, non terminées, cibles possibles |
| POST | `…/:sprintKey/close` | admin | `{ carryOver: { mode: sprint\|backlog\|newSprint, targetKey?, newSprint? }, keep, startTarget, createRetro }` |
| DELETE | `…/:sprintKey` | admin | refusé si référencé (`SPRINT_IN_USE`) |
| PUT | `/projects/:key/sprints/current` | admin | `{ key \| null }` : sprint courant sans démarrage (`SPRINT_FINISHED`, `ACTIVE_SPRINT_EXISTS`) |
| GET | `…/:sprintKey/leftovers` | lecture | `{ sprint, notDone, carriedOver }` : reste à faire (tâches encore dans le sprint, tâches reportées et leur emplacement) |
| GET | `/projects/:key/versions` | lecture | versions + stats, tri décroissant |
| POST / PATCH | `/projects/:key/versions[/:versionKey]` | admin | dates, description, archivage |
| POST | `…/versions/:versionKey/release` · `/unrelease` | admin | `{ releasedAt?, moveOpenTo?, setCurrent? }` |

## Journal d'activité

| Méthode | Route | Droits | Description |
|---|---|---|---|
| GET | `/projects/:key/activity` | lecture | `{ entries, nextCursor }`, plus récent d'abord |
| GET | `/activity` | authentifié | idem sur tous les projets visibles, `?project=KB,KYDOS` ; chaque entrée porte `projectKey` |

Paramètres : `user` (ids), `scope` (`task, comment, sprint, version, project, import`), `action`
(`task.updated`, `comment.added`, `sprint.closed`, `version.current`…), `field`, `taskId`, `sprint`,
`version` (entrées touchant ce sprint / cette version, avant ou après), `from` / `to` (ISO ou
`AAAA-MM-JJ` inclus), `q`, `limit` (≤ 200), `cursor`. Listes séparées par des virgules.

## Notifications

| Méthode | Route | Droits | Description |
|---|---|---|---|
| GET | `/notifications` | authentifié | `?limit=&unread=1` → `{ notifications, unread }` (non lues d'abord) |
| POST | `/notifications/read` | authentifié | `{ ids }` ou `{ all: true }` → `{ updated, unread }` |
| DELETE | `/notifications/read` | authentifié | supprime les notifications lues |

Types : `mention, assigned, comment, reply, reaction, status`. Pas de push : le client les charge au démarrage.

## Images

| Méthode | Route | Droits | Description |
|---|---|---|---|
| POST | `/projects/:key/attachments` | member | `{ name, data (base64 ou data URL), taskId? }` ; PNG, JPEG, GIF, WebP (signature vérifiée), 8 Mo max (`ATTACHMENT_TYPE` 415, `ATTACHMENT_TOO_LARGE` 413) → `{ attachment: { url } }` |
| GET | `/files/:publicId/:name` | public (identifiant non devinable) | image servie avec `nosniff` et CSP stricte |

## Filtres enregistrés

`/projects/:key/filters` — GET (visibles), POST `{ name, description?, filters, view, groupBy,
sort, visibility, isDefault?, isStarred? }`, GET/PATCH/DELETE `/:id` (propriétaire ; admin projet
pour les partagés), POST `/:id/duplicate`, PUT `/:id/star { starred }`, PUT `/:id/default { isDefault }`.

## Dashboards et analyses

`/projects/:key/dashboards` — GET (liste sans widgets + `templates`), POST `{ name, template?
(sprint|po|dev|blank), visibility?, globalFilters?, widgets?, isDefault?, isStarred? }`, GET `/:id`,
PATCH `/:id { revision, name?, visibility?, globalFilters?, widgets? }` (`REVISION_CONFLICT`,
`WIDGET_TYPE_UNKNOWN`), DELETE `/:id`, POST `/:id/duplicate`, PUT `/:id/star`, PUT `/:id/default`.

Widget : `{ id, type, title, layout {x,y,w,h}, source { mode: global|filter|inline|none, filterId,
filters }, config }` — types et configs dans `server/src/dashboards/widgets.js`.

`/projects/:key/analytics` (lecture). Les routes POST acceptent `{ globalFilters?, filterId?, filters? }`
combinés en ET (`FILTER_NOT_FOUND` si filtre invisible) :

| Route | Corps / query | Réponse |
|---|---|---|
| POST `/aggregate` | `groupBy, splitBy?, metric (count\|points\|hours), topN, sort?` | `{ total, count, buckets: [{ key, label, color, value, split? }] }` |
| POST `/matrix` | `rows, cols, metric` | `{ rows, cols, cells[rowKey][colKey] }` |
| POST `/kpi` | `metric (… \| openBugs)` | `{ value, count }` |
| POST `/workload` | `metric, includeUnassigned` | `{ rows: [{ key, label, todo, inprogress, done, total }] }` |
| POST `/tasks` | `sort, limit` | `{ tasks, total }` |
| POST `/activity` | `limit` | `{ entries }` |
| POST `/sprint-summary` | `sprint (@current\|clé)` | sprint, points, %, jours restants, rituels |
| GET `/sprints/:sprintKey/burndown` | `?unit=points\|count` | `{ committed, days[{date, scope, completed, remaining}], ideal, scopeChanges, warnings }` |
| GET `/velocity` | `?last=6&unit=points` | `{ sprints[{committed, completed, carriedOver, source}], average }` |

## Import Jira et export

`/projects/:key/import` (admin, corps JSON jusqu'à 25 Mo, fichiers ≤ 20 Mo, 5 fichiers, 10 000 tickets) :

| Route | Corps | Réponse |
|---|---|---|
| POST `/jira/analyze` | `{ files: [{ name, content }], options? }` | simulation avec correspondances suggérées : `counts, rows, warnings, taxonomiesCreated, idPlan, files, entities, mapping` |
| POST `/jira` | `{ files, mapping?, options?, dryRun (défaut true) }` | idem ; `201` + `jobId` quand `dryRun: false` (`IMPORT_IN_PROGRESS`, `MAPPING_INCOMPLETE`) |
| GET `/jobs` · `/jobs/:id` | | historique / détail |
| POST `/jobs/:id/rollback` | | dernier import uniquement → `{ report }` |

Options : `mode (upsert|create)`, `importComments`, `componentToArea`, `setCurrentSprint`,
`extractAcceptance`, `hoursPerDay`, `timezone`, `site`. Mapping : `statuses|priorities|types`
(`"clé"` ou `{ create: { label, color?, category?, key?, meta? } }`), `people { ref: userId|null }`,
`sprints { nom: { state?, startDate?, endDate?, goal? } }`, `fields { storyPoints, category?, techno? }`
(clés `cf:<nom normalisé>` listées dans `entities.fields`). Formats de tickets : CSV, JSON search,
JSON « systèmes externes » (`projects[].issues[]`).

`GET /projects/:key/export?format=json` (bundle `kydos-project/1`) ·
`GET /projects/:key/export?format=csv[&filterId=…][&<filtres>][&sep=semicolon]` (CSV compatible Jira).

## Rituels

`/projects/:key/events` — GET (`?sprint`, `?type`), POST, GET/PATCH/DELETE `/:id`,
POST `/:id/tasks { taskId, note? }`, DELETE `/:id/tasks/:linkId` (écriture : member).
