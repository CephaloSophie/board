# Documentation technique — Kýdos Board

## Stack

| Couche   | Technologies |
|----------|--------------|
| Frontend | React 18, TypeScript, Vite, React Router 6, @tanstack/react-query 5, @dnd-kit |
| Backend  | Node.js 20+, Express 4, Mongoose 8 (MongoDB), JWT (jsonwebtoken), bcryptjs |
| Outillage| Docker Compose, PM2, dotenv |

## Arborescence

```
board/
├── server/                  # API Node/Express/Mongoose
│   ├── .env(.example)       # config serveur (PORT, MONGODB_URI, JWT…)
│   ├── ecosystem.config.js  # PM2 (app kydos-server)
│   └── src/
│       ├── config.js        # charge server/.env (dotenv, chemin absolu)
│       ├── db.js            # connexion Mongoose
│       ├── index.js         # app Express, montage des routes, service SPA
│       ├── models/          # User, Project, Taxonomy, Task, Counter, Event
│       ├── middleware/      # auth (JWT + rôles), project (loadProject)
│       ├── routes/          # auth, users, projects, taxonomies, tasks, events
│       ├── utils/           # password (bcrypt), jwt, taskHistory
│       └── seed/seed.js     # import tasks.json + superadmins
├── client/                  # SPA React + TS + Vite
│   ├── .env(.example)       # VITE_PORT, VITE_API_PROXY_TARGET
│   ├── ecosystem.config.cjs # PM2 (app kydos-client)
│   ├── vite.config.ts       # port + proxy /api via loadEnv
│   └── src/
│       ├── api/             # client fetch + hooks react-query
│       ├── context/         # AuthContext, ThemeContext
│       ├── components/      # Board/, Task/, Event/, Admin/, Layout/, common/
│       ├── pages/           # Login, Projects, Board, Task, Events, Admin
│       ├── styles/          # global.css + themes.css (4 thèmes)
│       └── types.ts         # types partagés
├── docs/                    # cette documentation
├── tasks.json               # référentiel source (seed)
├── docker-compose.yml
└── Dockerfile
```

## Configuration (variables d'environnement)

### Serveur — `server/.env`

| Variable        | Défaut | Rôle |
|-----------------|--------|------|
| `PORT`          | `7002` | Port de l'API |
| `MONGODB_URI`   | `mongodb://root:toor@127.0.0.1:27017/bordjdddddddira?authSource=admin` | Connexion MongoDB |
| `JWT_SECRET`    | `dev-secret-change-me` | Clé de signature JWT |
| `JWT_EXPIRES_IN`| `30d`  | Durée de validité du jeton |
| `CLIENT_ORIGIN` | `http://localhost:7001` | Origine(s) CORS autorisée(s) (`*` = toutes) |

`server/src/config.js` charge `server/.env` via un **chemin absolu**
(`path.resolve(__dirname, '..', '.env')`) : le `.env` est lu quel que soit le
dossier de lancement (pm2, docker, dossier parent).

### Client — `client/.env`

| Variable                 | Défaut | Rôle |
|--------------------------|--------|------|
| `VITE_PORT`              | `7001` | Port du serveur Vite (dev/preview) |
| `VITE_API_PROXY_TARGET`  | `http://localhost:7002` | Cible du proxy `/api` |

`vite.config.ts` lit ces variables via `loadEnv` et configure le port **et**
le proxy `/api` pour `server` et `preview`.

## Lancer en développement

```bash
# API
cd server && npm install
cp .env.example .env      # déjà pré-rempli
npm run seed              # importe tasks.json + crée les superadmins
npm run dev               # http://localhost:7002 (node --watch)

# Client (autre terminal)
cd client && npm install
cp .env.example .env
npm run dev               # http://localhost:7001 (proxy /api -> :7002)
```

## Lancer avec PM2

```bash
cd server && npm install && npm run seed
pm2 start ecosystem.config.js       # app kydos-server (lit server/.env)

cd ../client && npm install
pm2 start ecosystem.config.cjs      # app kydos-client (lit client/.env)

pm2 status && pm2 save
```

Les deux fichiers PM2 contiennent un mini-parseur `.env` sans dépendance et
injectent les variables dans `env`. Le client lance le serveur Vite (HMR) ;
pour un build de prod, remplacer les `args` par `preview --host --port 7001`
après `npm run build`.

## Lancer avec Docker

```bash
docker compose up --build -d
docker compose run --rm app node src/seed/seed.js
```

Le `Dockerfile` build le client puis le sert via l'API (`client/dist` servi
par Express). L'API écoute sur `7002`.

## Scripts npm

| Emplacement | Script | Effet |
|-------------|--------|-------|
| server | `npm run dev`   | API en watch |
| server | `npm start`     | API en production |
| server | `npm run seed`  | Import `tasks.json` + superadmins |
| client | `npm run dev`   | Serveur Vite (HMR) |
| client | `npm run build` | `tsc -b && vite build` → `client/dist` |
| client | `npm run preview` | Sert le build |

## API REST

Toutes les routes (sauf `POST /auth/login`) exigent un en-tête
`Authorization: Bearer <token>`. Les routes projet passent par
`loadProject` (résolution de `:projectKey` en majuscules).

### Auth — `/api/auth`
- `POST /login` → `{ token, user }`
- `GET /me` → `{ user }`

### Utilisateurs — `/api/users`
- `GET /` (tout authentifié) — roster
- `POST /` · `PATCH /:id` · `DELETE /:id` (super admin ; delete = désactivation)

### Projets — `/api/projects`
- `GET /` · `POST /` (super admin)
- `GET /:key` · `PATCH /:key` (super admin)
- `GET /:key/stats` → `{ total, done, bugs, totalPoints }`

### Taxonomies — `/api/projects/:key/taxonomies`
- `GET /?kind=` — liste (filtrable par kind)
- `POST /` · `PATCH /:id` · `DELETE /:id` (super admin ; delete bloqué si
  encore utilisé — tâches, ou événements pour `eventType`)

### Tâches — `/api/projects/:key/tasks`
- `GET /` — filtres multi-select (`status`, `priority`, `type`, `category`,
  `techno`, `version`, `sprint`, `area`, `assignee`) + `search`
- `GET /:taskId` · `POST /` · `PATCH /:taskId` · `DELETE /:taskId`
- `POST /:taskId/comments` · `PATCH|DELETE /:taskId/comments/:commentId`
- Le `PATCH` journalise automatiquement les champs suivis (voir
  `utils/taskHistory.js`).

### Événements — `/api/projects/:key/events`
- `GET /?sprint=&type=` · `GET /:id` · `POST /` · `PATCH /:id` · `DELETE /:id`
- `POST /:id/tasks` (lier une tâche) · `DELETE /:id/tasks/:linkId`

## Authentification & rôles

- Mot de passe haché **bcrypt** (`utils/password.js`).
- JWT signé (`utils/jwt.js`), payload `{ sub, role }`.
- `middleware/auth.js` : `requireAuth` (vérifie le jeton + user actif) et
  `requireRole('superadmin', …)`.
- Deux rôles : `superadmin` (gère utilisateurs, taxonomies, projets) et
  `developer`.

## Vérifications effectuées

- `tsc -b` (client) sans erreur, `vite build` OK.
- `node --check` sur tous les fichiers serveur, chargement de tous les
  modules Express/Mongoose.
- Routes protégées renvoient bien `401` sans jeton.
- Coercition des points (`complexity`) testée (`"1 h" → 1`).
