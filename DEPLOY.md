# Установка на Beget VPS и автодеплой

Сервер: **141.133.192.56** (Beget VPS, Ubuntu 22.04/24.04). Домен: **alsib-krsk.ru**.

После установки всё обновляется само: `git push` в ветку `main` → GitHub стучится на сервер →
сервер забирает код, делает копию базы, применяет миграции, перезапускается и проверяет, что сайт
отвечает. Если новая версия не заработала, сервер **сам откатывается** на прошлую. Итог в любом
случае приходит сообщением в MAX.

---

## 0. Перед установкой (один раз)

**Ветка `main` на GitHub.** Сервер разворачивает именно её. Пока её нет, установка не пройдёт.

**Вход по ключу, а не по паролю.** На своём компьютере (PowerShell или терминал PyCharm):

```bash
ssh-keygen -t ed25519 -C "museum149"          # Enter на все вопросы
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@141.133.192.56 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
ssh root@141.133.192.56                       # теперь без пароля
```

На macOS/Linux вместо второй строки: `ssh-copy-id root@141.133.192.56`.

**Тариф.** Нужно от 2 ГБ памяти и **от 30 ГБ диска**: одни материалы музея занимают больше 2 ГБ,
а ещё нужно место под панорамы и под резервные копии. Если диск меньше, увеличьте его в панели Beget до установки.

## 1. Установка — одна команда

```bash
ssh root@141.133.192.56
git clone -b main https://github.com/AntonSergeevich/school_museum.git /tmp/museum
ADMIN_EMAIL=glukhovas@yandex.ru bash /tmp/museum/deploy/install.sh
```

Скрипт ставит пакеты, заводит пользователя `museum`, базу PostgreSQL (с правами на схему — без них
на PostgreSQL 15+ падают миграции), `.env` со сгенерированными ключами, службу, nginx, брандмауэр,
ночные копии и слушатель автодеплоя. Повторный запуск безопасен.

В конце он печатает **секрет вебхука** — он понадобится в шаге 3.

Проверка: откройте http://141.133.192.56 — должна открыться главная.

## 2. Администратор сайта

```bash
cd /srv/museum && sudo -u museum .venv/bin/python manage.py createsuperuser
```

Кабинет: http://141.133.192.56/cabinet/

## 3. Автодеплой: вебхук в GitHub

GitHub → репозиторий → **Settings → Webhooks → Add webhook**:

| Поле | Значение |
|---|---|
| Payload URL | `http://141.133.192.56/internal/deploy-webhook`, после подключения домена — `https://alsib-krsk.ru/internal/deploy-webhook` |
| Content type | `application/json` |
| Secret | секрет из вывода install.sh — **одним значением**, без `DEPLOY_WEBHOOK_SECRET=` |
| Events | Just the push event |

Сразу после сохранения GitHub шлёт проверочный `ping` — в списке доставок должна быть зелёная галочка.
Красная с 401 — секрет вставлен не тот (смотреть: `journalctl -u museum-deploy-webhook -n 20`).

Чтобы GitHub Actions после каждого пуша проверял, что новая версия дошла до сервера:
**Settings → Secrets and variables → Actions → Variables → New variable**: `SITE_URL` = `http://141.133.192.56`, после домена — `https://alsib-krsk.ru`.

## 4. Уведомления в MAX

1. В MAX найдите **@MasterBot** → `/newbot` → придумайте имя → получите **токен**.
   (Если MAX попросит подтвердить организацию — заявки пока приходят на почту, это не блокирует запуск.)
2. Напишите своему боту любое сообщение — бот не может написать первым.
3. На сервере:

```bash
cd /srv/museum
sudo -u museum nano .env              # MAX_BOT_TOKEN=токен
sudo -u museum .venv/bin/python manage.py max_chats    # покажет MAX_USER_ID=…
sudo -u museum nano .env              # MAX_USER_ID=число из вывода
sudo systemctl restart museum
sudo -u museum .venv/bin/python manage.py max_test     # в MAX придёт «Проверка связи»
```

Для группы (вы + управляющий музеем): создайте группу в MAX, добавьте бота, `max_chats` покажет
`MAX_CHAT_ID` — тогда сообщения пойдут в группу.

Что приходит в MAX: новые заявки на экскурсии, успешные выкатки, неудачные выкатки с откатом.

## 5. Почта

Яндекс ID → Безопасность → **Пароли приложений** → Почта → создать. В `.env`:

```bash
sudo -u museum sed -i 's|^EMAIL_HOST_PASSWORD=.*|EMAIL_HOST_PASSWORD=пароль-приложения|' /srv/museum/.env
sudo systemctl restart museum
sudo -u museum /srv/museum/.venv/bin/python /srv/museum/manage.py sendtestemail glukhovas@yandex.ru
```

Правится существующая строка, а не дописывается вторая (`sed -i 's|^КЛЮЧ=.*|…|'`).

## 6. Материалы музея с Google Диска

Самый быстрый путь — сразу с Диска на сервер, минуя свой компьютер (rclone уже установлен):

```bash
rclone config        # n → имя gdrive → тип drive → client_id/secret пустые → scope 1 → …
                     # «Use web browser?» → n: rclone даст команду для своего компьютера,
                     # там откроется вход в Google, результат вставить обратно
rclone copy "gdrive:Музей" /srv/import/Музей --progress
```

Или по-простому: скачать папку с Диска архивом, загрузить на сервер
(`scp Музей.zip root@141.133.192.56:/srv/import/` или WinSCP) и `unzip -d /srv/import Музей.zip`.

Импорт — сначала пробный, потом настоящий:

```bash
cd /srv/museum
sudo -u museum .venv/bin/python manage.py import_drive /srv/import/Музей --dry-run
sudo -u museum .venv/bin/python manage.py import_drive /srv/import/Музей
```

Карточки людей и документы появляются **скрытыми**. Управляющий проверяет их в кабинете, отмечает
«Публикация согласована» и публикует (в списке «Люди трассы» есть действие «Опубликовать»).
Сочинения учеников не импортируются: это данные детей, их публикуют только с согласия родителей.

## 7. Домен alsib-krsk.ru

1. **DNS.** Панель Beget → **DNS** → домен `alsib-krsk.ru`. Если домен зарегистрирован у другого регистратора, то же самое делается в его панели. Записи:

   | Имя | Тип | Значение |
   |---|---|---|
   | `@` (alsib-krsk.ru) | A | `141.133.192.56` |
   | `www` | A | `141.133.192.56` |

   Остальные A-записи для `@` и `www` (например, на «заглушку» регистратора) удалить. Иначе часть посетителей и проверка Let's Encrypt уйдут на чужой адрес.
2. Подождать DNS: от 15 минут до суток. Проверка с сервера: `getent ahostsv4 alsib-krsk.ru` должна показать `141.133.192.56`.
3. На сервере:

   ```bash
   sudo bash /srv/museum/deploy/certbot.sh alsib-krsk.ru
   ```

   Скрипт сам проверит DNS, выпустит сертификат, включит HTTPS и редиректы (http → https, www → без www), пропишет домен в `.env`.
   Если DNS ещё не обновился, скрипт скажет, куда сейчас указывает домен, и ничего не сломает. Повторите позже.
4. GitHub:
   - Settings → Webhooks → ваш вебхук → Payload URL: `https://alsib-krsk.ru/internal/deploy-webhook`;
   - Settings → Secrets and variables → Actions → Variables → `SITE_URL` = `https://alsib-krsk.ru`.

Если DNS готов ещё до установки, можно сразу: `DOMAIN=alsib-krsk.ru ADMIN_EMAIL=glukhovas@yandex.ru bash /tmp/museum/deploy/install.sh`.

## Повседневное

| Задача | Команда |
|---|---|
| Что с сайтом (вывод можно переслать разработчику) | `sudo bash /srv/museum/deploy/health.sh` |
| Журнал выкаток | `tail -50 /var/log/museum-deploy.log` |
| Выкатить руками | `sudo bash /srv/museum/deploy/update.sh` |
| Пересобрать ту же версию | `sudo FORCE=1 bash /srv/museum/deploy/update.sh` |
| Перезапуск | `sudo systemctl restart museum` |
| Журнал сайта | `journalctl -u museum -n 100 --no-pager` |

## Резервные копии

Каждую ночь в 03:30 — база и снимок фото в `/srv/backups/museum` (база 30 дней, фото 14 снимков;
неизменившиеся файлы снимки не дублируют). Перед каждой выкаткой — отдельная копия базы.

Копия на том же сервере не спасёт, если пропадёт сам сервер. Раз в месяц забирайте копию к себе:

```bash
scp -r root@141.133.192.56:/srv/backups/museum/db ./museum-backup-db
```

Восстановление базы: `gunzip -c /srv/backups/museum/db/db_ДАТА.sql.gz | sudo -u museum psql museum`.

## Если что-то сломалось

| Симптом | Причина и что делать |
|---|---|
| 502 Bad Gateway | Приложение не запущено: `journalctl -u museum -n 50` |
| 400 Bad Request | Адреса нет в `DJANGO_ALLOWED_HOSTS` в `.env` |
| CSRF verification failed | В `DJANGO_CSRF_TRUSTED_ORIGINS` нет адреса со схемой (`https://alsib-krsk.ru`) |
| Сайт без стилей / фото не открываются (403) | Права: `sudo bash -c 'source /srv/museum/deploy/lib.sh; fix_permissions'` |
| 413 при загрузке панорамы | Файл больше 64 МБ — уменьшите до 8192×4096 |
| 429 «Слишком много попыток» | Лимит на отправку форм (10 в минуту с адреса) — защита от ботов, сайт работает |
| Сайт не открывается у части людей по HTTPS | Фильтрация ТСПУ и TLS 1.3 — уже учтено: в конфиге только TLS 1.2 |
| Правка nginx не применилась | Нужен `systemctl restart nginx`, а не `reload` |
| Вебхук: 401 в доставках GitHub | Секрет вставлен не тот или с префиксом; `journalctl -u museum-deploy-webhook -n 20` |
| Вебхук: зелёный, а версия старая | `tail -50 /var/log/museum-deploy.log` — выкатка могла откатиться, причина там же |
| `SMTPSenderRefused` | Пустой `EMAIL_HOST_PASSWORD` или пароль от ящика вместо пароля приложения |

## Почему так устроено (ошибки прошлых проектов, которые здесь закрыты)

- **Код трогает владелец, а не root.** Git и pip под root создают файлы root-а, и следующая выкатка падает на правах.
- **`.env` не выполняется шеллом.** Значения вроде `Музей <m@ya.ru>` ломают `source .env`. При повторе ключа побеждает последняя строка — как у systemd.
- **Проверка сайта идёт с правильным Host.** Иначе Django отвечает 400, и рабочая выкатка считалась сломанной.
- **Сайт проверяется после выкатки.** «Служба запущена» ещё не значит «главная отвечает 200».
- **Скрипт выкатки выполняется из копии.** `git reset` подменяет файл, который bash в этот момент читает.
- **nginx 1.24:** `listen 443 ssl http2` вместо `http2 on`. Нет `listen [::]`, который роняет nginx без IPv6.
- **Только TLS 1.2,** без `include options-ssl-nginx.conf`, после смены — `restart`.
- **Лимит частоты — только на POST:** открытие страниц не должно давать «сайт лёг».
- **Вебхук отдельным процессом от root** с проверкой подписи; путь есть и в HTTP-, и в HTTPS-блоке.
- **Git не спрашивает пароль** (`GIT_TERMINAL_PROMPT=0`): иначе автодеплой висел бы до таймаута.
