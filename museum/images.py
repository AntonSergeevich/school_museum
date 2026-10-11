"""Обработка загружаемых изображений.

Фото с телефона весит 5–10 МБ и хранит в EXIF координаты съёмки (GPS).
На сайт должно попадать уменьшенное изображение без метаданных: так
страницы грузятся быстрее, диск сервера не забивается, а место съёмки
не утекает в интернет. Делается это один раз, при загрузке.
"""
import io
from pathlib import Path

from django.core.files.base import ContentFile
from PIL import Image, ImageOps

# Панорамы 360° законно бывают по 100+ мегапикселей.
Image.MAX_IMAGE_PIXELS = 400_000_000


def normalize(field_file, max_side, quality=85):
    """Привести файл к JPEG не больше max_side по длинной стороне, без EXIF."""
    if not field_file or getattr(field_file, "_committed", True):
        return  # ничего нового не загружали
    field_file.seek(0)
    img = Image.open(field_file)
    img = ImageOps.exif_transpose(img)  # повернуть по EXIF до того, как его выбросим
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    name = Path(field_file.name).stem + ".jpg"
    field_file.save(name, ContentFile(buf.getvalue()), save=False)


class NormalizedImagesMixin:
    """IMAGE_LIMITS = {"имя_поля": максимальная сторона в пикселях}."""

    IMAGE_LIMITS = {}

    def save(self, *args, **kwargs):
        for field, limit in self.IMAGE_LIMITS.items():
            normalize(getattr(self, field), limit)
        super().save(*args, **kwargs)
