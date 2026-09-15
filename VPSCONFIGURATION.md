# Mise en production — https://board.kantoaplo.com

Ajout de Kýdos Board sur le VPS **existant**, **sans modifier les trois sous-domaines HTTPS déjà en place**.
Guide générique (local, Docker) : [docs/INSTALLATION.md](docs/INSTALLATION.md).

## 0. Contexte et principes

| Élément | Valeur |
|---|---|
| VPS | IONOS « VPS 4-4-120 » (4 vCPU, 4 Go RAM, 120 Go) — **AlmaLinux 9** |
| IP publique | `217.160.186.250` |
| Sous-domaine | `board.kantoaplo.com` (HTTPS, HTTP redirigé) |
| Ports de l'application | `7002` API (`kydos-server`), `7001` front (`kydos-client`) — **127.0.0.1 uniquement**, jamais ouverts dans le pare-feu |
| Base MongoDB | `boardKantoAplo`, utilisateur `board` (lecture / écriture sur cette seule base) |
| Dossier | `/opt/board-kantoaplo` |
| nginx | un fichier ajouté : `/etc/nginx/conf.d/board.kantoaplo.com.conf` |
| Certificat | Let's Encrypt propre à `board.kantoaplo.com` (`/etc/letsencrypt/live/board.kantoaplo.com/`) |

Ce qui **n'est pas modifié** : `nginx.conf`, les fichiers des autres sous-domaines, leurs certificats, les
autres applications PM2, la configuration MongoDB (`/etc/mongod.conf`), les ports ouverts de firewalld.

```
Internet ─► nginx :80  (board) ─► 301 vers HTTPS  (+ défi Let's Encrypt)
         └► nginx :443 (board, SNI) ─┬─ /api/* ─► kydos-server 127.0.0.1:7002 ─► MongoDB boardKantoAplo
                                     └─ /*     ─► kydos-client 127.0.0.1:7001 (client/dist)
         └► nginx :443 (vos 3 autres sous-domaines, inchangés)
```

Fichiers du dépôt utilisés :

| Fichier | Rôle |
|---|---|
| `ecosystem.vps.config.cjs` | PM2 production : variables, 127.0.0.1, mémoire, redémarrages, journaux, contrôle des secrets et du nom de base |
| `deploy/vps/server.env.example` · `client.env.example` | valeurs `.env` du VPS (copiées par `npm run env:vps`) |
| `deploy/nginx/board.kantoaplo.com.conf` | site HTTPS définitif |
| `deploy/nginx/board.kantoaplo.com.bootstrap.conf` | site HTTP provisoire le temps d'obtenir le certificat |
| `deploy/vps/setup-https.sh` | ajout sûr du site + certificat + renouvellement |
| `server/scripts/create-superadmin.js` (`npm run admin:create`) | création d'un super admin en console |

## 1. DNS

Dans l'espace IONOS du domaine `kantoaplo.com` → DNS → ajouter :

| Type | Nom d'hôte | Valeur | TTL |
|---|---|---|---|
| `A` | `board` | `217.160.186.250` | 1 heure (ou moins) |

Vérifier : `dig +short board.kantoaplo.com` → `217.160.186.250`. N'ajoutez un `AAAA` que si vos autres
sous-domaines ont déjà une IPv6 fonctionnelle.

## 2. Vérifications préalables (lecture seule)

Sur le VPS (en root ou avec `sudo`) :

```bash
cat /etc/almalinux-release                         # AlmaLinux release 9.x
nginx -v && sudo nginx -t                          # la configuration actuelle doit être valide
ls /etc/nginx/conf.d/                              # vos 3 sites ; aucun board.kantoaplo.com
sudo grep -rn "board.kantoaplo.com" /etc/nginx     # doit ne rien afficher
sudo ss -ltnp | grep -E ':(7001|7002)\b'           # doit ne rien afficher (ports libres)
node -v; npm -v; pm2 -v; pm2 ls                    # vos applications PM2 actuelles
mongosh --version; systemctl is-active mongod
sudo firewall-cmd --list-all                       # http et https autorisés ; NE PAS ouvrir 7001/7002
getenforce                                         # Enforcing : géré par le script (§9)
certbot --version; systemctl list-timers | grep -i certbot
```

S'il manque un outil : Node.js 22 (`sudo dnf module install -y nodejs:22` ou nvm), PM2
(`sudo npm install -g pm2`), git (`sudo dnf install -y git`). certbot est installé par le script si absent.

## 3. Code

Le dépôt est privé : clé de déploiement en lecture seule pour l'utilisateur qui exécute déjà PM2.

```bash
ssh-keygen -t ed25519 -C "board.kantoaplo.com" -f ~/.ssh/board_deploy -N ""
cat ~/.ssh/board_deploy.pub     # GitHub → CephaloSophie/board → Settings → Deploy keys → Add (lecture seule)
cat >> ~/.ssh/config <<'CFG'
Host github-board
  HostName github.com
  User git
  IdentityFile ~/.ssh/board_deploy
CFG

sudo mkdir -p /opt/board-kantoaplo && sudo chown "$USER": /opt/board-kantoaplo
git clone github-board:CephaloSophie/board.git /opt/board-kantoaplo
cd /opt/board-kantoaplo
git checkout board-v1.0.1       # branche ou tag à déployer
```

## 4. MongoDB : base `boardKantoAplo`

MongoDB est déjà installé : on ajoute seulement un utilisateur dédié, sans toucher à `/etc/mongod.conf`.

```bash
cd /opt/board-kantoaplo
npm run env:vps
```

La commande crée `server/.env` et `client/.env` (droits 600, jamais écrasés s'ils existent) avec un
mot de passe MongoDB et un `JWT_SECRET` aléatoires, puis **affiche la commande de création de
l'utilisateur**. Exécutez-la :

- **authentification MongoDB activée** (recommandé) — avec votre compte administrateur MongoDB :

  ```bash
  mongosh "mongodb://127.0.0.1:27017/admin" -u <admin> -p --eval 'db.getSiblingDB("admin").createUser({ user: "board", pwd: "<affiché>", roles: [{ role: "readWrite", db: "boardKantoAplo" }] })'
  ```

- **authentification désactivée** : la même commande sans `-u <admin> -p`. L'URI de `server/.env` utilise
  l'utilisateur `board`. N'activez pas l'authentification dans `mongod.conf` sans vérifier que vos autres
  applications se connectent déjà avec un identifiant : elles seraient refusées.

Test : `mongosh "$(grep ^MONGODB_URI server/.env | cut -d= -f2-)" --eval 'db.getName()'` → `boardKantoAplo`.

La base est créée automatiquement au premier enregistrement.

## 5. Variables d'environnement

**`server/.env`** (généré, `chmod 600`)

| Variable | Valeur |
|---|---|
| `PORT` | `7002` |
| `HOST` | `127.0.0.1` |
| `MONGODB_URI` | `mongodb://board:<généré>@127.0.0.1:27017/boardKantoAplo?authSource=admin` |
| `JWT_SECRET` | 96 caractères hexadécimaux aléatoires (le changer déconnecte tout le monde) |
| `JWT_EXPIRES_IN` | `30d` |
| `CLIENT_ORIGIN` | `https://board.kantoaplo.com` |

**`client/.env`**

| Variable | Valeur |
|---|---|
| `VITE_PORT` | `7001` |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:7002` |
| `WEB_HOST` | `127.0.0.1` |

**Variables fixées par PM2** (`ecosystem.vps.config.cjs`, prioritaires sur les `.env`) :

| Processus | Variables |
|---|---|
| `kydos-server` | `NODE_ENV=production` `PORT=7002` `HOST=127.0.0.1` `CLIENT_ORIGIN=https://board.kantoaplo.com` `JWT_EXPIRES_IN` `KYDOS_PUBLIC_URL=https://board.kantoaplo.com` — `MONGODB_URI` et `JWT_SECRET` lus dans `server/.env`, jamais copiés dans PM2 |
| `kydos-client` | `NODE_ENV=production` `WEB_PORT=7001` `WEB_HOST=127.0.0.1` `API_URL=http://127.0.0.1:7002` |

PM2 refuse de démarrer si `server/.env` manque, si `MONGODB_URI` ne vise pas la base `boardKantoAplo`
(ou contient des identifiants de développement) ou si `JWT_SECRET` est trop court.

## 6. Installation, build et données

```bash
cd /opt/board-kantoaplo
npm run setup        # dépendances server/ et client/
npm run build        # client/dist
```

Puis **un seul** des deux cas :

- **Base neuve** : `npm run seed` → projet Kýdos Belote (KB) avec l'historique de `tasks.json`, anciennes
  versions publiées et anciens sprints terminés, version et sprint courants **19.0.3**.
  Il crée aussi les comptes `ameur` et `hamido` (mot de passe `@bloardKydos`) : changez-les (§7).
- **Reprise des données du poste actuel** :

  ```bash
  # sur le poste source
  mongodump --uri "mongodb://…/bordjdddddddira?authSource=admin" --gzip --archive=board.gz
  scp board.gz <utilisateur>@217.160.186.250:/tmp/
  # sur le VPS
  mongorestore --uri "$(grep ^MONGODB_URI server/.env | cut -d= -f2-)" --gzip --archive=/tmp/board.gz \
    --nsFrom='bordjdddddddira.*' --nsTo='boardKantoAplo.*'
  npm run migrate -- --dry-run && npm run migrate
  npm run release:align -- --dry-run && npm run release:align     # sprints / versions alignés sur 19.0.3
  rm /tmp/board.gz
  ```

## 7. Super admin depuis la console

```bash
cd /opt/board-kantoaplo
npm run admin:create
```

Questions posées : identifiant, nom affiché, e-mail (facultatif), mot de passe saisi deux fois sans écho
(10 caractères minimum, lettres et chiffres). Le compte est créé dans la base `boardKantoAplo` avec le rôle
**super admin** et peut se connecter immédiatement sur https://board.kantoaplo.com.

| Commande | Effet |
|---|---|
| `npm run admin:create` | création interactive |
| `npm run admin:create -- --username alice --name "Alice Martin" --email alice@kantoaplo.com` | champs en arguments, mot de passe demandé |
| `npm run admin:create -- --username bob --promote` | compte existant → super admin (et réactivé s'il était désactivé) |
| `npm run admin:create -- --username bob --promote --reset-password` | idem + nouveau mot de passe |
| `KYDOS_ADMIN_PASSWORD='…' npm run admin:create -- --username ci --name CI` | sans terminal (script) ; sans cette variable un mot de passe est généré et affiché une fois |
| `npm run admin:list` | super admins de la base (● actif, ○ désactivé) |

Après un seed, désactivez ou modifiez les comptes par défaut depuis *Utilisateurs*.

## 8. PM2

```bash
cd /opt/board-kantoaplo
npm run start:vps        # ajoute kydos-server et kydos-client à PM2 (vos autres applications restent en place)
pm2 ls
npm run health           # API, front, front → API en local
pm2 save                 # mémorise la liste complète (vos applications + board)
```

Si PM2 n'est pas encore lancé au démarrage du serveur : `pm2 startup systemd` puis la commande `sudo`
affichée, et `pm2 save`. S'il l'est déjà pour vos autres applications, `pm2 save` suffit.

Réglages appliqués :

| | kydos-server | kydos-client |
|---|---|---|
| Script | `server/src/index.js` | `client/serve.cjs` |
| Écoute | `127.0.0.1:7002` | `127.0.0.1:7001` |
| Mémoire | tas 768 Mo, redémarrage au-delà de 900 Mo | tas 192 Mo, redémarrage au-delà de 256 Mo |
| Redémarrage | automatique, délai progressif, arrêt propre (10 s) | idem |
| Journaux | `logs/server.out.log` · `logs/server.err.log` | `logs/client.out.log` · `logs/client.err.log` |

Commandes limitées à board : `npm run reload:vps`, `npm run logs`, `pm2 restart kydos-server`,
`pm2 stop kydos-server kydos-client`. Évitez `pm2 restart all` / `pm2 delete all`, qui toucheraient vos autres applications.
Rotation des journaux (si pas déjà installée) : `pm2 install pm2-logrotate`.

## 9. nginx et HTTPS pour board.kantoaplo.com

DNS du §1 en place et PM2 démarré :

```bash
cd /opt/board-kantoaplo
sudo bash deploy/vps/setup-https.sh admin@kantoaplo.com     # adresse des alertes Let's Encrypt
```

Le script **ajoute** le site sans rien casser :

1. `nginx -t` sur la configuration actuelle — arrêt si elle est déjà en erreur ;
2. sauvegarde complète : `/root/nginx-backup-AAAAMMJJ-HHMMSS.tar.gz` ;
3. contrôles : aucun autre fichier ne déclare `board.kantoaplo.com`, le DNS pointe vers `217.160.186.250`,
   état des ports 7001 / 7002 ;
4. **SELinux** : active `httpd_can_network_connect` si nécessaire (sans quoi nginx ne peut pas joindre 127.0.0.1:7001/7002 → 502) ;
5. installe certbot s'il manque (`dnf install epel-release certbot`) ;
6. installe `/etc/nginx/conf.d/board.kantoaplo.com.conf` en version HTTP provisoire, `nginx -t`, **reload**,
   obtient le certificat par défi webroot (`/var/www/certbot`) — seul ce sous-domaine est concerné ;
7. installe la version HTTPS définitive, `nginx -t`, **reload** ; si un `nginx -t` échoue, le fichier est retiré
   et nginx n'est pas rechargé ;
8. renouvellement : hook de rechargement de nginx (s'il n'existe pas déjà), timer `certbot-renew`,
   `certbot renew --dry-run --cert-name board.kantoaplo.com` ;
9. affiche les codes HTTP de `board.kantoaplo.com` **et de vos autres sous-domaines** pour confirmer qu'ils répondent toujours.

Précautions de la configuration nginx pour cohabiter avec les autres sites : pas de `default_server`, aucune
option ajoutée aux `listen 80` / `listen 443` partagés (`http2 on;` n'est ajouté que si nginx ≥ 1.25.1,
où il s'applique à ce seul serveur), noms d'`upstream` et de cache TLS propres à board, IPv6 commentée,
HSTS sans `includeSubDomains`, journaux dédiés `/var/log/nginx/board.kantoaplo.com.*.log`.

Configuration HTTPS : TLS 1.2 / 1.3 (profil Mozilla intermediate), redirection HTTP → HTTPS,
HSTS 1 an, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, gzip,
envois jusqu'à 30 Mo, 300 s sur `/api` (imports Jira).

Équivalent manuel (AlmaLinux) :

```bash
sudo nginx -t && sudo tar czf /root/nginx-backup-$(date +%F).tar.gz -C /etc nginx
sudo setsebool -P httpd_can_network_connect 1
sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx/board.kantoaplo.com.bootstrap.conf /etc/nginx/conf.d/board.kantoaplo.com.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d board.kantoaplo.com --email admin@kantoaplo.com --agree-tos --no-eff-email
sudo sed 's|^[[:space:]]*# @HTTP2@.*$||' deploy/nginx/board.kantoaplo.com.conf | sudo tee /etc/nginx/conf.d/board.kantoaplo.com.conf >/dev/null
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run --cert-name board.kantoaplo.com
```

## 10. Vérifications

```bash
npm run health:vps                        # local + https://board.kantoaplo.com + redirection HTTP
curl -I https://board.kantoaplo.com       # 200 + strict-transport-security
curl -I http://board.kantoaplo.com        # 301 → https
curl -sI https://<autre-sous-domaine>     # vos autres sites : même réponse qu'avant
```

- Ouvrir https://board.kantoaplo.com, se connecter avec le super admin du §7.
- https://www.ssllabs.com/ssltest/analyze.html?d=board.kantoaplo.com → note A attendue.
- Après un redémarrage du VPS : `pm2 ls` montre `kydos-server` et `kydos-client` « online ».

## 11. Mises à jour

```bash
cd /opt/board-kantoaplo
npm run deploy:vps                 # git pull, dépendances, build, aperçu de migration, pm2 reload (board seulement), contrôles
npm run deploy:vps -- --migrate    # applique aussi la migration de données
```

Le fichier nginx et le certificat ne changent pas lors d'une mise à jour. Si `deploy/nginx/board.kantoaplo.com.conf`
évolue, relancez `sudo bash deploy/vps/setup-https.sh` (certificat conservé, sauvegarde et `nginx -t` à nouveau).

## 12. Sauvegardes

Toutes les données (tâches, historique, journal, notifications, images) sont dans `boardKantoAplo`.
Sauvegarde quotidienne à 3 h, 14 jours conservés (`crontab -e`) :

```cron
0 3 * * * mkdir -p $HOME/backups/board && mongodump --uri "$(grep ^MONGODB_URI /opt/board-kantoaplo/server/.env | cut -d= -f2-)" --gzip --archive=$HOME/backups/board/boardKantoAplo-$(date +\%F).gz && find $HOME/backups/board -name '*.gz' -mtime +14 -delete
```

Restauration : `mongorestore --uri "<MONGODB_URI>" --gzip --archive=<fichier>.gz --drop`.

## 13. Retour arrière

```bash
pm2 delete kydos-server kydos-client && pm2 save          # arrête board uniquement
sudo rm /etc/nginx/conf.d/board.kantoaplo.com.conf
sudo nginx -t && sudo systemctl reload nginx               # les autres sites restent servis
sudo certbot delete --cert-name board.kantoaplo.com        # facultatif
# restauration complète de nginx si nécessaire :
sudo tar xzf /root/nginx-backup-<date>.tar.gz -C /etc && sudo nginx -t && sudo systemctl reload nginx
```

## 14. Dépannage

| Symptôme | Vérification | Solution |
|---|---|---|
| `502 Bad Gateway` sur board | `pm2 ls`, `npm run logs` | `npm run start:vps` / `npm run reload:vps` |
| 502 alors que PM2 est « online » | `sudo ausearch -m avc -ts recent \| grep nginx` | SELinux : `sudo setsebool -P httpd_can_network_connect 1` |
| PM2 : « server/.env invalide pour la production » | message au démarrage | corriger `MONGODB_URI` (base `boardKantoAplo`) ou `JWT_SECRET`, `npm run env:vps` sur une installation neuve |
| `Authentication failed` (MongoDB) | `mongosh "<MONGODB_URI>"` | recréer l'utilisateur `board` (§4) avec le mot de passe de `server/.env` |
| certbot « unauthorized » / « connection refused » | `dig +short board.kantoaplo.com`, `curl http://board.kantoaplo.com/.well-known/acme-challenge/x` | enregistrement A, service `http` dans firewalld, site provisoire actif |
| « conflicting server name board.kantoaplo.com » | `sudo grep -rn board.kantoaplo.com /etc/nginx` | supprimer le doublon, relancer le script |
| `EADDRINUSE :7001` / `:7002` | `sudo ss -ltnp \| grep -E ':700[12]'` | libérer le port (autre application) |
| Page « Front non construit » | `ls client/dist` | `npm run build && npm run reload:vps` |
| Build interrompu (`Killed`) | `free -h` | fermer des processus gourmands pendant le build ou ajouter du swap |
| Un autre sous-domaine ne répond plus | `sudo nginx -t`, `sudo tail /var/log/nginx/error.log` | §13 : retirer `board.kantoaplo.com.conf` ou restaurer la sauvegarde nginx |
