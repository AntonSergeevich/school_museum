"""Импорт материалов музея из папки, скачанной с Google Диска.

    python manage.py import_drive /srv/import/Музей --dry-run   # посмотреть, что будет
    python manage.py import_drive /srv/import/Музей             # импортировать

Как распознаётся содержимое:
* папка с .docx-биографией («Дата рождения… Боевой путь…») — карточка
  человека: ФИО из имени папки, портрет — картинка из папки (предпочтительно
  со словом «Портрет»), PDF — исходный документ;
* остальные папки — тема архива: каждый PDF становится документом
  в «Архивных материалах» с темой по имени папки.

По умолчанию всё импортируется СКРЫТЫМ: публикует управляющий музеем после
проверки. Флаг --publish — когда согласия на публикацию уже собраны: записи
сразу публикуются и отмечаются «Публикация согласована». Повторный запуск
с --publish публикует и то, что было импортировано скрытым раньше.

Повторный запуск не создаёт дублей; уже существующие записи не трогаются
(флаг --update перезапишет тексты, но не отметки о публикации).

Файлы Word вне карточек (например, сочинения учеников) по умолчанию
пропускаются: это данные детей. С флагом --include-docx они становятся
документами архива — только если есть согласие родителей.
"""
import datetime
import re
from contextlib import ExitStack
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError

from museum.models import Document, Person

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}
FIELDS = {
    "дата рождения": "birth_date",
    "место рождения": "birth_place",
    "звание": "rank",
    "должность": "rank",
    "награды": "awards",
}
BIO_HEADINGS = ("боевой путь", "биография", "жизненный путь")
KEY_VALUE = re.compile(r"^\s*([А-ЯЁа-яё][А-ЯЁа-яё \-]{2,40})\s*:\s*(.+)$")


def docx_paragraphs(path):
    import docx  # python-docx
    return [p.text.strip() for p in docx.Document(str(path)).paragraphs]


def parse_biography(paragraphs, full_name=""):
    """Разобрать биографию по шаблону музея. Возвращает словарь полей Person."""
    data = {"biography": ""}
    bio, in_bio, extra = [], False, []
    for text in paragraphs:
        if not text:
            continue
        if not in_bio and full_name and text.lower() == full_name.lower():
            continue
        low = text.lower().rstrip(":")
        if not in_bio and low in BIO_HEADINGS:
            in_bio = True
            continue
        m = KEY_VALUE.match(text) if not in_bio else None
        if m:
            key, value = m.group(1).strip().lower(), m.group(2).strip()
            field = FIELDS.get(key)
            if field and not data.get(field):
                data[field] = value[:200] if field != "awards" else value
                continue
            extra.append(text)
            continue
        if in_bio:
            bio.append(text)
        else:
            extra.append(text)
    data["biography"] = "\n\n".join(extra + bio)
    return data


def looks_like_person(folder):
    for d in folder.glob("*.docx"):
        if d.name.startswith("~$"):
            continue
        try:
            text = " ".join(docx_paragraphs(d)[:15]).lower()
        except Exception:
            continue
        if "дата рождения" in text or any(h in text for h in BIO_HEADINGS):
            return d
    return None


def pick_portrait(folder):
    images = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXT)
    for p in images:
        if "портрет" in p.name.lower():
            return p
    return images[0] if images else None


def clean_title(stem):
    title = re.sub(r"\s*\d{4}-\d{2}-\d{2}[ _]\d{2}_\d{2}_\d{2}$", "", stem)  # хвост «2025-05-30 12_14_09»
    title = re.sub(r"\s+", " ", title.replace("_", " ")).strip(" .")
    return title[:255] or stem


def docx_title(path):
    """Название для файла Word: первая строка текста, если она похожа на заголовок,
    иначе — имя файла («Мой_прадедушка_Гармашов…» → «Мой прадедушка Гармашов…»)."""
    try:
        first = next((p for p in docx_paragraphs(path) if p), "")
    except Exception:
        first = ""
    if 3 <= len(first) <= 120:
        return first.strip(" .")
    return clean_title(path.stem)


class Command(BaseCommand):
    help = "Импортировать людей трассы и архивные материалы из папки Google Диска"

    def add_arguments(self, parser):
        parser.add_argument("root", help="Путь к распакованной папке")
        parser.add_argument("--dry-run", action="store_true", help="Только показать, ничего не записывать")
        parser.add_argument("--update", action="store_true", help="Обновить тексты уже импортированных людей")
        parser.add_argument("--group", default="Люди трассы АлСиб", help="Раздел для карточек людей")
        parser.add_argument("--publish", action="store_true",
                            help="Сразу опубликовать (согласия на публикацию получены)")
        parser.add_argument("--include-docx", action="store_true",
                            help="Импортировать файлы Word вне карточек (сочинения) как документы архива")

    def handle(self, root, dry_run, update, group, publish=False, include_docx=False, **opts):
        self.publish = publish
        root = Path(root)
        if not root.is_dir():
            raise CommandError(f"Нет такой папки: {root}")
        stats = {"people_new": 0, "people_upd": 0, "people_skip": 0, "docs_new": 0, "docs_skip": 0, "ignored": 0}
        today = datetime.date.today()

        for folder in sorted(p for p in root.rglob("*") if p.is_dir()) + [root]:
            bio_doc = looks_like_person(folder)
            if bio_doc:
                self.import_person(folder, bio_doc, group, dry_run, update, stats)
                continue
            files = sorted(f for f in folder.iterdir() if f.is_file())
            pdfs = [f for f in files if f.suffix.lower() == ".pdf"]
            cleaned = [clean_title(f.stem) for f in pdfs]
            for f, title in zip(pdfs, cleaned):
                # Два файла, отличающиеся только датой выгрузки, не должны слиться в один.
                if cleaned.count(title) > 1:
                    title = clean_title(f.stem.replace("_", ":"))
                self.import_document(f, title, folder, root, today, dry_run, stats)
            for f in files:
                if f.suffix.lower() in {".docx", ".doc"} and not f.name.startswith("~$"):
                    if include_docx:
                        self.import_document(f, docx_title(f), folder, root, today, dry_run, stats)
                    else:
                        stats["ignored"] += 1
                        self.stdout.write(f"  пропущен (не биография; --include-docx, чтобы импортировать): "
                                          f"{f.relative_to(root)}")

        self.stdout.write(self.style.SUCCESS(
            ("ПРОБНЫЙ ЗАПУСК — ничего не записано. " if dry_run else "") +
            f"Люди: новых {stats['people_new']}, обновлено {stats['people_upd']}, уже были {stats['people_skip']}. "
            f"Документы: новых {stats['docs_new']}, уже были {stats['docs_skip']}. "
            f"Пропущено файлов Word: {stats['ignored']}."))
        if not dry_run and publish:
            self.stdout.write("Всё опубликовано: /people/ и /documents/ на сайте.")
        elif not dry_run and (stats["people_new"] or stats["docs_new"]):
            self.stdout.write("Всё импортировано скрытым. Проверьте и опубликуйте в кабинете "
                              "или запустите команду ещё раз с --publish.")

    def import_person(self, folder, bio_doc, group, dry_run, update, stats):
        name = re.sub(r"\s+", " ", folder.name).strip()
        existing = Person.objects.filter(full_name=name).first()
        if existing and not update:
            if self.publish and not dry_run and not existing.is_published:
                existing.is_published = existing.publication_checked = True
                existing.save(update_fields=["is_published", "publication_checked"])
            stats["people_skip"] += 1
            return
        data = parse_biography(docx_paragraphs(bio_doc), name)
        portrait = pick_portrait(folder)
        pdf = next(iter(sorted(folder.glob("*.pdf"))), None)
        self.stdout.write(f"  {'обновить' if existing else 'человек'}: {name}"
                          f"{' + портрет' if portrait else ''}{' + PDF' if pdf else ''}")
        if dry_run:
            stats["people_upd" if existing else "people_new"] += 1
            return
        person = existing or Person(full_name=name, group=group)
        for k, v in data.items():
            setattr(person, k, v)
        if self.publish:
            person.is_published = person.publication_checked = True
        # Файлы отдаются модели несохранёнными: тогда портрет при сохранении
        # пройдёт сжатие и очистку метаданных, как и загруженный через кабинет.
        with ExitStack() as stack:
            if portrait and (not person.portrait or update):
                person.portrait = File(stack.enter_context(portrait.open("rb")), name=portrait.name)
            if pdf and (not person.source_file or update):
                person.source_file = File(stack.enter_context(pdf.open("rb")), name=pdf.name)
            person.save()
        stats["people_upd" if existing else "people_new"] += 1

    def import_document(self, f, title, folder, root, today, dry_run, stats):
        topic = folder.name if folder != root else ""
        existing = Document.objects.filter(title=title, topic=topic).first()
        if existing:
            if self.publish and not dry_run and not existing.is_published:
                existing.is_published = True
                existing.save(update_fields=["is_published"])
            stats["docs_skip"] += 1
            return
        self.stdout.write(f"  документ: [{topic or 'без темы'}] {title}")
        stats["docs_new"] += 1
        if dry_run:
            return
        doc = Document(title=title, topic=topic, category="archive", published_at=today,
                       is_published=self.publish)
        with f.open("rb") as fh:
            doc.file.save(f.name, File(fh), save=False)
        doc.save()
