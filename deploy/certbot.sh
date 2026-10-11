#!/usr/bin/env bash
# Подключить домен и HTTPS. Запускать, когда A-записи домена смотрят на сервер:
#   sudo bash /srv/museum/deploy/certbot.sh museum149.ru
# Повторный запуск с другим доменом переводит сайт на новый домен.
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"

DOMAIN="${1:-$(env_value SITE_DOMAIN)}"
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"
[ -n "$DOMAIN" ] || { echo "Укажите домен: sudo bash $0 museum149.ru"; exit 1; }
# Кириллический домен (.рф) certbot и nginx понимают только в punycode.
if printf '%s' "$DOMAIN" | grep -qP '[^\x00-\x7F]'; then
    DOMAIN="$(python3 -c 'import sys;print(sys.argv[1].encode("idna").decode())' "$DOMAIN")"
    echo "Домен в punycode: $DOMAIN"
fi
EMAIL="${EMAIL:-$(env_value ADMIN_EMAIL)}"
IP="$(server_ip)"

echo "→ Проверяю DNS"
RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ')"
if ! printf '%s' "$RESOLVED" | grep -qw "$IP"; then
    echo "✗ $DOMAIN указывает на «${RESOLVED:-ничего}», а сервер — $IP."
    echo "  В панели регистратора: A-запись @ → $IP и A-запись www → $IP."
    echo "  Обновление DNS занимает от 15 минут до суток. Проверка: getent ahostsv4 $DOMAIN"
    exit 1
fi
NAMES=(-d "$DOMAIN")
if getent ahostsv4 "www.$DOMAIN" | awk '{print $1}' | grep -qw "$IP"; then
    NAMES+=(-d "www.$DOMAIN")
else
    echo "  www.$DOMAIN не настроен — сертификат только на $DOMAIN"
fi

echo "→ Домен в настройках сайта"
set_env SITE_DOMAIN "$DOMAIN"
set_env SITE_URL "https://$DOMAIN"
set_env DJANGO_ALLOWED_HOSTS "$DOMAIN,www.$DOMAIN,$IP"
set_env DJANGO_CSRF_TRUSTED_ORIGINS "https://$DOMAIN,https://www.$DOMAIN"
fix_permissions

# Сначала HTTP-конфиг с новым именем: certbot проверяет домен через
# /.well-known/acme-challenge/, а боевой конфиг без сертификата не стартует.
mkdir -p /var/www/certbot
render_nginx > "$NGINX_SITE"
nginx -t && systemctl restart nginx

echo "→ Сертификат Let's Encrypt"
# certonly --webroot не трогает конфиги nginx — их пишем мы сами.
if [ -n "$EMAIL" ]; then CONTACT=(--email "$EMAIL"); else CONTACT=(--register-unsafely-without-email); fi
certbot certonly --webroot -w /var/www/certbot "${NAMES[@]}" "${CONTACT[@]}" \
    --non-interactive --agree-tos --keep-until-expiring

mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/museum-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/museum-nginx.sh

echo "→ Включаю HTTPS"
render_nginx > "$NGINX_SITE"
nginx -t && systemctl restart nginx
set_env DJANGO_HTTPS 1
systemctl restart "$SERVICE"
CODE="$("$ROOT/deploy/probe.sh")"
echo "✓ https://$DOMAIN — приложение отвечает $CODE"
echo "  Если вебхук GitHub был на http://$IP/…, поменяйте Payload URL на https://$DOMAIN/internal/deploy-webhook"
