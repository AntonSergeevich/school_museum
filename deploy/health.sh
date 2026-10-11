#!/usr/bin/env bash
# Что с сайтом — одной командой. Вывод можно целиком переслать разработчику.
#   sudo bash /srv/museum/deploy/health.sh
set -uo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"
line() { printf '\n=== %s ===\n' "$1"; }

line "Служба сайта"
systemctl is-active "$SERVICE" >/dev/null && echo "работает" || echo "НЕ РАБОТАЕТ — причина в журнале ниже"
line "Журнал сайта (40 строк)"
journalctl -u "$SERVICE" -n 40 --no-pager 2>&1 | tail -40
line "Ответ приложения через сокет"
CODE="$(PROBE_WAIT=3 "$ROOT/deploy/probe.sh")"
case "$CODE" in
    200) echo "200 — приложение живо" ;;
    нет-сокета) echo "сокета $SOCKET нет — служба не поднялась" ;;
    000) echo "сокет есть, ответа нет — приложение зависло" ;;
    *) echo "код $CODE — приложение отвечает ошибкой (400 — проверьте DJANGO_ALLOWED_HOSTS)" ;;
esac
line "nginx"
systemctl is-active nginx >/dev/null && echo "работает" || echo "НЕ РАБОТАЕТ"
nginx -t 2>&1 | tail -2
echo "Отказов по лимиту частоты: $(grep -c 'limiting requests' /var/log/nginx/error.log 2>/dev/null || echo 0)"
line "Ответы 5xx и 429 в журнале доступа"
awk '{print $9}' /var/log/nginx/access.log 2>/dev/null | grep -E '^(429|5[0-9][0-9])$' | sort | uniq -c || true
line "Сертификат"
DOMAIN="$(env_value SITE_DOMAIN)"
if [ -n "$DOMAIN" ] && [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
else
    echo "нет (сайт работает по HTTP)"
fi
line "Автодеплой"
systemctl is-active museum-deploy-webhook >/dev/null && echo "слушатель работает" || echo "слушатель НЕ работает"
tail -5 /var/log/museum-deploy.log 2>/dev/null || true
line "Диск и память"
df -h / | tail -1
echo "Медиа: $(du -sh "$ROOT/media" 2>/dev/null | cut -f1), копии: $(du -sh /srv/backups/museum 2>/dev/null | cut -f1)"
free -h | head -2
line "Версия кода"
git -C "$ROOT" log --oneline -1 2>&1
