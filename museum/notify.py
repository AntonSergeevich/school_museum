"""Уведомления администратору: мессенджер MAX и почта.

Заявка сохраняется в базу ДО уведомления, поэтому сбой MAX или почты
никогда не теряет её — администратор увидит её в кабинете в любом случае.
Без настроенного токена уведомления молча пропускаются.
"""
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.mail import send_mail

log = logging.getLogger("museum")


class MaxError(Exception):
    pass


def max_request(method, path, params=None, body=None, timeout=8):
    """Запрос к Bot API MAX. Токен — только в заголовке Authorization:
    передача через параметр запроса платформой больше не поддерживается."""
    if not settings.MAX_BOT_TOKEN:
        raise MaxError("MAX_BOT_TOKEN не задан")
    url = settings.MAX_API_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": settings.MAX_BOT_TOKEN,
        "Content-Type": "application/json; charset=utf-8",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise MaxError(f"MAX ответил {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise MaxError(f"MAX недоступен: {e}") from e
    return json.loads(raw or b"{}")


def max_recipient():
    if settings.MAX_CHAT_ID:
        return {"chat_id": settings.MAX_CHAT_ID}
    if settings.MAX_USER_ID:
        return {"user_id": settings.MAX_USER_ID}
    return None


def send_max(text):
    """Отправить сообщение. Возвращает True/False, исключений наружу не бросает."""
    recipient = max_recipient()
    if not settings.MAX_BOT_TOKEN or not recipient:
        return False
    try:
        max_request("POST", "/messages", recipient, {"text": text[:4000]})
        return True
    except MaxError:
        log.exception("Не удалось отправить уведомление в MAX")
        return False


def send_email(subject, text):
    if not settings.MUSEUM_NOTIFY_EMAILS:
        return False
    try:
        send_mail(subject, text, settings.DEFAULT_FROM_EMAIL, settings.MUSEUM_NOTIFY_EMAILS)
        return True
    except Exception:
        log.exception("Не удалось отправить письмо")
        return False


def notify_admin(subject, text):
    """MAX и почта — независимо: один канал не мешает другому."""
    sent_max = send_max(f"{subject}\n\n{text}")
    sent_mail = send_email(subject, text)
    return sent_max or sent_mail
