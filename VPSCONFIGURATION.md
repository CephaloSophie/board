# Configuration du VPS — https://board.kantoaplo.com

Mise en production de Kýdos Board sur un VPS Ubuntu 22.04 / 24.04 (Debian 12 identique) :
**MongoDB** local, **Node.js + PM2**, **nginx** en frontal avec **HTTPS Let's Encrypt** sur le
sous-domaine **board.kantoaplo.com**. Guide générique (local, Docker) : [docs/INSTALLATION.md](docs/INSTALLATION.md).

## 0. Architecture et fichiers

```
Internet ─► nginx :80  ─► redirection 301 vers HTTPS (+ défi Let's Encrypt)
         └► nginx :443 (TLS board.kantoaplo.com)
               ├─ /api/*  ─► kydos-server  127.0.0.1:7002 ─► MongoDB 127.0.0.1:27017 (base kydos_board)
               └─ /*      ─► kydos-client  127.0.0.1:7001 (client/dist)
```

| Élément | Valeur |
|---|---|
| Domaine | `board.kantoaplo.com` (HTTPS obligatoire, HTTP redirigé) |
| Utilisateur système | `deploy` (sans connexion root) |
| Dossier de l'application | `/home/deploy/kydos-board` |
| Processus PM2 | `kydos-server` (API, port 7002) · `kydos-client` (front, port 7001), écoute sur 127.0.0.1 uniquement |
| Base MongoDB | `kydos_board`, utilisateur `kydos` (lecture / écriture), authentification activée |
| Ports ouverts | 22 (SSH), 80, 443 — 7001, 7002 et 27017 restent fermés |

| Fichier du dépôt | Rôle |
|---|---|
| `ecosystem.vps.config.cjs` | PM2 production : variables, mémoire, redémarrages, journaux, vérification des secrets, bloc `pm2 deploy` |
| `deploy/vps/server.env.example` · `client.env.example` | valeurs `.env` du VPS (copiées par `npm run env:vps`) |
| `deploy/nginx/board.kantoaplo.com.conf` | site nginx HTTPS définitif |
| `deploy/nginx/board.kantoaplo.com.bootstrap.conf` | site HTTP provisoire, le temps d'obtenir le certificat |
| `deploy/vps/setup-https.sh` | installe nginx + certbot, obtient le certificat, active HTTPS et le renouvellement |
| `scripts/deploy.sh` (`npm run deploy:vps`) | mises à jour sans coupure |

## 1. DNS

Chez le gestionnaire du domaine `kantoaplo.com`, créer :

| Type | Nom | Valeur | TTL |
|---|---|---|---|
| `A` | `board` | adresse IPv4 du VPS | 300 |
| `AAAA` (si le VPS a une IPv6) | `board` | adresse IPv6 du VPS | 300 |

Vérifier depuis n'importe quel poste : `dig +short board.kantoaplo.com` doit renvoyer l'IP du VPS.
Le certificat HTTPS ne peut pas être délivré tant que ce n'est pas le cas.

## 2. Préparer le serveur (en root, une seule fois)

```bash
apt update && apt upgrade -y
apt install -y git curl build-essential ufw unattended-upgrades
timedatectl set-timezone Europe/Paris

# utilisateur applicatif
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
passwd deploy                                  # mot de passe pour sudo
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# pare-feu : SSH + HTTP/HTTPS uniquement
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# swap de 2 Go si le VPS a 2 Go de RAM ou moins (le build du front en a besoin)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Recommandé ensuite : désactiver la connexion SSH par mot de passe et en root
(`PasswordAuthentication no`, `PermitRootLogin no` dans `/etc/ssh/sshd_config`, puis `systemctl reload ssh`).

## 3. Node.js et PM2 (utilisateur `deploy`)

```bash
su - deploy
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm alias default 22
npm install -g pm2
node -v && pm2 -v
```

## 4. MongoDB avec authentification

Installation (dépôt officiel MongoDB 8.0, compatible Ubuntu 22.04 / 24.04) :

```bash
sudo apt install -y gnupg
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/8.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

Compte administrateur MongoDB (choisir un mot de passe fort, à conserver hors du serveur) :

```bash
mongosh admin --eval 'db.createUser({ user: "admin", pwd: passwordPrompt(), roles: [{ role: "root", db: "admin" }] })'
```

Activer l'authentification et n'écouter qu'en local : dans `/etc/mongod.conf`

```yaml
net:
  port: 27017
  bindIp: 127.0.0.1
security:
  authorization: enabled
```

```bash
sudo systemctl restart mongod
mongosh "mongodb://127.0.0.1:27017/admin" -u admin -p --eval 'db.runCommand({ connectionStatus: 1 }).authInfo'
```

L'utilisateur `kydos` de l'application est créé à l'étape 6 (son mot de passe est généré avec les `.env`).

## 5. Récupérer le code

Le dépôt est privé : ajouter une **clé de déploiement** en lecture seule.

```bash
ssh-keygen -t ed25519 -C "deploy@board.kantoaplo.com" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub     # GitHub → CephaloSophie/board → Settings → Deploy keys → Add (lecture seule)
git clone git@github.com:CephaloSophie/board.git ~/kydos-board
cd ~/kydos-board
git checkout board-v1.0.1     # branche ou tag à déployer
```

## 6. Variables d'environnement

```bash
cd ~/kydos-board
npm run env:vps
```

La commande crée, **sans jamais écraser** des fichiers existants (droits 600) :

**`server/.env`**

| Variable | Valeur sur le VPS | Remarque |
|---|---|---|
| `PORT` | `7002` | aussi fixé par PM2 |
| `HOST` | `127.0.0.1` | API invisible depuis Internet |
| `MONGODB_URI` | `mongodb://kydos:<généré>@127.0.0.1:27017/kydos_board?authSource=admin` | mot de passe aléatoire |
| `JWT_SECRET` | 96 caractères hexadécimaux aléatoires | ne jamais le publier ; le changer déconnecte tout le monde |
| `JWT_EXPIRES_IN` | `30d` | durée des sessions |
| `CLIENT_ORIGIN` | `https://board.kantoaplo.com` | aussi fixé par PM2 |

**`client/.env`**

| Variable | Valeur sur le VPS |
|---|---|
| `VITE_PORT` | `7001` |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:7002` |
| `WEB_HOST` | `127.0.0.1` |

Elle affiche ensuite la commande qui crée l'utilisateur MongoDB avec le mot de passe généré. Exécutez-la
(mot de passe **admin** demandé) :

```bash
mongosh "mongodb://127.0.0.1:27017/admin" -u admin -p --eval 'db.getSiblingDB("admin").createUser({ user: "kydos", pwd: "<affiché par env:vps>", roles: [{ role: "readWrite", db: "kydos_board" }] })'
```

`ecosystem.vps.config.cjs` refuse de démarrer si `server/.env` manque, si `MONGODB_URI` contient encore des
identifiants de développement ou si `JWT_SECRET` est trop court ou par défaut.

## 7. Installer, construire, données initiales

```bash
cd ~/kydos-board
npm run setup           # dépendances server/ et client/
npm run build           # client/dist
```

Puis **un seul** des deux cas :

- **Base neuve** : `npm run seed` → projet Kýdos Belote (KB), anciennes versions publiées et anciens sprints
  terminés, version et sprint courants **19.0.3**, comptes `ameur` / `hamido`.
- **Reprise des données existantes** (depuis le poste actuel) :

  ```bash
  # sur le poste source
  mongodump --uri "mongodb://…/bordjdddddddira?authSource=admin" --gzip --archive=kydos.gz
  scp kydos.gz deploy@board.kantoaplo.com:~
  # sur le VPS
  mongorestore --uri "$(grep ^MONGODB_URI server/.env | cut -d= -f2-)" --gzip --archive=$HOME/kydos.gz \
    --nsFrom='bordjdddddddira.*' --nsTo='kydos_board.*'
  npm run migrate -- --dry-run && npm run migrate
  npm run release:align -- --dry-run && npm run release:align     # sprints / versions alignés sur 19.0.3
  ```

## 8. Démarrer avec PM2

```bash
cd ~/kydos-board
npm run start:vps       # pm2 start ecosystem.vps.config.cjs
pm2 status              # kydos-server et kydos-client « online »
npm run health          # contrôles locaux : API, front, front → API
```

Redémarrage automatique au démarrage du VPS et rotation des journaux :

```bash
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy     # copier-coller la commande sudo affichée
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

Réglages PM2 appliqués (`ecosystem.vps.config.cjs`) :

| | kydos-server | kydos-client |
|---|---|---|
| Script | `server/src/index.js` | `client/serve.cjs` |
| Écoute | `127.0.0.1:7002` | `127.0.0.1:7001` |
| Variables | `NODE_ENV=production`, `PORT`, `HOST`, `CLIENT_ORIGIN=https://board.kantoaplo.com`, `JWT_EXPIRES_IN` (+ secrets lus dans `server/.env`) | `NODE_ENV=production`, `WEB_PORT`, `WEB_HOST`, `API_URL=http://127.0.0.1:7002` |
| Mémoire | tas 768 Mo, redémarrage au-delà de 900 Mo | tas 192 Mo, redémarrage au-delà de 256 Mo |
| Journaux | `logs/server.out.log`, `logs/server.err.log` | `logs/client.out.log`, `logs/client.err.log` |
| Redémarrages | automatiques, délai progressif, arrêt propre (10 s) | idem |

## 9. nginx et HTTPS

Une commande, depuis le dossier du projet (DNS de l'étape 1 en place, PM2 démarré) :

```bash
cd ~/kydos-board
sudo bash deploy/vps/setup-https.sh admin@kantoaplo.com     # adresse qui recevra les alertes Let's Encrypt
```

Le script :

1. installe `nginx` et `certbot` ;
2. vérifie que `board.kantoaplo.com` pointe vers le VPS ;
3. installe le site HTTP provisoire, obtient le certificat par défi webroot (`/var/www/certbot`) ;
4. installe le site définitif `deploy/nginx/board.kantoaplo.com.conf` → `/etc/nginx/sites-available/board.kantoaplo.com` ;
5. ajoute un hook qui recharge nginx après chaque renouvellement et teste le renouvellement (`certbot renew --dry-run`) ;
6. contrôle `http://` (301), `https://…/healthz` et `https://…/api/health`.

Configuration HTTPS appliquée : TLS 1.2 / 1.3 (profil Mozilla intermediate), HTTP/2, redirection HTTP → HTTPS,
HSTS 1 an (limité à ce sous-domaine), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, compression gzip, envois jusqu'à 30 Mo, délai de 300 s sur `/api` (imports Jira).

Équivalent manuel :

```bash
sudo apt install -y nginx certbot && sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/board.kantoaplo.com.bootstrap.conf /etc/nginx/sites-available/board.kantoaplo.com
sudo ln -sf /etc/nginx/sites-available/board.kantoaplo.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d board.kantoaplo.com --email admin@kantoaplo.com --agree-tos --no-eff-email
sudo cp deploy/nginx/board.kantoaplo.com.conf /etc/nginx/sites-available/board.kantoaplo.com
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Le renouvellement est automatique (`systemctl list-timers | grep certbot`).

## 10. Vérifications finales

```bash
npm run health:vps                                   # local + https://board.kantoaplo.com + redirection HTTP
curl -I https://board.kantoaplo.com                  # 200, en-tête strict-transport-security
curl -I http://board.kantoaplo.com                   # 301 vers https
```

- Ouvrir https://board.kantoaplo.com, se connecter (`ameur` / `@bloardKydos` après un seed) puis **changer
  immédiatement les mots de passe** des comptes par défaut (*Utilisateurs → Mot de passe…*).
- Note TLS attendue sur https://www.ssllabs.com/ssltest/ : A.
- `pm2 status` après un `sudo reboot` : les deux processus sont revenus.

## 11. Mises à jour

```bash
cd ~/kydos-board
npm run deploy:vps                 # git pull, dépendances, build, aperçu de migration, pm2 reload, contrôles
npm run deploy:vps -- --migrate    # applique aussi la migration de données
```

Autre possibilité, depuis votre poste (clé SSH vers `deploy@board.kantoaplo.com`) avec le bloc `deploy` de
`ecosystem.vps.config.cjs` (dossier `/home/deploy/kydos-board-pm2`, distinct du clone manuel) :

```bash
pm2 deploy ecosystem.vps.config.cjs production setup      # une fois, puis : npm run env:vps dans …/source
pm2 deploy ecosystem.vps.config.cjs production            # déploiement : setup, build, migrate, reload
```

Variables facultatives de ce bloc : `KYDOS_DEPLOY_HOST`, `KYDOS_DEPLOY_USER`, `KYDOS_DEPLOY_REF`,
`KYDOS_DEPLOY_REPO`, `KYDOS_DEPLOY_PATH`.

## 12. Sauvegardes

Tout est dans MongoDB (tâches, historique, journal, notifications, images). Sauvegarde quotidienne à 3 h,
14 jours conservés (`crontab -e` en `deploy`) :

```cron
0 3 * * * mkdir -p $HOME/backups && mongodump --uri "$(grep ^MONGODB_URI $HOME/kydos-board/server/.env | cut -d= -f2-)" --gzip --archive=$HOME/backups/kydos-$(date +\%F).gz && find $HOME/backups -name 'kydos-*.gz' -mtime +14 -delete
```

Restauration : `mongorestore --uri "<MONGODB_URI>" --gzip --archive=$HOME/backups/kydos-AAAA-MM-JJ.gz --drop`.
Copiez régulièrement `~/backups` hors du VPS (autre serveur, stockage objet).

## 13. Dépannage

| Symptôme | Vérification | Solution |
|---|---|---|
| `502 Bad Gateway` | `pm2 status`, `npm run logs` | `npm run start:vps` ou `npm run reload:vps` |
| PM2 : « server/.env invalide pour la production » | message détaillé au démarrage | `npm run env:vps` ou corriger `MONGODB_URI` / `JWT_SECRET` |
| `MongoServerError: Authentication failed` | `mongosh "<MONGODB_URI>"` | recréer l'utilisateur `kydos` (§6) avec le mot de passe de `server/.env` |
| certbot : « Connection refused » / « unauthorized » | `dig +short board.kantoaplo.com`, `sudo ufw status` | enregistrement A correct, port 80 ouvert, site provisoire actif |
| `nginx -t` : erreur sur `http2` | `nginx -v` | nginx ≥ 1.25.1 : remplacer `listen 443 ssl http2;` par `listen 443 ssl;` + `http2 on;` |
| 413 à l'import ou à l'envoi d'image | fichier > 30 Mo | augmenter `client_max_body_size` |
| Build interrompu (`Killed`) | `free -h` | ajouter le swap (§2) |
| Processus absents après redémarrage | `systemctl status pm2-deploy` | `pm2 startup systemd -u deploy --hp /home/deploy` puis `pm2 save` |
| Page blanche / « Front non construit » | `ls client/dist` | `npm run build && npm run reload:vps` |
| Anciennes routes après mise à jour | `pm2 describe kydos-server` | `npm run reload:vps` |
