#!/usr/bin/env bash
# nginx + HTTPS Let's Encrypt pour board.kantoaplo.com, à lancer SUR LE VPS depuis la racine du projet :
#   sudo bash deploy/vps/setup-https.sh admin@kantoaplo.com
# Idempotent : réutilise le certificat s'il existe, réinstalle la configuration, vérifie le renouvellement.
set -euo pipefail

DOMAIN="${DOMAIN:-board.kantoaplo.com}"
EMAIL="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SITE="/etc/nginx/sites-available/${DOMAIN}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

[ "$(id -u)" = 0 ] || { echo "À lancer avec sudo." >&2; exit 1; }
[ -n "$EMAIL" ] || [ -f "$CERT" ] || { echo "Usage : sudo bash deploy/vps/setup-https.sh <email pour Let's Encrypt>" >&2; exit 2; }

echo "==> Paquets nginx et certbot"
if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null; then
  apt-get update -y
  apt-get install -y nginx certbot
fi
mkdir -p /var/www/certbot

echo "==> Vérification DNS de ${DOMAIN}"
PUBLIC_IP="$(curl -4 -fsS --max-time 5 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "${DOMAIN}" | awk 'NR==1 {print $1}' || true)"
echo "    IP du VPS : ${PUBLIC_IP:-inconnue} · ${DOMAIN} → ${DNS_IP:-non résolu}"
if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "$DNS_IP" ]; then
  echo "    ATTENTION : l'enregistrement A de ${DOMAIN} ne pointe pas (encore) vers ce VPS." >&2
fi

render() { sed "s/board\.kantoaplo\.com/${DOMAIN}/g" "$1" > "$SITE"; ln -sf "$SITE" "/etc/nginx/sites-enabled/${DOMAIN}"; }

if [ ! -f "$CERT" ]; then
  echo "==> Configuration HTTP provisoire et demande du certificat"
  render "${ROOT}/deploy/nginx/board.kantoaplo.com.bootstrap.conf"
  nginx -t
  systemctl reload nginx || systemctl restart nginx
  certbot certonly --webroot -w /var/www/certbot -d "${DOMAIN}" \
    --email "${EMAIL}" --agree-tos --no-eff-email --non-interactive
fi

echo "==> Configuration HTTPS définitive"
render "${ROOT}/deploy/nginx/board.kantoaplo.com.conf"
nginx -t
systemctl reload nginx

echo "==> Renouvellement automatique (recharge nginx après chaque renouvellement)"
install -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
certbot renew --dry-run

echo "==> Contrôles"
curl -fsS -o /dev/null -w "    http://${DOMAIN}/  → %{http_code} (301 attendu)\n" "http://${DOMAIN}/" || true
curl -fsS -o /dev/null -w "    https://${DOMAIN}/healthz → %{http_code}\n" "https://${DOMAIN}/healthz" || echo "    front injoignable : npm run start:vps ?"
curl -fsS -o /dev/null -w "    https://${DOMAIN}/api/health → %{http_code}\n" "https://${DOMAIN}/api/health" || echo "    API injoignable : npm run start:vps ?"
echo "Terminé : https://${DOMAIN}"
