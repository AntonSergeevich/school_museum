#!/usr/bin/env bash
# Выкатка новой версии. Запускает вебхук автодеплоя, можно и руками:
#   sudo bash /srv/museum/deploy/update.sh          — если в ветке есть новое
#   sudo FORCE=1 bash /srv/museum/deploy/update.sh  — пересобрать текущую
#
# Порядок: копия базы → код → зависимости → миграции → статика → проверка
# настроек → службы и nginx → перезапуск → проверка ответа сайта.
# Если сайт после выкатки не отвечает 200 — автоматический откат кода
# на прошлую версию. Об итоге приходит сообщение в MAX.
set -Eeuo pipefail

# bash читает скрипт по ходу выполнения, а шаг «обновление кода» подменяет
# этот самый файл. Чтобы не доиграть строки новой версии со старого места,
# выполняемся из копии во временном каталоге.
if [ -z "${MUSEUM_UPDATE_COPY:-}" ]; then
    MUSEUM_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    COPY="$(mktemp /tmp/museum-update.XXXXXX)"
    cp "$0" "$COPY"
    MUSEUM_UPDATE_COPY="$COPY" MUSEUM_ROOT="$MUSEUM_ROOT" exec bash "$COPY" "$@"
fi
trap 'rm -f "$MUSEUM_UPDATE_COPY"' EXIT
export MUSEUM_ROOT
# shellcheck source=deploy/lib.sh
source "$MUSEUM_ROOT/deploy/lib.sh"

if [ "$(id -u)" -ne 0 ]; then
    echo "Запускайте от root: sudo bash $0"; exit 1
fi

# Два пуша подряд — два вебхука. Вторая выкатка ждать не будет: первая
# всё равно берёт последний коммит ветки.
exec 9>/run/museum-deploy.lock
flock -n 9 || { echo "Выкатка уже идёт"; exit 0; }
# Дескриптор блокировки не должен достаться долгоживущим процессам (9>&-),
# иначе блокировка переживёт выкатку и следующая решит, что «уже идёт».

BRANCH="$(env_value DEPLOY_BRANCH)"; BRANCH="${BRANCH:-main}"
STEP="подготовка"
PREV="$(as_app git rev-parse HEAD)"
ROLLED_CODE=0
echo "=== $(date '+%F %T') Выкатка ветки $BRANCH ==="

IN_ERROR=0
on_error() {
    local code=$?
    [ "$IN_ERROR" = 1 ] && return
    IN_ERROR=1
    trap - ERR
    echo "✗ Ошибка на шаге «$STEP» (код $code)"
    if [ "$ROLLED_CODE" = 1 ]; then
        rollback "ошибка на шаге «$STEP»"
    else
        notify "❌ Сайт музея: выкатка не удалась на шаге «$STEP». Сайт работает на прежней версии ${PREV:0:7}. Журнал: /var/log/museum-deploy.log"
    fi
    exit "$code"
}
trap on_error ERR

step() { STEP="$1"; echo "→ $1"; }

rollback() {
    trap - ERR
    echo "↩ Откат на ${PREV:0:7}: $1"
    as_app git reset -q --hard "$PREV"
    as_app .venv/bin/pip install -q -r requirements.txt || true
    as_app .venv/bin/python manage.py collectstatic --noinput -v0 || true
    as_app sh -c "git rev-parse HEAD > VERSION" || true
    fix_permissions || true
    systemctl restart "$SERVICE" 9>&- || true
    as_app sh -c "echo $NEW > .deploy-failed" || true
    local code; code="$("$ROOT/deploy/probe.sh")"
    notify "❌ Сайт музея: новая версия не заработала ($1). Откатил на ${PREV:0:7}, сайт отвечает: $code. Журнал: /var/log/museum-deploy.log"
}

step "получение изменений"
as_app git fetch -q origin "$BRANCH"
NEW="$(as_app git rev-parse "origin/$BRANCH")"
if [ "$NEW" = "$PREV" ] && [ "${FORCE:-0}" != 1 ]; then
    echo "Новых коммитов нет (${NEW:0:7})"; exit 0
fi
# Коммит, который уже откатывали, повторно не пробуем — ждём исправления.
if [ "$NEW" = "$(cat "$ROOT/.deploy-failed" 2>/dev/null)" ] && [ "${FORCE:-0}" != 1 ]; then
    echo "Коммит ${NEW:0:7} уже не заработал и был откачен — жду следующего пуша (FORCE=1 — попробовать снова)"
    exit 0
fi
SUBJECT="$(as_app git log -1 --format=%s "$NEW")"

step "резервная копия базы"
as_app "$ROOT/deploy/backup.sh" --db-only

step "обновление кода"
ROLLED_CODE=1
# reset --hard, а не pull: файл, созданный на сервере руками, не остановит выкатку.
as_app git reset -q --hard "$NEW"
# Функции (сборка конфига nginx, права и т. п.) перечитываем из новой версии:
# загруженные в начале — от прошлой, и правки в lib.sh иначе применялись бы
# только со следующей выкатки.
# shellcheck source=deploy/lib.sh
source "$ROOT/deploy/lib.sh"

step "зависимости Python"
as_app .venv/bin/pip install -q --disable-pip-version-check -r requirements.txt

step "миграции базы"
as_app .venv/bin/python manage.py migrate --noinput

step "статика"
as_app .venv/bin/python manage.py collectstatic --noinput -v0

step "проверка боевых настроек"
# --deploy ловит то, что молчит в разработке: DEBUG на бою, незащищённые куки.
as_app .venv/bin/python manage.py check --deploy --fail-level ERROR

as_app sh -c "git rev-parse HEAD > VERSION"
fix_permissions

step "службы systemd"
install -m 644 "$ROOT/deploy/museum.service" /etc/systemd/system/museum.service
# Юнит вебхука обновляем, но НЕ перезапускаем: этот скрипт запущен им же,
# и restart убил бы нас на середине. Новая версия юнита подхватится
# при следующей перезагрузке сервера или вручную.
install -m 644 "$ROOT/deploy/museum-deploy-webhook.service" /etc/systemd/system/museum-deploy-webhook.service
systemctl daemon-reload
crontab -u "$APP_USER" "$ROOT/deploy/crontab"

step "nginx"
TMP_CONF="$(mktemp)"
render_nginx > "$TMP_CONF"
if ! cmp -s "$TMP_CONF" "$NGINX_SITE"; then
    cp -a "$NGINX_SITE" "$NGINX_SITE.bak" 2>/dev/null || true
    install -m 644 "$TMP_CONF" "$NGINX_SITE"
    if nginx -t 2>&1; then
        # restart, а не reload: reload может отчитаться успехом и не применить
        # смену протоколов TLS.
        systemctl restart nginx 9>&-
        echo "  конфиг nginx обновлён"
    else
        echo "  ✗ новый конфиг nginx не прошёл проверку — возвращаю прежний"
        cp -a "$NGINX_SITE.bak" "$NGINX_SITE"
    fi
fi
rm -f "$TMP_CONF"

step "перезапуск сайта"
systemctl restart "$SERVICE" 9>&-
for _ in $(seq 1 15); do systemctl is-active --quiet "$SERVICE" && break; sleep 1; done

step "проверка ответа сайта"
CODE="$("$ROOT/deploy/probe.sh")"
if [ "$CODE" != "200" ]; then
    journalctl -u "$SERVICE" -n 30 --no-pager || true
    rollback "главная страница ответила «$CODE»"
    exit 1
fi

trap - ERR
rm -f "$ROOT/.deploy-failed"
echo "✓ Готово: ${NEW:0:7} $SUBJECT"
notify "✅ Сайт музея обновлён: ${NEW:0:7} — $SUBJECT"
