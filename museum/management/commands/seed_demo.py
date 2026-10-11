"""Демо-наполнение: python manage.py seed_demo

Создаёт разделы, экспонаты, летопись и две синтетические панорамы, чтобы
проверить дизайн до загрузки настоящих материалов. Повторный запуск безопасен.
Тексты экспонатов — заглушки, их нужно заменить реальными описаниями музея.
"""
import io
import math
import random

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image, ImageDraw, ImageFilter

from museum.models import Exhibit, Hall, Hotspot, Panorama, Person, TimelineEvent

DEMO_NOTE = "\n\nДемонстрационное описание — замените его в кабине администратора."

HALLS = [
    ("Красноярская воздушная трасса", "АЛСИБ-42", "Перегонка самолётов Аляска — Сибирь, 1942–1945"),
    ("Гражданская авиация края", "KJA-1980", "Аэропорты, авиалинии и самолёты Красноярского края"),
    ("Кабина Ил-62", "ИЛ-62", "Рабочее место экипажа дальнемагистрального лайнера"),
    ("Лётчики и экипажи", "ЭКИПАЖ", "Форма, документы и личные вещи авиаторов"),
    ("История музея", "М-2001", "Как создавался школьный музей"),
]

EXHIBITS = [
    ("Кабина самолёта Ил-62", "Кабина Ил-62", "1970-е", "il62",
     "Главный экспонат музея — кабина дальнемагистрального лайнера, установленная в школе."),
    ("Бортовой самописец Ту-154", "Гражданская авиация края", "1980-е", "tu154",
     "Устройство, записывающее параметры полёта. В народе — «чёрный ящик», хотя на деле он оранжевый."),
    ("Форма лётчика гражданской авиации", "Лётчики и экипажи", "1980-е", "",
     "Китель, фуражка и знаки различия пилота гражданской авиации."),
    ("Авиационные приборы", "Кабина Ил-62", "1960–1980-е", "",
     "Высотомер, указатель скорости, авиагоризонт — приборы, по которым экипаж ведёт самолёт."),
    ("Р-39 «Аэрокобра» на трассе АЛСИБ", "Красноярская воздушная трасса", "1942–1945", "p39",
     "Истребитель, который перегоняли по трассе Аляска — Сибирь в годы Великой Отечественной войны."),
    ("Ан-2 — труженик сибирского неба", "Гражданская авиация края", "с 1947", "an2",
     "Самолёт, который возил почту, грузы и пассажиров в самые отдалённые посёлки края."),
]

TIMELINE = [
    ("1942–1945", "Красноярская воздушная трасса",
     "По трассе Аляска — Сибирь (АЛСИБ) из Фэрбенкса в Красноярск перегоняли самолёты, поставлявшиеся по ленд-лизу."),
    ("1963", "Первый полёт Ил-62", "Первый советский дальнемагистральный реактивный пассажирский лайнер."),
    ("1968", "Первый полёт Ту-154", "Самолёт стал основой гражданской авиации страны на десятилетия."),
    ("1980", "Аэропорт Емельяново", "Открыт новый аэропорт Красноярска."),
    ("2001", "Основан школьный музей", "В школе № 149 создан музей истории авиации Красноярского края."),
]


PEOPLE = [
    ("Мазурук Илья Павлович", "генерал-майор, Герой Советского Союза", "7.07.1906",
     "С 1942 г. — начальник Красноярской воздушной трассы, с 1943 г. — командир 1-й перегоночной авиационной "
     "дивизии: руководил перегонкой самолётов с Аляски в Красноярск."),
    ("Шкляров Гавриил Самуилович", "младший техник-лейтенант (старший авиатехник)", "14.07.1924",
     "С декабря 1943 по август 1945 г. — старший авиатехник Красноярского аэропорта воздушной трассы "
     "«Красноярск — Уэлькаль»."),
]


def fake_panorama(seed, hue):
    """Синтетическая эквидистантная панорама 2:1: зал со стендами."""
    rnd = random.Random(seed)
    w, h = 4096, 2048
    img = Image.new("RGB", (w, h))
    px = ImageDraw.Draw(img)
    for y in range(h):  # потолок → стены → пол
        t = y / h
        if t < .38:
            c = (int(18 + 30 * t), int(24 + 40 * t), int(48 + 80 * t))
        elif t < .62:
            c = (int(hue[0] * .5 + 40), int(hue[1] * .5 + 40), int(hue[2] * .5 + 50))
        else:
            k = 1 - (t - .62)
            c = (int(70 * k + 20), int(55 * k + 18), int(40 * k + 14))
        px.line([(0, y), (w, y)], fill=c)
    for i in range(12):  # светильники
        x = i * w / 12 + w / 24
        px.ellipse([x - 40, 300, x + 40, 340], fill=(255, 236, 190))
    for i in range(8):  # стенды
        x0 = i * w / 8 + 60
        px.rectangle([x0, 820, x0 + w / 8 - 120, 1180], fill=(240, 236, 224), outline=(255, 176, 0), width=6)
        px.rectangle([x0 + 30, 860, x0 + w / 8 - 150, 1040], fill=tuple(rnd.randint(60, 160) for _ in range(3)))
        for j in range(4):
            px.line([(x0 + 30, 1070 + j * 24), (x0 + w / 8 - 150 - rnd.randint(0, 120), 1070 + j * 24)],
                    fill=(90, 100, 130), width=8)
    for i in range(0, w, 128):  # плитка пола
        px.line([(i, 1280), (i + (i - w / 2) * .6, h)], fill=(40, 30, 22), width=3)
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=82)
    return ContentFile(buf.getvalue())


class Command(BaseCommand):
    help = "Заполнить сайт демонстрационными данными"

    def handle(self, *args, **opts):
        halls = {}
        for i, (title, code, sub) in enumerate(HALLS):
            halls[title], _ = Hall.objects.get_or_create(
                title=title, defaults={"flight_code": code, "subtitle": sub, "order": i, "description": sub + "." + DEMO_NOTE})
        exhibits = {}
        for i, (title, hall, period, sky, short) in enumerate(EXHIBITS):
            exhibits[title], _ = Exhibit.objects.get_or_create(title=title, defaults={
                "hall": halls[hall], "period": period, "short": short, "description": short + DEMO_NOTE,
                "is_featured": True, "sky_silhouette": sky, "order": i, "inventory_number": f"КП-{101 + i}",
            })
        for i, (year, title, text) in enumerate(TIMELINE):
            TimelineEvent.objects.get_or_create(year=year, title=title, defaults={"text": text, "order": i})

        for name, rank, born, bio in PEOPLE:
            Person.objects.get_or_create(full_name=name, defaults={
                "rank": rank, "birth_date": born, "biography": bio + DEMO_NOTE, "is_published": True})

        if not Panorama.objects.exists():
            a = Panorama(title="Вход в музей (демо)", hall=halls["История музея"], is_start=True, order=0)
            a.image.save("demo-entrance.jpg", fake_panorama(1, (60, 80, 140)), save=False)
            a.save()
            b = Panorama(title="Зал кабины Ил-62 (демо)", hall=halls["Кабина Ил-62"], order=1)
            b.image.save("demo-il62.jpg", fake_panorama(2, (120, 90, 60)), save=False)
            b.save()
            Hotspot.objects.create(panorama=a, kind="scene", pitch=-5, yaw=90, target_panorama=b, label="В зал кабины Ил-62")
            Hotspot.objects.create(panorama=b, kind="scene", pitch=-5, yaw=-90, target_panorama=a, label="Назад ко входу")
            Hotspot.objects.create(panorama=a, kind="exhibit", pitch=2, yaw=0, exhibit=exhibits["Р-39 «Аэрокобра» на трассе АЛСИБ"])
            Hotspot.objects.create(panorama=b, kind="exhibit", pitch=2, yaw=22, exhibit=exhibits["Кабина самолёта Ил-62"])
            Hotspot.objects.create(panorama=b, kind="exhibit", pitch=2, yaw=67, exhibit=exhibits["Авиационные приборы"])
            Hotspot.objects.create(panorama=a, kind="info", pitch=20, yaw=-45, label="Перетащите, чтобы осмотреться")
        self.stdout.write(self.style.SUCCESS("Демо-данные готовы"))
