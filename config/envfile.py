"""Чтение .env без сторонних библиотек.

Правила совпадают с тем, как файл читает systemd (EnvironmentFile):
при повторе ключа побеждает ПОСЛЕДНЯЯ строка. Иначе служба и manage.py
в терминале видели бы разные значения — на этом уже обжигались.
Настоящие переменные окружения сильнее файла (setdefault).
Файл никогда не выполняется шеллом: в значениях бывают «<», «>» и «$».
"""
from pathlib import Path


def parse_env_file(path):
    values = {}
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return values
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, _, value = line.partition("=")
        key = key.strip()
        if not key.replace("_", "").isalnum():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def load_env_file(path, environ):
    for key, value in parse_env_file(path).items():
        environ.setdefault(key, value)
