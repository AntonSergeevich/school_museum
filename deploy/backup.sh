#!/usr/bin/env bash
# Резервная копия базы и загруженных файлов (фото, панорамы, документы).
#   ./deploy/backup.sh            — база + медиа (каждую ночь по cron)
#   ./deploy/backup.sh --db-only  — только база (перед каждой выкаткой)
#
# Медиа — это гигабайты, поэтому не архив каждую ночь, а «снимки» rsync:
# неизменившиеся файлы — жёсткие ссылки на прошлый снимок, место тратится
# только на новое. Хранятся 14 снимков медиа и 30 дней копий базы.
# Копия на том же сервере не спасает от потери сервера: раз в месяц
# скачивайте свежий снимок к себе (см. DEPLOY.md, «Резервные копии»).
set -euo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "$0")/lib.sh"

DEST="${BACKUP_DIR:-/srv/backups/museum}"
STAMP="$(date +%Y-%m-%d_%H-%M)"
mkdir -p "$DEST/db" "$DEST/media"

DB="$(env_value POSTGRES_DB)"
if [ -n "$DB" ]; then
    PGHOST="$(env_value POSTGRES_HOST)"
    PGPASSWORD="$(env_value POSTGRES_PASSWORD)" pg_dump -h "${PGHOST:-localhost}" \
        -U "$(env_value POSTGRES_USER)" "$DB" | gzip > "$DEST/db/db_$STAMP.sql.gz.part"
    mv "$DEST/db/db_$STAMP.sql.gz.part" "$DEST/db/db_$STAMP.sql.gz"
elif [ -f "$ROOT/db.sqlite3" ]; then
    sqlite3 "$ROOT/db.sqlite3" ".backup '$DEST/db/db_$STAMP.sqlite3'" 2>/dev/null \
        || cp "$ROOT/db.sqlite3" "$DEST/db/db_$STAMP.sqlite3"
fi
find "$DEST/db" -type f -mtime +30 -delete

if [ "${1:-}" != "--db-only" ] && [ -d "$ROOT/media" ]; then
    # Имена снимков — метки времени, поэтому сортировка ls безопасна.
    # shellcheck disable=SC2012
    LAST="$(ls -1d "$DEST"/media/20* 2>/dev/null | tail -1 || true)"
    rsync -a --delete ${LAST:+--link-dest="$LAST"} "$ROOT/media/" "$DEST/media/$STAMP/"
    # shellcheck disable=SC2012
    ls -1d "$DEST"/media/20* | head -n -14 | xargs -r rm -rf
fi
echo "✓ Копия $STAMP: $(du -sh "$DEST" | cut -f1) всего в $DEST"
