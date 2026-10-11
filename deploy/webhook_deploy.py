#!/usr/bin/env python3
"""Слушатель вебхука GitHub: пуш в рабочую ветку → запуск deploy/update.sh.

Отдельный процесс от root и НЕ часть сайта: сайт разбирает чужой ввод
(формы, загрузки) и прав root иметь не должен, а обновлению они нужны
(перезапуск служб). Здесь только проверка подписи и запуск одного
фиксированного скрипта, стандартная библиотека, всё видно в одном файле.
Слушает только 127.0.0.1 — наружу его пускает nginx одним путём.
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("DEPLOY_WEBHOOK_SECRET", "")
BRANCH = os.environ.get("DEPLOY_BRANCH", "main")
PORT = int(os.environ.get("DEPLOY_WEBHOOK_PORT", "8099"))
SCRIPT = os.environ.get("DEPLOY_SCRIPT", "/srv/museum/deploy/update.sh")
LOG = os.environ.get("DEPLOY_LOG", "/var/log/museum-deploy.log")

_running = None


def verify_signature(secret, body, header):
    """X-Hub-Signature-256. Сравнение постоянного времени: иначе подпись
    можно подбирать по скорости ответа."""
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256="):])


def should_deploy(event, payload, branch=BRANCH):
    if event == "ping":
        return False, "ping — GitHub проверяет вебхук, разворачивать нечего"
    if event != "push":
        return False, f"событие {event!r} — не push"
    if payload.get("deleted"):
        return False, "удаление ветки, а не пуш кода"
    if payload.get("ref") != f"refs/heads/{branch}":
        return False, f"ветка {payload.get('ref')!r}, а разворачиваем refs/heads/{branch}"
    return True, "разворачиваю"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

    def do_POST(self):  # noqa: N802
        global _running
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(min(length, 5_000_000)) if length else b""
        if not SECRET:
            return self.respond(503, "DEPLOY_WEBHOOK_SECRET не задан")
        signature = self.headers.get("X-Hub-Signature-256")
        if not verify_signature(SECRET, body, signature):
            # Причину — в журнал, сам секрет — никогда. Нет заголовка: в GitHub
            # не задан Secret. Есть, но не сходится: вставлено не то значение
            # (частая ошибка — вместе с префиксом «DEPLOY_WEBHOOK_SECRET=»).
            print(f"401: подпись {'есть, не сходится' if signature else 'ОТСУТСТВУЕТ'}, "
                  f"тело {len(body)} байт, секрет на сервере {len(SECRET)} символов", flush=True)
            return self.respond(401, "подпись не совпала")
        try:
            payload = json.loads(body or b"{}")
        except ValueError:
            return self.respond(400, "тело не JSON")
        ok, reason = should_deploy(self.headers.get("X-GitHub-Event"), payload)
        print(reason, flush=True)
        if not ok:
            return self.respond(200, reason)
        if _running is not None and _running.poll() is None:
            # Не копим очередь: update.sh берёт последний коммит ветки и так
            # заберёт всё, что накопилось.
            return self.respond(202, "деплой уже идёт, свежий коммит заберёт следующий запуск")
        log = open(LOG, "ab")
        _running = subprocess.Popen(["bash", SCRIPT], stdout=log, stderr=subprocess.STDOUT,
                                    start_new_session=True)
        return self.respond(202, "разворачиваю в фоне, журнал: " + LOG)

    def respond(self, code, message):
        data = json.dumps({"message": message}, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    if not SECRET:
        sys.exit("DEPLOY_WEBHOOK_SECRET не задан — слушатель не запускается")
    print(f"Жду вебхук на 127.0.0.1:{PORT}, ветка {BRANCH}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
