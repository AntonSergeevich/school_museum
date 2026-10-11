from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.urls import reverse
from django.utils.text import slugify

TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
})


def make_slug(text, model, instance_pk=None):
    base = slugify(text.lower().translate(TRANSLIT))[:70] or "item"
    slug, n = base, 2
    while model.objects.filter(slug=slug).exclude(pk=instance_pk).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


class SluggedModel(models.Model):
    slug = models.SlugField("Адрес (латиницей)", max_length=80, unique=True, blank=True,
                            help_text="Заполнится автоматически из названия")

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = make_slug(self.title, type(self), self.pk)
        super().save(*args, **kwargs)


class Hall(SluggedModel):
    """Раздел экспозиции. На сайте показывается как «рейс» на табло вылетов."""

    title = models.CharField("Название раздела", max_length=120)
    flight_code = models.CharField("Код рейса на табло", max_length=12, blank=True,
                                   help_text="Например, «АЛСИБ-42». Если пусто — сформируется автоматически")
    subtitle = models.CharField("Подзаголовок", max_length=200, blank=True)
    description = models.TextField("Описание", blank=True)
    cover = models.ImageField("Обложка", upload_to="halls/", blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)
    is_published = models.BooleanField("Опубликован", default=True)

    class Meta:
        verbose_name = "раздел экспозиции"
        verbose_name_plural = "разделы экспозиции"
        ordering = ["order", "title"]

    def __str__(self):
        return self.title

    @property
    def code(self):
        return self.flight_code or f"М-{149 + self.order:03d}"

    def get_absolute_url(self):
        return reverse("museum:hall", args=[self.slug])


class PublishedExhibits(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(is_published=True)


AIRCRAFT = [
    ("il62", "Ил-62"),
    ("tu154", "Ту-154"),
    ("an2", "Ан-2"),
    ("p39", "Р-39 «Аэрокобра»"),
]


class Exhibit(SluggedModel):
    title = models.CharField("Название экспоната", max_length=200)
    hall = models.ForeignKey(Hall, verbose_name="Раздел", on_delete=models.SET_NULL,
                             null=True, blank=True, related_name="exhibits")
    inventory_number = models.CharField("Инвентарный номер", max_length=40, blank=True)
    period = models.CharField("Время / год", max_length=60, blank=True, help_text="Например, «1942–1945» или «1970-е»")
    short = models.CharField("Кратко (для карточки)", max_length=280, blank=True)
    description = models.TextField("Подробное описание", blank=True)
    image = models.ImageField("Главное фото", upload_to="exhibits/", blank=True)
    provenance = models.CharField("Откуда поступил / даритель", max_length=255, blank=True)
    is_featured = models.BooleanField("Показывать на главной", default=False)
    sky_silhouette = models.CharField(
        "Летает в небе на главной", max_length=10, choices=AIRCRAFT, blank=True,
        help_text="Выберите силуэт — самолёт будет пролетать над первым экраном и вести на этот экспонат"
    )
    is_published = models.BooleanField("Опубликован", default=True)
    pd_consent = models.BooleanField(
        "Согласие на публикацию персональных данных получено", default=False,
        help_text="Отметьте, если в описании или на фото есть ФИО, фото или сведения о "
                  "конкретных людях (152-ФЗ, ст. 10.1). Для умерших — согласие наследников."
    )
    order = models.PositiveIntegerField("Порядок", default=0)
    created_at = models.DateTimeField("Добавлен", auto_now_add=True)
    updated_at = models.DateTimeField("Изменён", auto_now=True)

    objects = models.Manager()
    published = PublishedExhibits()

    class Meta:
        verbose_name = "экспонат"
        verbose_name_plural = "экспонаты"
        ordering = ["order", "-created_at"]

    def __str__(self):
        return self.title

    def get_absolute_url(self):
        return reverse("museum:exhibit", args=[self.slug])

    @property
    def ticket_no(self):
        return self.inventory_number or f"КП-{self.pk or 0:04d}"


class ExhibitImage(models.Model):
    exhibit = models.ForeignKey(Exhibit, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField("Фото", upload_to="exhibits/gallery/")
    caption = models.CharField("Подпись", max_length=200, blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)

    class Meta:
        verbose_name = "фото"
        verbose_name_plural = "дополнительные фото"
        ordering = ["order", "pk"]

    def __str__(self):
        return self.caption or f"Фото {self.pk}"


class Panorama(SluggedModel):
    """Сферическая панорама 360° (эквидистантная проекция, соотношение 2:1)."""

    title = models.CharField("Название точки обзора", max_length=120)
    hall = models.ForeignKey(Hall, verbose_name="Раздел", on_delete=models.SET_NULL,
                             null=True, blank=True, related_name="panoramas")
    image = models.ImageField("Панорама 360° (JPG, 2:1)", upload_to="panoramas/",
                              help_text="Рекомендуется 8000×4000 px, до 15 МБ. Снимается телефоном "
                                        "(Google Камера → Фотосфера) или камерой 360°.")
    is_start = models.BooleanField("Стартовая точка тура", default=False)
    initial_yaw = models.FloatField("Начальный поворот (yaw)", default=0,
                                    validators=[MinValueValidator(-180), MaxValueValidator(180)])
    initial_pitch = models.FloatField("Начальный наклон (pitch)", default=0,
                                      validators=[MinValueValidator(-90), MaxValueValidator(90)])
    order = models.PositiveIntegerField("Порядок", default=0)
    is_published = models.BooleanField("Опубликована", default=True)

    class Meta:
        verbose_name = "панорама 360°"
        verbose_name_plural = "панорамы 360° (виртуальный тур)"
        ordering = ["-is_start", "order", "title"]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_start:
            Panorama.objects.exclude(pk=self.pk).update(is_start=False)


class Hotspot(models.Model):
    KIND_SCENE = "scene"
    KIND_EXHIBIT = "exhibit"
    KIND_INFO = "info"
    KINDS = [
        (KIND_SCENE, "Переход к другой панораме"),
        (KIND_EXHIBIT, "Экспонат"),
        (KIND_INFO, "Подсказка-текст"),
    ]

    panorama = models.ForeignKey(Panorama, on_delete=models.CASCADE, related_name="hotspots")
    kind = models.CharField("Тип", max_length=10, choices=KINDS, default=KIND_EXHIBIT)
    pitch = models.FloatField("Наклон (pitch)", help_text="Включите «Режим разметки» в туре и кликните по панораме")
    yaw = models.FloatField("Поворот (yaw)")
    label = models.CharField("Подпись", max_length=120, blank=True)
    target_panorama = models.ForeignKey(Panorama, verbose_name="Куда перейти", on_delete=models.CASCADE,
                                        null=True, blank=True, related_name="incoming_hotspots")
    exhibit = models.ForeignKey(Exhibit, verbose_name="Экспонат", on_delete=models.CASCADE,
                                null=True, blank=True, related_name="hotspots")

    class Meta:
        verbose_name = "точка на панораме"
        verbose_name_plural = "точки на панораме"

    def __str__(self):
        return self.label or self.get_kind_display()


class TimelineEvent(models.Model):
    year = models.CharField("Год / период", max_length=20)
    title = models.CharField("Событие", max_length=200)
    text = models.TextField("Описание", blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)

    class Meta:
        verbose_name = "событие летописи"
        verbose_name_plural = "летопись авиации края"
        ordering = ["order", "year"]

    def __str__(self):
        return f"{self.year} — {self.title}"


class Document(models.Model):
    CATEGORIES = [
        ("museum", "Документы музея"),
        ("program", "Программы"),
        ("pd", "Персональные данные"),
        ("other", "Прочее"),
    ]
    title = models.CharField("Название", max_length=255)
    category = models.CharField("Категория", max_length=20, choices=CATEGORIES, default="museum")
    file = models.FileField("Файл (PDF)", upload_to="documents/")
    published_at = models.DateField("Дата размещения")
    order = models.PositiveIntegerField("Порядок", default=0)

    class Meta:
        verbose_name = "документ"
        verbose_name_plural = "документы"
        ordering = ["category", "order", "-published_at"]

    def __str__(self):
        return self.title


class ExcursionRequest(models.Model):
    STATUSES = [("new", "Новая"), ("confirmed", "Подтверждена"), ("done", "Проведена"), ("rejected", "Отклонена")]

    name = models.CharField("Контактное лицо", max_length=120)
    phone = models.CharField("Телефон", max_length=30)
    email = models.EmailField("E-mail", blank=True)
    group = models.CharField("Класс / организация", max_length=120, blank=True)
    people = models.PositiveIntegerField("Количество человек", default=1,
                                         validators=[MinValueValidator(1), MaxValueValidator(200)])
    desired_date = models.DateField("Желаемая дата", null=True, blank=True)
    message = models.TextField("Комментарий", blank=True)
    consent = models.BooleanField("Согласие на обработку ПДн")
    status = models.CharField("Статус", max_length=12, choices=STATUSES, default="new")
    created_at = models.DateTimeField("Создана", auto_now_add=True)

    class Meta:
        verbose_name = "заявка на экскурсию"
        verbose_name_plural = "заявки на экскурсии"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name}, {self.created_at:%d.%m.%Y}"
