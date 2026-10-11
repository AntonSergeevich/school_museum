from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.sitemaps import GenericSitemap
from django.contrib.sitemaps.views import sitemap
from django.urls import include, path
from django.views.generic import TemplateView

from museum.models import Exhibit, Hall

sitemaps = {
    "exhibits": GenericSitemap({"queryset": Exhibit.published.all(), "date_field": "updated_at"}),
    "halls": GenericSitemap({"queryset": Hall.objects.filter(is_published=True)}),
}

urlpatterns = [
    path("cabinet/", admin.site.urls),
    path("sitemap.xml", sitemap, {"sitemaps": sitemaps}, name="sitemap"),
    path("robots.txt", TemplateView.as_view(template_name="robots.txt", content_type="text/plain")),
    path("", include("museum.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
