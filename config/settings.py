"""Настройки проекта «Виртуальный музей авиации школы № 149».

Все секреты и параметры окружения читаются из переменных окружения
(см. .env.example). Значения по умолчанию подходят только для разработки.
"""
import os
from pathlib import Path

from .envfile import load_env_file

BASE_DIR = Path(__file__).resolve().parent.parent
load_env_file(BASE_DIR / ".env", os.environ)


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).lower() in {"1", "true", "yes", "on"}


def env_list(name, default=""):
    return [x.strip() for x in os.environ.get(name, default).split(",") if x.strip()]


DEBUG = env_bool("DJANGO_DEBUG", True)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key-change-me")
if not DEBUG and SECRET_KEY.startswith("dev-only"):
    raise RuntimeError("Задайте DJANGO_SECRET_KEY для продакшена")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sitemaps",
    "museum",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "museum.context_processors.museum_info",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# По умолчанию SQLite; для продакшена — PostgreSQL на сервере в РФ (152-ФЗ, ст. 18 ч. 5).
if os.environ.get("POSTGRES_DB"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["POSTGRES_DB"],
            "USER": os.environ.get("POSTGRES_USER", ""),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
            "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ru-ru"
TIME_ZONE = "Asia/Krasnoyarsk"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("DJANGO_MEDIA_ROOT", BASE_DIR / "media"))

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
        if DEBUG
        else "whitenoise.storage.CompressedManifestStaticFilesStorage"
    },
}

# Панорамы бывают тяжёлыми — разрешаем загрузку до 60 МБ через админку.
DATA_UPLOAD_MAX_MEMORY_SIZE = 60 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
# Загруженные файлы раздаёт nginx (группа www-data): без явных прав они
# создаются 600 и на сайте вместо фото — 403.
FILE_UPLOAD_PERMISSIONS = 0o640
FILE_UPLOAD_DIRECTORY_PERMISSIONS = 0o750

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Безопасность (включается в продакшене).
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    # Пока нет сертификата (домен не выбран, сайт открывают по IP), HTTPS
    # включать нельзя: редирект вёл бы в никуда. install.sh включает его сам.
    HTTPS_ENABLED = env_bool("DJANGO_HTTPS", False)
    SECURE_SSL_REDIRECT = HTTPS_ENABLED
    SESSION_COOKIE_SECURE = HTTPS_ENABLED
    CSRF_COOKIE_SECURE = HTTPS_ENABLED
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30 if HTTPS_ENABLED else 0
    # HSTS только на сам домен и без preload-списка браузеров — сознательно:
    # домен ещё может смениться, а выйти из preload почти невозможно.
    SILENCED_SYSTEM_CHECKS = ["security.W005", "security.W021"]
    if not HTTPS_ENABLED:
        # Пока сайт работает по HTTP (домена ещё нет), эти предупреждения
        # check --deploy верны, но бесполезны и засоряют журнал выкатки.
        SILENCED_SYSTEM_CHECKS += ["security.W004", "security.W008", "security.W012", "security.W016"]

EMAIL_BACKEND = os.environ.get("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "465"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", True)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "museum@localhost")
MUSEUM_NOTIFY_EMAILS = env_list("MUSEUM_NOTIFY_EMAILS")

# Уведомления в мессенджер MAX. Токен — из раздела бота на платформе MAX,
# получатель — user_id администратора или chat_id группы (manage.py max_chats).
MAX_BOT_TOKEN = os.environ.get("MAX_BOT_TOKEN", "")
MAX_USER_ID = os.environ.get("MAX_USER_ID", "")
MAX_CHAT_ID = os.environ.get("MAX_CHAT_ID", "")
MAX_API_URL = os.environ.get("MAX_API_URL", "https://platform-api2.max.ru").rstrip("/")

SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {"museum": {"handlers": ["console"], "level": "INFO", "propagate": False}},
}

# Сведения о школе. Источник — открытые реестры и официальный сайт школы;
# перед запуском сверить с разделом «Сведения об образовательной организации».
MUSEUM = {
    "name": "Музей истории авиации Красноярского края",
    "name_dedication": "имени А. М. Маркирьева",
    "founded": 2001,
    "age_mark": "0+",
    "school_full": "Муниципальное автономное общеобразовательное учреждение «Средняя школа № 149»",
    "school_short": "МАОУ СШ № 149",
    "school_site": "https://sch149-krsk.gosuslugi.ru/",
    "school_info_url": "https://sch149-krsk.gosuslugi.ru/svedeniya-ob-obrazovatelnoy-organizatsii/osnovnye-svedeniya/",
    "founder": "Муниципальное образование город Красноярск (функции учредителя — главное управление образования администрации города Красноярска)",
    "address": "660077, Красноярский край, г. Красноярск, ул. Весны, зд. 9А",
    "phone": "+7 (391) 228-03-99",
    "email": "sch149@mailkrsk.ru",
    "director": "Шмаланд Александр Августович",
    "inn": "2465041660",
    "ogrn": "1022402478020",
    "pd_operator": "МАОУ СШ № 149",
}
