# Kýdos Board

Gestion de projet agile façon Jira — et au-delà : board multi-vues, filtres dynamiques et
enregistrés, dashboards personnalisables, cycle de vie des sprints, rituels agiles intégrés et
**import depuis Jira** avec simulation et annulation. SPA React + API Express / MongoDB.

Documentation :
- [Fonctionnalités](docs/FEATURES.md)
- [API](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Installation & exploitation](docs/INSTALLATION.md)
- [Mise en production sur le VPS AlmaLinux (board.kantoaplo.com, PM2, nginx existant, HTTPS)](VPSCONFIGURATION.md)
- Specs produit : [analyse chef de projet](docs/product/PM_ANALYSIS.md) · [import Jira & Scrum](docs/product/SCRUM_JIRA_IMPORT_SPEC.md)

## Stack

- **Backend** : Node.js 20+, Express 4, Mongoose 8 (MongoDB), JWT.
- **Frontend** : React 18 + TypeScript + Vite, `@tanstack/react-query`, `@dnd-kit`.
- Graphiques, parseur CSV et grille de dashboard maison (aucune dépendance supplémentaire).
- 4 thèmes : sombre (défaut), clair, Ubuntu, Mac.

## Installation et lancement

Guide complet (local, VPS, PM2, nginx / HTTPS, mises à jour, sauvegardes, dépannage) :
**[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

Prérequis : Node.js 20+, MongoDB, PM2 (`npm install -g pm2`). Ports : **API 7002**, **front 7001**.

```bash
npm run setup          # dépendances server/ et client/
npm run env:init       # server/.env et client/.env (secret JWT généré) — vérifier MONGODB_URI
npm run seed           # projet KB, comptes, version et sprint courants 19.0.3
npm run build          # build du front
npm start              # PM2 : kydos-server (API) + kydos-client (front)
npm run health
```

| Commande (racine) | Effet |
|---|---|
| `npm start` · `npm run start:dev` | production (front construit) · développement (rechargement à chaud) |
| `npm run reload` · `npm run stop` · `npm run logs` · `npm run status` | exploitation PM2 |
| `npm run deploy` | git pull, dépendances, build, aperçu de migration, reload sans coupure |
| `npm run migrate -- --dry-run` · `npm run release:align -- --dry-run` | mise à niveau d'une base existante, alignement sur la version 19.0.3 |
| `npm run admin:create` · `npm run admin:list` | créer / promouvoir un super admin en console · lister les super admins |
| `npm test` · `npm run typecheck` | tests serveur, typage du front |

Sans PM2 : `cd server && npm run dev` et `cd client && npm run dev`. Docker : `docker compose up --build -d`.

**Production sur le VPS** (https://board.kantoaplo.com) : `npm run env:vps`, `npm run start:vps`,
`sudo bash deploy/vps/setup-https.sh <email>`, mises à jour `npm run deploy:vps` — voir [VPSCONFIGURATION.md](VPSCONFIGURATION.md).

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
