#!/usr/bin/env bash
# Установка сайта музея на чистый Beget VPS (Ubuntu 22.04 / 24.04 / 26.04) одной командой:
#
#   ssh root@IP_СЕРВЕРА
#   git clone -b main https://github.com/AntonSergeevich/school_museum.git /tmp/museum
#   ADMIN_EMAIL=glukhovas@yandex.ru bash /tmp/museum/deploy/install.sh
#
# Необязательно: DOMAIN=alsib-krsk.ru — если DNS уже настроен, HTTPS включится сразу.
# Без домена сайт откроется по http://IP_СЕРВЕРА, домен подключается позже
# командой deploy/certbot.sh. Повторный запуск безопасен: что сделано — пропускается.
set -euo pipefail

REPO="${REPO:-https://github.com/AntonSergeevich/school_museum.git}"
BRANCH="${BRANCH:-main}"
ADMIN_EMAIL="${ADMIN_EMAIL:-glukhovas@yandex.ru}"
DOMAIN="${DOMAIN:-}"
APP_USER=museum
ROOT=/srv/museum
export MUSEUM_ROOT="$ROOT" MUSEUM_USER="$APP_USER"

[ "$(id -u)" -eq 0 ] || { echo "Запускайте от root"; exit 1; }
say() { printf '\n=== %s ===\n' "$*"; }

# Обрыв SSH не должен убивать установку на середине: сигнал разрыва
# связи игнорируем, а весь вывод (включая секрет вебхука в конце) пишем
# в журнал — его можно дочитать после переподключения.
# tee -p: если терминала уже нет, tee продолжает писать в файл, а не падает.
LOG=/var/log/museum-install.log
trap '' HUP
exec > >(trap '' HUP; exec tee -p -a "$LOG") 2>&1
echo "=== $(date '+%F %T') Установка. Журнал: $LOG ==="

say "Пакеты"
export DEBIAN_FRONTEND=noninteractive
# needrestart после установки пакетов сам перезапускает службы, включая ssh —
# сессия, из которой идёт установка, при этом может оборваться.
export NEEDRESTART_MODE=l NEEDRESTART_SUSPEND=1
apt-get update -q
apt-get install -y -q python3-venv python3-dev build-essential libpq-dev postgresql nginx \
    certbot git rsync sqlite3 curl ufw openssl unzip rclone

say "Пользователь $APP_USER"
id "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 711 "$ROOT"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 /srv/backups /srv/backups/museum

say "Код"
if [ ! -d "$ROOT/.git" ]; then
    runuser -u "$APP_USER" -- env GIT_TERMINAL_PROMPT=0 git clone -q -b "$BRANCH" "$REPO" "$ROOT"
else
    echo "уже склонирован"
fi
# shellcheck source=deploy/lib.sh
source "$ROOT/deploy/lib.sh"
as_app git log --oneline -1

say "Окружение Python"
[ -x "$ROOT/.venv/bin/python" ] || as_app python3 -m venv .venv
as_app .venv/bin/pip install -q --upgrade pip
as_app .venv/bin/pip install -q -r requirements.txt

say "База данных PostgreSQL"
if [ ! -f "$ROOT/.env" ] || [ -z "$(env_value POSTGRES_PASSWORD)" ]; then
    DB_PASSWORD="$(openssl rand -hex 24)"
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='museum'" | grep -q 1; then
        sudo -u postgres psql -q -c "ALTER USER museum WITH PASSWORD '$DB_PASSWORD';"
    else
        sudo -u postgres psql -q -c "CREATE USER museum WITH PASSWORD '$DB_PASSWORD';"
    fi
else
    DB_PASSWORD="$(env_value POSTGRES_PASSWORD)"
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='museum'" | grep -q 1 \
    || sudo -u postgres createdb -O museum museum
# Отдельными командами, без «\c» внутри psql: при вставке блока «\c» склеивается
# со следующей строкой. Права на схему обязательны с PostgreSQL 15.
sudo -u postgres psql -q -d museum -c "ALTER DATABASE museum OWNER TO museum;"
sudo -u postgres psql -q -d museum -c "GRANT ALL ON SCHEMA public TO museum;"
sudo -u postgres psql -q -d museum -c "ALTER ROLE museum SET timezone TO 'Asia/Krasnoyarsk';"
# Подключиться можно и без права создавать таблицы — проверяем именно его.
PGPASSWORD="$DB_PASSWORD" psql -h localhost -U museum -d museum -q \
    -c "CREATE TABLE install_probe(id int); DROP TABLE install_probe;"
echo "права на базу в порядке"

say "Настройки .env"
IP="$(server_ip)"
if [ ! -f "$ROOT/.env" ]; then
    SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(64))')"
    cat > "$ROOT/.env" <<ENV
# Настройки сайта. Права 600: файл читает только пользователь $APP_USER.
# Правьте существующие строки, а не дописывайте вторые (sed -i 's|^КЛЮЧ=.*|КЛЮЧ=значение|' .env).
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=$SECRET
DJANGO_ALLOWED_HOSTS=$IP
DJANGO_CSRF_TRUSTED_ORIGINS=http://$IP
DJANGO_HTTPS=0
SITE_DOMAIN=
SITE_URL=http://$IP
DEPLOY_BRANCH=$BRANCH
ADMIN_EMAIL=$ADMIN_EMAIL

POSTGRES_DB=museum
POSTGRES_USER=museum
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_HOST=localhost

# Уведомления о заявках в MAX — см. DEPLOY.md, «Уведомления в MAX»
MAX_BOT_TOKEN=
MAX_USER_ID=
MAX_CHAT_ID=

# Почта — пароль ПРИЛОЖЕНИЯ Яндекса (Яндекс ID → Безопасность → Пароли приложений), не пароль от ящика
DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.yandex.ru
EMAIL_PORT=465
EMAIL_USE_SSL=1
EMAIL_HOST_USER=$ADMIN_EMAIL
EMAIL_HOST_PASSWORD=
DEFAULT_FROM_EMAIL=$ADMIN_EMAIL
MUSEUM_NOTIFY_EMAILS=$ADMIN_EMAIL
ENV
    echo "создан $ROOT/.env"
else
    echo "уже есть, не трогаю"
fi
fix_permissions

say "Миграции и статика"
as_app .venv/bin/python manage.py migrate --noinput
as_app .venv/bin/python manage.py collectstatic --noinput -v0
as_app sh -c "git rev-parse HEAD > VERSION"
fix_permissions

say "Служба сайта"
install -m 644 "$ROOT/deploy/museum.service" /etc/systemd/system/museum.service
systemctl daemon-reload
systemctl enable -q --now museum
systemctl restart museum

say "nginx"
mkdir -p /var/www/certbot
render_nginx > "$NGINX_SITE"
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/museum
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
echo "сайт отвечает: $("$ROOT/deploy/probe.sh")"

say "Брандмауэр"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status

say "Резервные копии"
crontab -u "$APP_USER" "$ROOT/deploy/crontab"
as_app "$ROOT/deploy/backup.sh"

say "Автодеплой"
if [ ! -f /etc/museum-deploy-webhook.env ]; then
    printf 'DEPLOY_WEBHOOK_SECRET=%s\nDEPLOY_BRANCH=%s\n' "$(openssl rand -hex 32)" "$BRANCH" > /etc/museum-deploy-webhook.env
    chmod 600 /etc/museum-deploy-webhook.env
fi
touch /var/log/museum-deploy.log
install -m 644 "$ROOT/deploy/museum-deploy-webhook.service" /etc/systemd/system/museum-deploy-webhook.service
systemctl daemon-reload
systemctl enable -q --now museum-deploy-webhook
WEBHOOK_SECRET="$(sed -n 's/^DEPLOY_WEBHOOK_SECRET=//p' /etc/museum-deploy-webhook.env)"

if [ -n "$DOMAIN" ]; then
    say "Домен и HTTPS"
    EMAIL="$ADMIN_EMAIL" bash "$ROOT/deploy/certbot.sh" "$DOMAIN" || echo "HTTPS не включён — повторите позже: sudo bash $ROOT/deploy/certbot.sh $DOMAIN"
fi

say "Готово"
SITE="$(env_value SITE_URL)"
cat <<DONE
Сайт: $SITE

Осталось три шага:

1) Администратор сайта:
   cd $ROOT && sudo -u $APP_USER .venv/bin/python manage.py createsuperuser

2) Автодеплой — GitHub → репозиторий → Settings → Webhooks → Add webhook:
   Payload URL:  $SITE/internal/deploy-webhook
   Content type: application/json
   Secret:       $WEBHOOK_SECRET
   Events:       Just the push event
   (секрет вставляется ОДНИМ значением, без «DEPLOY_WEBHOOK_SECRET=»)

3) Уведомления в MAX и пароль почты — DEPLOY.md, разделы «Уведомления в MAX» и «Почта».

Когда будет домен: sudo bash $ROOT/deploy/certbot.sh alsib-krsk.ru
Если что-то не так:  sudo bash $ROOT/deploy/health.sh
Весь вывод установки: $LOG
DONE
