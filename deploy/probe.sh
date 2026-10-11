#!/usr/bin/env bash
# Спросить сайт так, как его спрашивает nginx, и напечатать код ответа.
#   ./deploy/probe.sh        → 200
#   ./deploy/probe.sh /health/
#
# Стучимся в юникс-сокет gunicorn, а не в порт: порта здесь нет, и проверка
# «на 127.0.0.1:8000» однажды объявляла живой сайт мёртвым.
# Заголовок Host обязателен: без него curl шлёт «localhost», которого нет
# в ALLOWED_HOSTS, и Django честно отвечает 400 — проверка принимала это
# за поломку. X-Forwarded-Proto нужен, когда включён HTTPS: иначе 301.
set -uo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"

PATH_TO_CHECK="${1:-/}"
WAIT="${PROBE_WAIT:-20}"
HOST="$(env_value DJANGO_ALLOWED_HOSTS | cut -d, -f1 | tr -d ' ')"
HOST="${HOST#.}"
HOST="${HOST:-localhost}"

CODE=""
END=$((SECONDS + WAIT))
while :; do
    if [ -S "$SOCKET" ]; then
        # -q: не читать чужие ~/.curlrc (их --retry однажды превратил «000» в «000000»).
        CODE="$(curl -q -sS -o /dev/null -w '%{http_code}' --max-time 10 --unix-socket "$SOCKET" \
            -H "Host: $HOST" -H 'X-Forwarded-Proto: https' "http://localhost$PATH_TO_CHECK" 2>/dev/null || true)"
        CODE="$(printf '%s' "$CODE" | tr -cd '0-9' | tail -c 3)"
        [ -n "$CODE" ] && [ "$CODE" != "000" ] && break
    fi
    [ "$SECONDS" -ge "$END" ] && break
    sleep 1
done
if [ ! -S "$SOCKET" ]; then echo "нет-сокета"; else echo "${CODE:-000}"; fi
