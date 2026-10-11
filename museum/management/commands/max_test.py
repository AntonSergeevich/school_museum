from django.core.management.base import BaseCommand, CommandError

from museum.notify import MaxError, max_recipient, max_request


class Command(BaseCommand):
    help = "Проверить связь с MAX: отправить тестовое сообщение администратору"

    def handle(self, *args, **opts):
        recipient = max_recipient()
        if not recipient:
            raise CommandError("Задайте в .env MAX_USER_ID или MAX_CHAT_ID (узнать: manage.py max_chats)")
        try:
            me = max_request("GET", "/me")
            max_request("POST", "/messages", recipient,
                        {"text": "✈️ Проверка связи: сайт музея авиации школы № 149 на связи."})
        except MaxError as e:
            raise CommandError(str(e))
        self.stdout.write(self.style.SUCCESS(f"Отправлено от бота {me.get('name') or me.get('username') or ''} → {recipient}"))
