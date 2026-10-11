# Как открыть проект в PyCharm

Подходит и бесплатная Community-редакция, и Professional.

## 1. Получить код

**File → New → Project from Version Control…**

- URL: `https://github.com/AntonSergeevich/school_museum.git`
- Directory: например, `C:\Projects\school_museum`
- **Clone**

Если PyCharm спросит про доверие проекту — **Trust Project**.

Ветка: внизу справа (или вверху слева в новом интерфейсе) значок ветки → `origin/main` → **Checkout**.

## 2. Интерпретатор Python

Нужен Python 3.11 или новее (https://www.python.org/downloads/ — при установке отметить «Add to PATH»).

**File → Settings → Project: school_museum → Python Interpreter → Add Interpreter → Add Local Interpreter →
Virtualenv Environment → New**, расположение `.venv` в папке проекта → **OK**.

Затем внизу **Terminal** (Alt+F12) — он уже работает внутри `.venv`:

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo          # демо-данные, чтобы было что смотреть
python manage.py createsuperuser
```

## 3. Запуск одной кнопкой

**Run → Edit Configurations… → + → Python**

| Поле | Значение |
|---|---|
| Name | `Сайт` |
| Script / module | script: `manage.py` |
| Script parameters | `runserver` |
| Working directory | папка проекта |
| Python interpreter | `.venv` проекта |

**OK**, затем зелёный треугольник (Shift+F10). Сайт — http://127.0.0.1:8000, кабинет — http://127.0.0.1:8000/cabinet/

Вторая конфигурация, для тестов: тот же `manage.py`, параметры `test museum`.

В PyCharm Professional можно включить **Settings → Languages & Frameworks → Django** (корень проекта,
settings: `config/settings.py`): появятся подсказки в шаблонах и готовая конфигурация Django Server.

## 4. Работа с изменениями

- **Commit** (Ctrl+K): отметить файлы, написать, что сделано, **Commit and Push**.
- **Pull** (Ctrl+T): забрать изменения, например сделанные мной.
- Пуш в `main` сам выкатывает сайт на сервер (см. DEPLOY.md). Итог придёт в MAX.

Никогда не коммитьте `.env`: там пароли. Он уже в `.gitignore`.

## 5. Сервер из PyCharm

**Терминал:** `ssh root@141.133.192.56` прямо во встроенном терминале.

**Файлы на сервере (Professional):** Tools → Deployment → Browse Remote Host → + → SFTP,
host `141.133.192.56`, user `root`, авторизация по ключу `~/.ssh/id_ed25519`. Удобно загрузить архив
с материалами в `/srv/import/`. Код на сервер так не кладите — он приезжает только через git.

## Частые вопросы

| Проблема | Решение |
|---|---|
| `python` не найден в терминале | Переустановить Python с галочкой «Add to PATH», перезапустить PyCharm |
| `No module named django` | Терминал открыт не в `.venv`: выбрать интерпретатор проекта (п. 2) и открыть новую вкладку терминала |
| Красные подчёркивания импортов | File → Invalidate Caches → Invalidate and Restart |
| `port 8000 is already in use` | Уже запущен другой сервер: остановить красным квадратом или `runserver 8001` |
