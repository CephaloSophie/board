#!/usr/bin/env bash
# Mise à jour d'une installation PM2 : code, dépendances, build du front, migration, rechargement sans coupure.
#   npm run deploy                  local / générique (ecosystem.config.cjs)
#   npm run deploy:vps              VPS board.kantoaplo.com (ecosystem.vps.config.cjs)
# Options : --migrate (applique la migration, sinon aperçu)  --no-pull (sans git pull)
set -euo pipefail
cd "$(dirname "$0")/.."

PULL=1
MIGRATE=0
CONFIG=ecosystem.config.cjs
HEALTH=(npm run health)
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --migrate) MIGRATE=1 ;;
    --vps) CONFIG=ecosystem.vps.config.cjs; HEALTH=(npm run health:vps) ;;
    *) echo "Option inconnue : $arg" >&2; exit 2 ;;
  esac
done

command -v pm2 >/dev/null || { echo "pm2 introuvable : npm install -g pm2" >&2; exit 1; }
[ -f server/.env ] || { echo "server/.env manquant : npm run env:init (ou env:vps)" >&2; exit 1; }

if [ "$PULL" = 1 ] && [ -d .git ]; then git pull --ff-only; fi
npm run setup
npm run build
if [ "$MIGRATE" = 1 ]; then npm run migrate; else npm run migrate -- --dry-run; fi

mkdir -p logs
pm2 startOrReload "$CONFIG" --update-env
pm2 save
sleep 3
"${HEALTH[@]}"
