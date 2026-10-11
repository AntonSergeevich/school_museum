# Общие функции скриптов развёртывания. Подключается через source.
# shellcheck shell=bash disable=SC2034

ROOT="${MUSEUM_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_USER="${MUSEUM_USER:-$(stat -c '%U' "$ROOT" 2>/dev/null || echo museum)}"
SERVICE=museum
SOCKET=/run/museum/gunicorn.sock
NGINX_SITE=/etc/nginx/sites-available/museum

# Значение ключа из .env. Файл НЕ выполняется шеллом: в законных значениях
# бывают «<», «>» и «$» (например, «Музей <m@ya.ru>»), и `source .env`
# на них падает. При повторе ключа берём последнюю строку — так же,
# как systemd читает EnvironmentFile.
env_value() {
    local line
    line="$(grep -E "^(export )?$1=" "$ROOT/.env" 2>/dev/null | tail -1 || true)"
    line="${line#export }"
    line="${line#*=}"
    line="${line%\"}"; line="${line#\"}"
    line="${line%\'}"; line="${line#\'}"
    printf '%s' "$line"
}

# Записать ключ в .env: заменить существующую строку, а не дописать вторую.
set_env() {
    local key="$1" value="$2" tmp
    tmp="$(mktemp)"
    grep -vE "^(export )?$key=" "$ROOT/.env" > "$tmp" || true
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    cat "$tmp" > "$ROOT/.env"
    rm -f "$tmp"
}

# Команда от владельца проекта. Git и pip под root создают файлы с владельцем
# root, и следующая выкатка ломается уже на правах — поэтому root только
# управляет службами, а код трогает владелец.
# Окружение чистое (env -i): переменные root-а владельцу проекта ни к чему,
# а путь к чужому сертификату в них однажды уже уронил pip.
# Без подоболочки ( … ): при set -E ошибка внутри неё запускала обработчик
# ошибок дважды — внутри и снаружи, — и откат выполнялся два раза.
as_app() {
    runuser -u "$APP_USER" -- env -i \
        PATH=/usr/local/bin:/usr/bin:/bin HOME="$(getent passwd "$APP_USER" | cut -d: -f6)" \
        LANG=C.UTF-8 GIT_TERMINAL_PROMPT=0 \
        -C "$ROOT" "$@"
}

notify() {
    /usr/bin/python3 "$ROOT/deploy/notify_max.py" "$1" >/dev/null 2>&1 || true
}

server_ip() {
    hostname -I 2>/dev/null | awk '{print $1}'
}

# Собрать конфиг nginx: HTTPS, если для домена уже есть сертификат, иначе HTTP.
# Общая часть (nginx-common.inc) встраивается в итоговый файл целиком, чтобы
# на сервере был один конфиг, который видно глазами: nginx -T покажет всё.
render_nginx() {
    local domain template names
    domain="$(env_value SITE_DOMAIN)"
    if [ -n "$domain" ] && [ -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]; then
        template="$ROOT/deploy/nginx-https.conf"
    else
        template="$ROOT/deploy/nginx-http.conf"
    fi
    names="${domain:+$domain www.$domain }$(server_ip) _"
    python3 - "$template" "$ROOT/deploy/nginx-common.inc" "${domain:-_}" "$names" "$ROOT" <<'PY'
import sys
template, common, domain, names, root = sys.argv[1:]
inc = "".join("    " + line if line.strip() else line for line in open(common, encoding="utf-8"))
out = []
for line in open(template, encoding="utf-8"):
    out.append(inc if line.strip() == "include __ROOT__/deploy/nginx-common.inc;" else line)
text = "".join(out).replace("__DOMAIN__", domain).replace("__NAMES__", names).replace("__ROOT__", root)
sys.stdout.write(text)
PY
}

# Права: nginx (www-data) должен входить в каталог проекта и читать статику
# и медиа. adduser в Ubuntu 24.04 создаёт каталоги с 0750 — без этого сайт
# открывается без стилей и фото (403 на каждый файл). .env остаётся 600.
fix_permissions() {
    chmod 711 "$ROOT"
    mkdir -p "$ROOT/staticfiles" "$ROOT/media"
    chown -R "$APP_USER:www-data" "$ROOT/staticfiles" "$ROOT/media"
    chmod -R u+rwX,g+rX,o-rwx "$ROOT/staticfiles" "$ROOT/media"
    find "$ROOT/media" -type d -exec chmod g+s {} +
    [ -f "$ROOT/.env" ] && chown "$APP_USER:$APP_USER" "$ROOT/.env" && chmod 600 "$ROOT/.env"
    return 0
}
