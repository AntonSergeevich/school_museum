#!/usr/bin/env python3
"""Сообщение администратору в MAX из скриптов деплоя.

Только стандартная библиотека: скрипт должен работать, даже если выкатка
сломала окружение Python проекта. Настройки — из .env проекта.
    python3 deploy/notify_max.py "текст"
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from config.envfile import parse_env_file  # noqa: E402

env = parse_env_file(ROOT / ".env")
token = env.get("MAX_BOT_TOKEN")
recipient = {"chat_id": env["MAX_CHAT_ID"]} if env.get("MAX_CHAT_ID") else (
    {"user_id": env["MAX_USER_ID"]} if env.get("MAX_USER_ID") else None)
if not token or not recipient or len(sys.argv) < 2:
    sys.exit(0)
base = env.get("MAX_API_URL", "https://platform-api2.max.ru").rstrip("/")
req = urllib.request.Request(
    f"{base}/messages?{urllib.parse.urlencode(recipient)}",
    data=json.dumps({"text": sys.argv[1][:4000]}, ensure_ascii=False).encode(),
    headers={"Authorization": token, "Content-Type": "application/json"}, method="POST")
try:
    urllib.request.urlopen(req, timeout=10).read()
except Exception as e:  # уведомление не должно ронять деплой
    print(f"MAX: {e}", file=sys.stderr)
