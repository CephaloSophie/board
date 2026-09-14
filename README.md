# Kýdos Board

Gestion de projet agile façon Jira — et au-delà : board multi-vues, filtres dynamiques et
enregistrés, dashboards personnalisables, cycle de vie des sprints, rituels agiles intégrés et
**import depuis Jira** avec simulation et annulation. SPA React + API Express / MongoDB.

Documentation :
- [Fonctionnalités](docs/FEATURES.md)
- [API](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- Specs produit : [analyse chef de projet](docs/product/PM_ANALYSIS.md) · [import Jira & Scrum](docs/product/SCRUM_JIRA_IMPORT_SPEC.md)

## Stack

- **Backend** : Node.js 20+, Express 4, Mongoose 8 (MongoDB), JWT.
- **Frontend** : React 18 + TypeScript + Vite, `@tanstack/react-query`, `@dnd-kit`.
- Graphiques, parseur CSV et grille de dashboard maison (aucune dépendance supplémentaire).
- 4 thèmes : sombre (défaut), clair, Ubuntu, Mac.

## Démarrage rapide (Docker)

```bash
docker compose up --build -d
docker compose run --rm app node src/seed/seed.js   # importe tasks.json + crée les comptes
```

L'application est servie sur http://localhost:7002.

## Démarrage en local

Prérequis : Node.js 20+, une instance MongoDB accessible. Ports : **API 7002**, **client 7001**.

```bash
# Serveur
cd server
npm install
cp .env.example .env        # MongoDB, JWT, port 7002
npm run seed                # projet « Kýdos Belote » (KB) depuis ../tasks.json + comptes superadmin
npm run dev                 # http://localhost:7002

# Client (autre terminal)
cd client
npm install
cp .env.example .env        # VITE_PORT=7001, VITE_API_PROXY_TARGET=http://localhost:7002
npm run dev                 # http://localhost:7001
```

Le serveur charge `server/.env` quel que soit le dossier de lancement.

### Commandes utiles (`server/`)

| Commande | Effet |
|---|---|
| `npm run dev` | API avec rechargement (`node --watch`) — redémarrez-la après une mise à jour du code |
| `npm test` | tests d'intégration sur une base `kydos_board_test` (jamais la base de travail) |
| `npm run seed` | crée ce qui manque (projet KB, taxonomies, tâches, comptes) sans écraser les données existantes |
| `npm run seed:overwrite` | réécrit le projet KB avec les valeurs de `tasks.json` |
| `npm run migrate -- --dry-run` / `npm run migrate` | met à niveau une base antérieure (catégories de statut, rôles projet, sprints, versions, dates dérivées) ; idempotent |

Client : `npx tsc -b` (typage), `npm run build` (build de production).

### Mise à jour d'une installation existante

1. Récupérer le code, `npm install` dans `server/` et `client/`.
2. `cd server && npm run migrate -- --dry-run` pour voir les changements, puis `npm run migrate`.
3. Redémarrer l'API et le client.

## Lancement avec PM2

```bash
cd server && npm install && npm run seed
pm2 start ecosystem.config.js          # kydos-server (lit server/.env)
cd ../client && npm install
pm2 start ecosystem.config.cjs         # kydos-client (lit client/.env)
pm2 save
```

Le fichier client lance Vite ; pour servir un build : `npm run build` puis `preview --host --port 7001`.

## Comptes par défaut (créés par le seed)

| Identifiant | Rôle | Mot de passe |
|---|---|---|
| `ameur` | superadmin | `@bloardKydos` |
| `hamido` | superadmin | `@bloardKydos` |

Changez ces mots de passe en production (Utilisateurs → Mot de passe…).

## En bref

- **Board** : vues Board / Jira / Liste, regroupement par n'importe quelle dimension, glisser-déposer.
- **Filtres** : listes déroulantes multi-sélection, valeurs dynamiques (Moi, Sprint courant, Backlog…),
  état dans l'URL, filtres enregistrés privés / partagés, favoris et filtre par défaut.
- **Dashboards** : modèles, grille libre, 10 widgets (burndown, vélocité, charge, répartitions,
  tableau croisé…), filtre global, partage.
- **Sprints & versions** : démarrer, clôturer avec report et rétrospective pré-remplie, publier.
- **Administration projet** : général, sprints & versions, membres & rôles, workflow, taxonomies,
  import / export, zone dangereuse.
- **Import Jira** (CSV ou JSON API + sprints + versions) et **export** JSON / CSV compatible Jira.
- **Rituels** : refinement, grooming, point technique, architecture (ADR), démo, rétrospective.

Détails : [docs/FEATURES.md](docs/FEATURES.md).
