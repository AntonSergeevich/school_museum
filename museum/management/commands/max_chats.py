from django.core.management.base import BaseCommand, CommandError

from museum.notify import MaxError, max_request


class Command(BaseCommand):
    help = ("Показать, куда бот MAX может писать. Бот не может написать первым: "
            "сначала отправьте боту любое сообщение (или добавьте его в группу), затем запустите команду.")

    def handle(self, *args, **opts):
        try:
            updates = max_request("GET", "/updates", {"limit": 100, "timeout": 0})
        except MaxError as e:
            raise CommandError(str(e))
        seen = set()
        for upd in updates.get("updates", []):
            msg = upd.get("message") or {}
            sender = msg.get("sender") or upd.get("user") or {}
            chat_id = (msg.get("recipient") or {}).get("chat_id") or upd.get("chat_id")
            key = (sender.get("user_id"), chat_id)
            if key in seen:
                continue
            seen.add(key)
            self.stdout.write(f"{sender.get('name', '?')}: MAX_USER_ID={sender.get('user_id')}  MAX_CHAT_ID={chat_id}")
        try:
            for chat in max_request("GET", "/chats").get("chats", []):
                self.stdout.write(f"Группа «{chat.get('title')}»: MAX_CHAT_ID={chat.get('chat_id')}")
        except MaxError:
            pass
        if not seen:
            self.stdout.write("Сообщений нет. Напишите боту в MAX и запустите команду снова.")
