# Kýdos Board

Application de gestion de tâches façon Jira (single page app), avec sauvegarde
MongoDB, inspirée du board statique `board.html` / `tasks.json` d'origine.

## Stack

- **Backend** : Node.js, Express, Mongoose (MongoDB), JWT.
- **Frontend** : React + TypeScript + Vite, `@tanstack/react-query`, `@dnd-kit` (drag & drop).
- 4 thèmes : sombre (défaut), clair, Ubuntu, Mac.

## Démarrage rapide (Docker)

```bash
docker compose up --build -d
docker compose run --rm app node src/seed/seed.js   # importe tasks.json + crée les comptes
```

L'application est servie sur http://localhost:7002.

## Démarrage en local (sans Docker)

Prérequis : Node.js 20+, une instance MongoDB accessible (locale ou Atlas).

Ports par défaut : **serveur/API 7002**, **client 7001**.

```bash
# Serveur
cd server
npm install
cp .env.example .env      # déjà pré-rempli (MongoDB local root:toor, port 7002)
npm run seed               # importe tasks.json (projet Kýdos Belote) + comptes superadmin
npm run dev                 # http://localhost:7002

# Client (autre terminal)
cd client
npm install
cp .env.example .env      # VITE_PORT=7001, VITE_API_PROXY_TARGET=http://localhost:7002
npm run dev                 # http://localhost:7001 (proxy /api -> :7002)
```

Le serveur charge automatiquement `server/.env` quel que soit le dossier de
lancement (dotenv pointé sur le fichier, pas sur le cwd).

## Lancement avec PM2

Un fichier PM2 est fourni pour chaque partie ; chacun lit son propre `.env`.

```bash
# API (server/.env → port 7002, MongoDB…)
cd server && npm install && npm run seed
pm2 start ecosystem.config.js

# Client (client/.env → port 7001, proxy /api → 7002)
cd ../client && npm install
pm2 start ecosystem.config.cjs

pm2 status         # kydos-server + kydos-client
pm2 logs           # journaux
pm2 save           # persister au reboot
```

Le fichier client lance le serveur Vite (rechargement à chaud). Pour servir un
build de production à la place : `npm run build` puis remplacer les `args` du
`ecosystem.config.cjs` par `preview --host --port 7001`.

## Comptes par défaut (créés par le seed)

| Identifiant | Rôle          | Mot de passe   |
|-------------|---------------|----------------|
| `ameur`     | Super admin   | `@bloardKydos` |
| `hamido`    | Super admin   | `@bloardKydos` |
| `nadia`     | Product Owner | `@bloardKydos` |
| `yassine`   | Scrum Master  | `@bloardKydos` |
| `sami`      | Chef d'équipe | `@bloardKydos` |
| `lina`      | Développeur   | `@bloardKydos` |
| `omar`      | QA / Testeur  | `@bloardKydos` |

Le super admin crée les comptes depuis **Administration → Utilisateurs**. Les
rôles disponibles : Super admin, Chef de projet, Product Owner, Scrum Master,
Chef d'équipe, Développeur, QA. Les rôles « manager » (super admin, chef de
projet, Scrum Master, PO, chef d'équipe) peuvent gérer les taxonomies, les
sprints, les équipes et les paramètres projet.

## Modèle de données MongoDB

- `User` — comptes (rôle `superadmin` ou `developer`).
- `Project` — un projet = une clé (`KB`), un nom, une version courante.
- `Taxonomy` — collection **unique** pour les 8 dimensions configurables par
  projet (`status`, `priority`, `type`, `category`, `techno`, `area`,
  `version`, `sprint`), au lieu de 8 collections dupliquées. Chaque entrée a
  une `key`, un `label`, une `color`, un `order` et un `meta` libre (ex.
  `{ isDone: true }` sur un statut, ou `{ linkedVersion }` sur un sprint).
- `Task` — la tâche : champs métier (statut, priorité, sprint, version,
  assigné…), plus deux sous-documents :
  - `comments[]` (auteur, texte, dates),
  - `history[]` (journal auto-généré à chaque changement de champ suivi :
    statut, priorité, assigné, sprint, version, type, catégorie, techno,
    domaine, points).
- `Event` — un rituel / événement agile (refinement, grooming, point
  technique, point architecture, préparation de démo, rétrospective…),
  rattachable à un sprint, avec participants, tâches liées, ordre du jour,
  décisions, actions à suivre, champs ADR (architecture) et ordre de démo.
  Les sections affichées sont pilotées par `meta.features` du type
  d'événement — chaque type n'expose que ce qui le concerne.
- `Counter` — un compteur par projet pour générer les identifiants `KB-155`, etc.

Le `Project` porte aussi la cadence des sprints : `sprintDurationValue` +
`sprintDurationUnit` (jours/semaines, défaut **1 semaine**) et
`currentSprint`. Modifier la durée n'affecte **que les futurs sprints** —
chaque sprint stocke ses propres dates, donc rien n'est recalculé
rétroactivement.

Un nouveau projet peut être créé depuis l'écran **Projets** (super admin) : il
reçoit automatiquement un jeu de taxonomies par défaut, prêtes à être
adaptées.

## Fonctionnalités

- 3 types d'affichage du board : **Board** (groupé façon board.html d'origine,
  avec choix de la dimension de regroupement), **Jira** (kanban simple par
  statut) et **Liste** (tableau triable).
- Drag & drop des cartes entre colonnes de statut (met à jour la tâche et
  journalise le changement).
- Assignation d'une tâche à soi-même ou à un autre utilisateur.
- Changement du sprint / de la version d'une tâche.
- Commentaires sur chaque tâche.
- Historique complet des modifications (statut, champs, notes).
- Filtres multi-sélection combinables sur chaque dimension (statut, priorité,
  type, catégorie, techno, version, sprint, domaine, assigné) + recherche
  libre (id, titre, mots-clés du contenu).
- Gestion des taxonomies (statuts, priorités, catégories, technos, domaines,
  types, versions, sprints) par projet : ajout / modification / suppression.
- Consultation d'une tâche en popup ou sur une page dédiée
  (`/projects/:key/tasks/:taskId`).
- Gestion des utilisateurs par le super admin (création des comptes
  développeurs, rôles).
- Création de nouveaux projets.
- **Regroupement multi-boards** : dans les 3 vues, on choisit une dimension
  de regroupement (sprint, version, catégorie, techno, domaine, type,
  priorité, statut, assigné) ; chaque groupe s'affiche comme son propre
  mini-board avec ses colonnes de statut et une barre de stats (points à
  faire / en cours / terminés, total, estimation, non assignés) — utile pour
  le PO / scrum master. Une barre latérale liste les groupes et met en avant
  le sprint courant.
- **Sprints configurables** : statut (brouillon / prêt / actif / terminé),
  dates de début/fin, objectif ; durée par défaut des futurs sprints réglée
  dans les paramètres du projet ; sélection du sprint courant ; boutons
  « sprint précédent / suivant » sur chaque tâche.
- **Espace Rituels & événements** : créer et gérer refinement, grooming,
  point technique, point architecture, préparation de démo, rétrospective
  (types configurables par le super admin, avec icône et sections propres à
  chaque type). Rattachement à un sprint, participants, tâches liées.
- **Ajout rapide d'une tâche à un événement** : une icône ⊕ sur chaque carte
  de tâche (et dans le détail) ouvre un popup pour la rattacher à un
  événement existant ou en créer un à la volée.
- Archivage (au lieu de suppression) de n'importe quelle taxonomie encore
  utilisée.
- **Rôles agiles** : Super admin, Chef de projet, Product Owner, Scrum Master,
  Chef d'équipe, Développeur, QA — avec permissions différenciées.
- **Équipes** : constituer des équipes (membres, rôle dans l'équipe, capacité
  par sprint en points), assigner une tâche à une équipe.
- **Tableau de bord Scrum** (`/projects/:key/dashboard`) : vélocité moyenne et
  par sprint, **burndown réel** du sprint courant (calculé depuis l'historique
  des tâches), engagé vs capacité d'équipe, charge par personne (points par
  état), métriques QA (bugs ouverts, en QA, taux de défauts) et des cartes
  d'indicateurs par rôle (PO / Scrum Master / Chef d'équipe / QA).
- **Sprint courant** mis en avant sur le board : encadré spécial avec chrono
  en direct, progression et statistiques.
- **Vue Planning** : colonnes = dimension de regroupement ; glisser une tâche
  la replanifie (change son sprint, sa version, son assigné, etc.).
- **Planning Poker temps réel** (WebSocket) dans les refinement / grooming /
  points techniques : un Scrum Master ou PO lance un vote d'estimation sur une
  tâche, avec un deck configurable (`0.5, 1, 2, 3, 5, 8, 13, ?`), un minuteur
  en secondes et une liste de votants autorisés (tous les connectés, un
  groupe, un tag ou une sélection de personnes). Les votes sont **cachés** (on
  voit seulement qui a voté) jusqu'à ce que le lanceur les **révèle** ; il peut
  attendre au-delà du minuteur. À la révélation : distribution, consensus /
  suggestion (médiane), puis le lanceur applique l'estimation finale à la
  tâche. Les WebSockets ne servent qu'à ce cas temps réel.
- **Groupes & tags** : regrouper les personnes par groupe ou par tag
  (création, couleur, membres), réutilisables notamment pour restreindre les
  votants d'un Planning Poker.
- **Estimateurs paramétrables** (poker) : tous les connectés, **par rôle**
  (ex. tous les développeurs, tous les PO…), **par équipe**, par groupe, par
  tag, ou une sélection de personnes.
- **Rôles par projet** : chaque personne peut avoir un rôle propre au projet
  (Administration → Membres & rôles) qui prime sur son rôle global.
- **Rétrospective interactive temps réel** (WebSocket), **par sprint et par
  équipe**, animée par le PO/Scrum Master (animateur délégable). Déroulé :
  préparation (invités, absences, rappel des objectifs de la rétro
  précédente) → note du sprint (cachée puis révélée : moyenne + notes) →
  Start / Stop / Continue (post-its privés, minuteur réglable et prolongeable,
  puis tour de parole aléatoire avec passage de main) → vote des propositions
  (budget de points paramétrable : points par personne, min/max par
  proposition) → sélection des objectifs (top N) qui deviennent les objectifs
  du prochain sprint → clôture (note de la rétro). Les objectifs sont
  sauvegardés et rappelés à la rétro suivante.
- **Champs de formulaire** à libellé flottant (design plus soigné).

## Limite connue de cet environnement de build

Le bac à sable utilisé pour développer cette application n'a pas d'accès
réseau vers une instance MongoDB réelle (les téléchargements de binaires
MongoDB et les connexions TCP brutes vers une base de données sont bloqués
par la politique réseau de l'environnement). Le code a donc été vérifié par
compilation (`tsc`, `vite build`), vérification syntaxique de tous les
fichiers serveur et chargement de tous les modules Express/Mongoose, mais
**pas testé de bout en bout contre une vraie base MongoDB**. Il est
recommandé de lancer `docker compose up --build` (ou un serveur MongoDB
local) et de vérifier le flux complet avant mise en production.

<!-- Ligne de test ajoutée pour vérifier le push. -->
