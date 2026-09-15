# Installation, exploitation et mise à jour

Ce guide couvre une installation **en local** (poste de développement) et sur un **serveur / VPS**
(Ubuntu ou Debian) avec **PM2**, puis l'usage quotidien, les mises à jour et les sauvegardes.

> Production sur **https://board.kantoaplo.com** : suivre [VPSCONFIGURATION.md](../VPSCONFIGURATION.md)
> (`ecosystem.vps.config.cjs`, `deploy/nginx/`, `deploy/vps/setup-https.sh`).

## 1. Vue d'ensemble

| Processus PM2 | Rôle | Port par défaut | Réglages |
|---|---|---|---|
| `kydos-server` | API Express (`server/src/index.js`) + MongoDB | 7002 | `server/.env` |
| `kydos-client` | front : en production `client/serve.cjs` sert `client/dist` et relaie `/api` vers l'API ; en développement, Vite (rechargement à chaud) | 7001 | `client/.env` |

Un seul fichier PM2 à la racine : `ecosystem.config.cjs`. Les scripts `npm run …` de la racine
enveloppent toutes les opérations.

```
navigateur ──► (nginx :443) ──► kydos-client :7001 ──/api──► kydos-server :7002 ──► MongoDB
```

## 2. Prérequis

| Outil | Version | Remarque |
|---|---|---|
| Node.js | 20 ou plus (testé en 24) | via [nvm](https://github.com/nvm-sh/nvm) recommandé |
| npm | fourni avec Node | |
| MongoDB | 6 ou 7 | local, Docker ou service managé |
| PM2 | 5 ou plus | `npm install -g pm2` |
| git | | pour récupérer et mettre à jour le code |
| nginx + certbot | optionnel | nom de domaine et HTTPS sur un VPS |

## 3. Installation rapide (local)

```bash
git clone <url-du-dépôt> kydos-board && cd kydos-board
npm run setup          # dépendances de server/ et client/
npm run env:init       # crée server/.env et client/.env (secret JWT généré)
# vérifier MONGODB_URI dans server/.env
npm run seed           # projet « Kýdos Belote » (KB), comptes, version et sprint courants 19.0.3
npm run build          # build du front
npm start              # PM2 : kydos-server + kydos-client
npm run health         # vérifie API, front et relais /api
```

Ouvrir http://localhost:7001 et se connecter avec `ameur` / `@bloardKydos` (voir §9).

## 4. Configuration

### `server/.env`

| Variable | Exemple | Rôle |
|---|---|---|
| `PORT` | `7002` | port de l'API |
| `HOST` | `127.0.0.1` | adresse d'écoute ; `127.0.0.1` derrière nginx, vide = toutes les interfaces |
| `MONGODB_URI` | `mongodb://kydos:motdepasse@127.0.0.1:27017/kydos_board?authSource=admin` | base de données |
| `JWT_SECRET` | 96 caractères aléatoires | signature des sessions (généré par `npm run env:init`) — **à garder secret** |
| `JWT_EXPIRES_IN` | `30d` | durée d'une session |
| `CLIENT_ORIGIN` | `https://board.example.com` | origine autorisée (CORS), plusieurs valeurs séparées par des virgules |

### `client/.env`

| Variable | Exemple | Rôle |
|---|---|---|
| `VITE_PORT` | `7001` | port du front (production et développement) |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:7002` | URL de l'API vers laquelle `/api` est relayé |
| `WEB_HOST` | `127.0.0.1` | adresse d'écoute du front en production ; `127.0.0.1` derrière nginx |

### Surcharges ponctuelles (sans modifier les `.env`)

`KYDOS_API_PORT`, `KYDOS_WEB_PORT`, `KYDOS_WEB_HOST`, `KYDOS_API_URL`, `KYDOS_MONGODB_URI`, par exemple
pour lancer une seconde instance de test :

```bash
KYDOS_API_PORT=7302 KYDOS_WEB_PORT=7301 KYDOS_MONGODB_URI='mongodb://…/kydos_board_demo?authSource=admin' pm2 start ecosystem.config.cjs
```

Les secrets restent dans `server/.env` : ils ne sont pas recopiés dans la configuration PM2.

## 5. Données initiales et versions

### Seed (base vide)

`npm run seed` crée, **sans jamais écraser l'existant** :

- les comptes super admin `ameur` et `hamido` ;
- le projet **Kýdos Belote (KB)** depuis `tasks.json` : statuts, priorités, domaines, types, technos,
  catégories, types de rituels et les tâches ;
- les **36 anciennes versions** de `tasks.json` (de `continu` à `12.4.4`) **publiées**, chacune avec son
  sprint **terminé** (rapport engagé / livré figé), datés semaine par semaine avant la semaine courante ;
- la **version courante 19.0.3** (non publiée) et le **sprint courant `Sprint 19.0.3`**, **actif**
  sur la semaine en cours.

La version courante vient de `tasks.json` (`meta.currentVersion`) ; pour une autre valeur :
`SEED_CURRENT_VERSION=19.1.0 npm run seed`. `npm --prefix server run seed:overwrite` remet le projet KB
aux valeurs de `tasks.json` (à éviter sur une base de travail).

### Base existante : migration puis alignement de version

Le seed n'écrase rien : une base déjà utilisée se met à niveau avec deux scripts idempotents, qui ont
chacun un mode aperçu `--dry-run` n'écrivant rien.

```bash
npm run migrate -- --dry-run          # mise à niveau du schéma (catégories de statut, sprint « backlog », versions…)
npm run migrate
npm run release:align -- --dry-run    # aperçu de l'alignement sur 19.0.3
npm run release:align                 # applique
npm run reload
```

`release:align` (options `--version 19.0.3`, `--project KB,KYDOBE` ; par défaut tous les projets non archivés) :

- publie toutes les versions **antérieures** à 19.0.3 et crée (ou rouvre) la version 19.0.3 ;
- **termine** tous les sprints des versions antérieures (ou actifs, ou déjà passés) avec un rapport figé ;
- crée si besoin le sprint `Sprint 19.0.3`, le rend **seul sprint actif** et fait de 19.0.3 la version
  et le sprint **courants** ;
- ne déplace **aucune tâche** : les tâches encore ouvertes des sprints terminés apparaissent dans
  *Planification → Reste à faire* et se décalent en un clic ;
- laisse intactes les versions et sprints **postérieurs** ; trace l'opération dans le *Journal*.

Faites une sauvegarde (§8) avant d'appliquer ces scripts sur des données réelles.

## 6. Lancer l'application

### En local, sans PM2 (deux terminaux)

```bash
cd server && npm run dev      # API avec rechargement (node --watch) — http://localhost:7002
cd client && npm run dev      # Vite — http://localhost:7001
```

`node --watch` ne voit pas toujours les **nouveaux** fichiers : redémarrez l'API après une mise à jour.

### En local avec PM2 (mode développement)

```bash
npm run start:dev             # API surveillée par PM2 (src/) + Vite en rechargement à chaud
npm run logs
```

### En production (local ou serveur)

```bash
npm run build                 # obligatoire après chaque mise à jour du front
npm start                     # ou : pm2 start ecosystem.config.cjs
npm run health
```

Changer de mode : `npm run delete` puis `npm start` ou `npm run start:dev`.

## 7. Déploiement sur un VPS (Ubuntu / Debian)

### 7.1 Système

```bash
sudo apt update && sudo apt install -y git nginx
# Node.js via nvm (utilisateur applicatif, pas root)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22
npm install -g pm2
```

MongoDB : suivre l'[installation officielle](https://www.mongodb.com/docs/manual/administration/install-on-linux/)
(ou `docker run -d --name mongo --restart unless-stopped -p 127.0.0.1:27017:27017 -v mongo_data:/data/db mongo:7`),
puis créer un utilisateur dédié :

```bash
mongosh admin --eval 'db.createUser({ user: "kydos", pwd: "UN_MOT_DE_PASSE_FORT", roles: [{ role: "readWrite", db: "kydos_board" }] })'
```

### 7.2 Application

```bash
git clone <url-du-dépôt> ~/kydos-board && cd ~/kydos-board
npm run setup
npm run env:init
nano server/.env      # MONGODB_URI (utilisateur kydos), HOST=127.0.0.1, CLIENT_ORIGIN=https://board.example.com
nano client/.env      # WEB_HOST=127.0.0.1, VITE_API_PROXY_TARGET=http://127.0.0.1:7002
npm run seed          # base neuve uniquement (sinon §5 : migrate + release:align)
npm run build
npm start
npm run health
```

### 7.3 Démarrage automatique et journaux

```bash
pm2 save                              # mémorise kydos-server et kydos-client
pm2 startup                           # affiche une commande sudo à exécuter une fois
pm2 install pm2-logrotate             # rotation des journaux
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
```

Journaux : `logs/server.*.log`, `logs/client.*.log` (horodatés), ou `npm run logs`.

### 7.4 nginx et HTTPS

`/etc/nginx/sites-available/kydos-board` :

```nginx
server {
    listen 80;
    server_name board.example.com;

    # imports Jira (25 Mo) et images (8 Mo)
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:7001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kydos-board /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d board.example.com
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable   # 7001, 7002 et 27017 restent fermés
```

Sans nginx, ouvrez le port 7001 et laissez `WEB_HOST` à `0.0.0.0`.

## 8. Exploitation courante

| Commande (racine) | Effet |
|---|---|
| `npm start` / `npm run start:dev` | démarre l'API et le front (production / développement) |
| `npm run reload` | redémarrage sans coupure, relit les `.env` |
| `npm run restart` · `npm run stop` · `npm run delete` | redémarrer, arrêter, retirer de PM2 |
| `npm run status` · `npm run logs` · `npm run health` | état, journaux, contrôle HTTP |
| `npm run build` | reconstruit le front |
| `npm run seed` | complète une base (n'écrase rien) |
| `npm run migrate -- --dry-run` / `npm run migrate` | mise à niveau des données |
| `npm run release:align -- --dry-run` / `npm run release:align` | alignement sur la version courante (19.0.3) |
| `npm test` | tests d'intégration (base `kydos_board_test`, jamais la base de travail) |
| `npm run typecheck` | typage du front |
| `npm run deploy` | mise à jour complète (§8.1) |

### 8.1 Mise à jour

```bash
npm run deploy                 # git pull, dépendances, build, aperçu de migration, pm2 reload, contrôle
npm run deploy -- --migrate    # applique aussi la migration
npm run deploy -- --no-pull    # code déjà à jour
```

Équivalent manuel : `git pull && npm run setup && npm run build && npm run migrate && npm run reload && npm run health`.

### 8.2 Sauvegarde et restauration

Toutes les données (tâches, historique, journal, notifications, **images**) sont dans MongoDB :

```bash
mongodump --uri "mongodb://kydos:…@127.0.0.1:27017/kydos_board?authSource=admin" --gzip --archive=kydos-$(date +%F).gz
mongorestore --uri "mongodb://kydos:…@127.0.0.1:27017/kydos_board?authSource=admin" --gzip --archive=kydos-2026-09-15.gz --drop
```

Exemple de sauvegarde quotidienne (`crontab -e`) :
`0 3 * * * mongodump --uri "…" --gzip --archive=$HOME/backups/kydos-$(date +\%F).gz`.

## 9. Comptes par défaut

| Identifiant | Rôle | Mot de passe |
|---|---|---|
| `ameur` | super admin | `@bloardKydos` |
| `hamido` | super admin | `@bloardKydos` |

À changer dès la première connexion en production (*Utilisateurs → Mot de passe…*).

Créer un super admin depuis la console (base de `server/.env`) : `npm run admin:create` (questions
interactives, mot de passe masqué) ; `--username alice --name "Alice" --email …`, `--promote` pour un compte
existant, `--reset-password` ; `npm run admin:list` pour la liste.

## 10. Docker (alternative à PM2)

```bash
docker compose up --build -d                                  # MongoDB + application sur :7002
docker compose run --rm app node src/seed/seed.js             # données initiales
docker compose run --rm app node src/migrations/alignRelease.js --dry-run
```

L'image sert l'API et le front construit sur le même port (7002). Changez `JWT_SECRET` dans `docker-compose.yml`.

## 11. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `EADDRINUSE` / processus qui redémarre en boucle | port déjà pris (ancien `npm run dev`, autre instance) | `lsof -i :7002`, arrêter l'autre processus ou changer `PORT` / `VITE_PORT` |
| Front « Front non construit » (503) | `client/dist` absent | `npm run build` puis `npm run reload` |
| `{"error":"API injoignable."}` (502) | API arrêtée ou mauvaise `VITE_API_PROXY_TARGET` | `npm run status`, `npm run logs`, vérifier `client/.env` |
| Nouvelle route en 404 après mise à jour | API non redémarrée (`node --watch`) | `npm run reload` |
| `MongoServerError: Authentication failed` | identifiants / `authSource` | corriger `MONGODB_URI` puis `npm run reload` |
| 413 à l'import Jira ou à l'envoi d'image | limite nginx | `client_max_body_size 30m;` |
| Déconnexion de tous les utilisateurs | `JWT_SECRET` modifié | normal : chacun se reconnecte |
| Sprint courant / version incohérents | données antérieures | `npm run migrate` puis `npm run release:align` |
| Notifications non rafraîchies | chargées une fois au démarrage (voulu) | recharger la page ou bouton « Actualiser » |
