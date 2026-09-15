#!/usr/bin/env bash
# Ajoute https://board.kantoaplo.com à un nginx EXISTANT sans toucher aux autres sites
# (AlmaLinux 9 / RHEL, fonctionne aussi sur Debian / Ubuntu). À lancer sur le VPS, depuis la racine du projet :
#
#   sudo bash deploy/vps/setup-https.sh admin@kantoaplo.com
#
# Déroulé : nginx -t initial (arrêt si la configuration actuelle est déjà en erreur) → sauvegarde de /etc/nginx
# → contrôles (DNS vers 217.160.186.250, doublon de server_name, ports 7001/7002, SELinux) → site HTTP provisoire
# → certificat Let's Encrypt (webroot, propre à ce sous-domaine) → site HTTPS définitif → renouvellement.
# Chaque changement passe par « nginx -t » ; en cas d'échec le fichier ajouté est retiré et nginx n'est pas rechargé.
# nginx est seulement rechargé (reload), jamais redémarré : les autres sites ne sont pas interrompus.
# Variables : DOMAIN, EXPECTED_IP, SKIP_DNS_CHECK=1 (propagation DNS en cours).
set -euo pipefail

DOMAIN="${DOMAIN:-board.kantoaplo.com}"
EXPECTED_IP="${EXPECTED_IP:-217.160.186.250}"
EMAIL="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEBROOT=/var/www/certbot
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '✖ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "À lancer avec sudo."
command -v nginx >/dev/null || fail "nginx introuvable : ce script complète une installation nginx existante."
[ -f "$CERT" ] || [ -n "$EMAIL" ] || fail "Usage : sudo bash deploy/vps/setup-https.sh <email pour Let's Encrypt>"

reload_nginx() {
  if command -v systemctl >/dev/null && systemctl is-active --quiet nginx 2>/dev/null; then systemctl reload nginx; else nginx -s reload; fi
  sleep 2 # reload is asynchronous: let the workers pick up the new configuration
}

# Proves nginx serves the Let's Encrypt challenge of $DOMAIN before asking certbot (reload delay, SELinux, other vhosts).
wait_for_challenge() {
  local probe="kydos-probe-$$" got=""
  echo "$probe" > "${WEBROOT}/.well-known/acme-challenge/${probe}"
  command -v restorecon >/dev/null && restorecon -R "$WEBROOT" || true
  for _ in $(seq 1 20); do
    got="$(curl -s --max-time 2 -H "Host: ${DOMAIN}" "http://127.0.0.1/.well-known/acme-challenge/${probe}" || true)"
    [ "$got" = "$probe" ] && break
    sleep 0.5
  done
  rm -f "${WEBROOT}/.well-known/acme-challenge/${probe}"
  [ "$got" = "$probe" ] || fail "nginx ne sert pas le défi Let's Encrypt de ${DOMAIN} (réponse : ${got:0:80}) — SELinux (restorecon -R ${WEBROOT}) ou autre site prioritaire ?"
  echo "    ✔ défi HTTP de ${DOMAIN} servi par nginx"
}

# --- Emplacement des sites : conf.d (AlmaLinux / RHEL) ou sites-available (Debian) ---
if grep -qE '^\s*include\s+/etc/nginx/sites-enabled/' /etc/nginx/nginx.conf && [ -d /etc/nginx/sites-available ]; then
  SITE="/etc/nginx/sites-available/${DOMAIN}"
  ENABLE="/etc/nginx/sites-enabled/${DOMAIN}"
else
  SITE="/etc/nginx/conf.d/${DOMAIN}.conf"
  ENABLE=""
fi

say "1. Configuration nginx actuelle"
nginx -v 2>&1
nginx -t || fail "La configuration nginx actuelle est déjà invalide : corrigez-la avant d'ajouter ${DOMAIN}."
echo "    Fichier du site : ${SITE}"

say "2. Sauvegarde de /etc/nginx"
BACKUP="/root/nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$BACKUP" -C /etc nginx
echo "    ${BACKUP}"

say "3. Contrôles"
OTHERS="$(grep -rlsE "server_name[^;]*[[:space:]]${DOMAIN//./\\.}([[:space:];]|$)" /etc/nginx 2>/dev/null | grep -vxF "$SITE" | grep -vxF "${ENABLE:-/nonexistent}" || true)"
[ -z "$OTHERS" ] || fail "${DOMAIN} est déjà déclaré dans : ${OTHERS} — retirez ce doublon d'abord."
echo "    ✔ aucun autre fichier ne déclare ${DOMAIN}"

if [ "${SKIP_DNS_CHECK:-0}" != 1 ]; then
  DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)"
  [ "$DNS_IP" = "$EXPECTED_IP" ] || fail "${DOMAIN} résout vers « ${DNS_IP:-rien} » au lieu de ${EXPECTED_IP} : créez l'enregistrement A « board » (ou SKIP_DNS_CHECK=1)."
  echo "    ✔ DNS ${DOMAIN} → ${DNS_IP}"
fi

if command -v ss >/dev/null; then
  for port in 7001 7002; do
    LISTENER="$(ss -ltnpH "( sport = :${port} )" 2>/dev/null || true)"
    if [ -z "$LISTENER" ]; then echo "    ⚠ rien n'écoute sur ${port} (npm run start:vps) — le certificat peut quand même être obtenu"
    elif ! grep -q "127.0.0.1:${port}" <<<"$LISTENER"; then echo "    ⚠ le port ${port} n'écoute pas sur 127.0.0.1 : ${LISTENER}"
    else echo "    ✔ port ${port} : $(grep -o 'users:(("[^"]*"' <<<"$LISTENER" | cut -d'"' -f2)"; fi
  done
fi

if command -v getenforce >/dev/null && [ "$(getenforce)" != "Disabled" ]; then
  if [ "$(getsebool httpd_can_network_connect | awk '{print $3}')" != "on" ]; then
    setsebool -P httpd_can_network_connect 1
    echo "    ✔ SELinux : httpd_can_network_connect activé (nginx → 127.0.0.1:7001 / 7002)"
  else
    echo "    ✔ SELinux : nginx peut déjà joindre les ports locaux"
  fi
fi

say "4. certbot"
if ! command -v certbot >/dev/null; then
  if command -v dnf >/dev/null; then dnf install -y epel-release && dnf install -y certbot
  elif command -v apt-get >/dev/null; then apt-get update -y && apt-get install -y certbot
  else fail "Installez certbot puis relancez."; fi
fi
certbot --version
mkdir -p "${WEBROOT}/.well-known/acme-challenge"
command -v restorecon >/dev/null && restorecon -R "$WEBROOT" || true

# http2 per server only (nginx >= 1.25.1); older versions would need the shared « listen » option, left untouched.
NGINX_VERSION="$(nginx -v 2>&1 | sed -E 's#.*/([0-9.]+).*#\1#')"
if [ "$(printf '%s\n' 1.25.1 "$NGINX_VERSION" | sort -V | head -1)" = "1.25.1" ]; then
  HTTP2_LINE="    http2 on;"
else
  HTTP2_LINE="    # http2 non activé : nginx ${NGINX_VERSION} l'imposerait à tous les sites du port 443"
fi

apply() {
  local template="$1" previous=""
  if [ -f "$SITE" ]; then previous="$(mktemp)"; cp "$SITE" "$previous"; fi
  sed -e "s/board\.kantoaplo\.com/${DOMAIN}/g" -e "s|^[[:space:]]*# @HTTP2@.*$|${HTTP2_LINE}|" "$template" > "${SITE}.new"
  mv "${SITE}.new" "$SITE"
  if [ -n "$ENABLE" ]; then ln -sf "$SITE" "$ENABLE"; fi
  command -v restorecon >/dev/null && restorecon "$SITE" || true
  if ! nginx -t; then
    if [ -n "$previous" ]; then cp "$previous" "$SITE"; else rm -f "$SITE"; [ -z "$ENABLE" ] || rm -f "$ENABLE"; fi
    fail "nginx -t a échoué avec ${template##*/} : retour à l'état précédent, nginx n'a pas été rechargé (sauvegarde : ${BACKUP})."
  fi
  reload_nginx
}

if [ ! -f "$CERT" ]; then
  say "5. Site HTTP provisoire et demande du certificat"
  apply "${ROOT}/deploy/nginx/board.kantoaplo.com.bootstrap.conf"
  wait_for_challenge
  certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive --keep-until-expiring
else
  say "5. Certificat existant conservé ($(openssl x509 -enddate -noout -in "$CERT" 2>/dev/null || echo "${CERT}"))"
fi

say "6. Site HTTPS définitif"
apply "${ROOT}/deploy/nginx/board.kantoaplo.com.conf"
echo "    ✔ ${SITE}"

say "7. Renouvellement automatique"
HOOK_DIR=/etc/letsencrypt/renewal-hooks/deploy
if grep -rqs nginx "$HOOK_DIR" 2>/dev/null; then
  echo "    ✔ un hook rechargeant nginx existe déjà"
else
  install -d "$HOOK_DIR"
  printf '#!/bin/sh\nsystemctl reload nginx\n' > "${HOOK_DIR}/reload-nginx.sh"
  chmod +x "${HOOK_DIR}/reload-nginx.sh"
  echo "    ✔ ${HOOK_DIR}/reload-nginx.sh"
fi
if command -v systemctl >/dev/null; then
  if systemctl list-unit-files 2>/dev/null | grep -q '^certbot-renew.timer'; then systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || true; fi
  systemctl list-timers 2>/dev/null | grep -i certbot || echo "    ⚠ aucun timer certbot visible : vérifiez le renouvellement (crontab ou timer)"
fi
certbot renew --dry-run --cert-name "$DOMAIN"

say "8. Contrôles"
curl -s -o /dev/null -w "    http://${DOMAIN}/            → %{http_code} (301 attendu)\n" "http://${DOMAIN}/" || true
curl -s -o /dev/null -w "    https://${DOMAIN}/healthz    → %{http_code}\n" "https://${DOMAIN}/healthz" || true
curl -s -o /dev/null -w "    https://${DOMAIN}/api/health → %{http_code}\n" "https://${DOMAIN}/api/health" || true
echo "    Autres sites HTTPS de ce nginx (doivent répondre comme avant) :"
for name in $(nginx -T 2>/dev/null | grep -v '^[[:space:]]*#' | grep -oE 'server_name[[:space:]][^;]*' | awk '{ for (i = 2; i <= NF; i++) print $i }' | sort -u); do
  case "$name" in "$DOMAIN"|_|localhost|*'*'*|'') continue ;; esac
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 8 --resolve "${name}:443:127.0.0.1" "https://${name}/" || echo "---")"
  echo "      ${name} → ${code}"
done
echo
echo "Terminé : https://${DOMAIN} (sauvegarde nginx : ${BACKUP})"
