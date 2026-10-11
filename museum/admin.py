from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html

from .models import (Document, ExcursionRequest, Exhibit, ExhibitImage, Hall, Hotspot,
                     Panorama, TimelineEvent)

admin.site.site_header = "Кабинет музея истории авиации — школа № 149"
admin.site.site_title = "Кабинет музея"
admin.site.index_title = "Управление экспозицией"


def thumb(image, size=64):
    if not image:
        return "—"
    return format_html('<img src="{}" style="height:{}px;border-radius:6px;object-fit:cover">', image.url, size)


class ExhibitImageInline(admin.TabularInline):
    model = ExhibitImage
    extra = 1
    fields = ("preview", "image", "caption", "order")
    readonly_fields = ("preview",)

    @admin.display(description="Превью")
    def preview(self, obj):
        return thumb(obj.image)


@admin.register(Hall)
class HallAdmin(admin.ModelAdmin):
    list_display = ("title", "code", "order", "is_published", "exhibits_count")
    list_editable = ("order", "is_published")
    prepopulated_fields = {"slug": ("title",)}
    search_fields = ("title",)

    @admin.display(description="Экспонатов")
    def exhibits_count(self, obj):
        return obj.exhibits.count()


@admin.register(Exhibit)
class ExhibitAdmin(admin.ModelAdmin):
    list_display = ("preview", "title", "hall", "period", "is_featured", "is_published", "pd_consent", "updated_at")
    list_display_links = ("preview", "title")
    list_editable = ("is_featured", "is_published")
    list_filter = ("hall", "is_published", "is_featured", "pd_consent")
    search_fields = ("title", "inventory_number", "description", "provenance")
    prepopulated_fields = {"slug": ("title",)}
    inlines = [ExhibitImageInline]
    readonly_fields = ("preview_big", "view_on_site_link")
    save_on_top = True
    fieldsets = (
        (None, {"fields": ("title", "slug", "hall", "period", "inventory_number")}),
        ("Фото", {"fields": ("image", "preview_big")}),
        ("Описание", {"fields": ("short", "description", "provenance")}),
        ("Публикация", {"fields": ("is_published", "is_featured", "sky_silhouette", "order", "pd_consent", "view_on_site_link")}),
    )

    @admin.display(description="Фото")
    def preview(self, obj):
        return thumb(obj.image, 48)

    @admin.display(description="Превью")
    def preview_big(self, obj):
        return thumb(obj.image, 220)

    @admin.display(description="На сайте")
    def view_on_site_link(self, obj):
        if not obj.pk:
            return "—"
        return format_html('<a href="{}" target="_blank">Открыть страницу экспоната ↗</a>', obj.get_absolute_url())


class HotspotInline(admin.TabularInline):
    model = Hotspot
    fk_name = "panorama"
    extra = 1
    autocomplete_fields = ("exhibit",)


@admin.register(Panorama)
class PanoramaAdmin(admin.ModelAdmin):
    list_display = ("preview", "title", "hall", "is_start", "order", "is_published", "markup_link")
    list_display_links = ("preview", "title")
    list_editable = ("order", "is_published")
    prepopulated_fields = {"slug": ("title",)}
    inlines = [HotspotInline]

    @admin.display(description="Панорама")
    def preview(self, obj):
        return thumb(obj.image, 48)

    @admin.display(description="Разметка")
    def markup_link(self, obj):
        if not obj.pk:
            return "—"
        url = reverse("museum:tour") + f"?scene={obj.slug}&markup=1"
        return format_html('<a href="{}" target="_blank">Открыть режим разметки ↗</a>', url)


@admin.register(TimelineEvent)
class TimelineEventAdmin(admin.ModelAdmin):
    list_display = ("year", "title", "order")
    list_editable = ("order",)


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "category", "published_at", "order")
    list_filter = ("category",)


@admin.register(ExcursionRequest)
class ExcursionRequestAdmin(admin.ModelAdmin):
    list_display = ("created_at", "name", "group", "people", "desired_date", "phone", "status")
    list_filter = ("status", "desired_date")
    list_editable = ("status",)
    search_fields = ("name", "phone", "email", "group")
    readonly_fields = ("created_at", "consent")
    date_hierarchy = "created_at"
