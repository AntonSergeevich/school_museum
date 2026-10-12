import subprocess
from functools import lru_cache

from django.conf import settings
from django.contrib import messages
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.http import HttpResponsePermanentRedirect, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse

from .forms import ExcursionRequestForm
from .notify import notify_admin
from .models import AIRCRAFT, Document, Exhibit, Hall, Panorama, Person, TimelineEvent

def published_halls():
    return Hall.objects.filter(is_published=True).annotate(
        n=Count("exhibits", filter=Q(exhibits__is_published=True))
    )


def home(request):
    return render(request, "museum/home.html", {
        "halls": published_halls(),
        "featured": Exhibit.published.filter(is_featured=True).select_related("hall")[:6],
        "timeline": TimelineEvent.objects.all(),
        "exhibits_total": Exhibit.published.count(),
        "has_tour": Panorama.objects.filter(is_published=True).exists(),
        "fleet": fleet(),
        "people": Person.objects.filter(is_published=True).order_by("?")[:12],
        "people_total": Person.objects.filter(is_published=True).count(),
    })


def fleet():
    """Самолёты, пролетающие над первым экраном. Без настроенных — демо-эскадрилья."""
    flying = [
        {"kind": e.sky_silhouette, "label": e.title, "url": e.get_absolute_url()}
        for e in Exhibit.published.exclude(sky_silhouette="")[:8]
    ]
    if flying:
        return flying
    return [{"kind": k, "label": label, "url": ""} for k, label in AIRCRAFT]


def exhibit_list(request):
    qs = Exhibit.published.select_related("hall")
    q = request.GET.get("q", "").strip()
    hall_slug = request.GET.get("hall", "")
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(short__icontains=q) | Q(description__icontains=q))
    if hall_slug:
        qs = qs.filter(hall__slug=hall_slug)
    page = Paginator(qs, 12).get_page(request.GET.get("page"))
    return render(request, "museum/exhibit_list.html", {
        "page": page, "q": q, "hall_slug": hall_slug, "halls": published_halls(),
    })


def hall_detail(request, slug):
    hall = get_object_or_404(Hall, slug=slug, is_published=True)
    return render(request, "museum/hall_detail.html", {
        "hall": hall,
        "exhibits": hall.exhibits.filter(is_published=True),
        "panorama": hall.panoramas.filter(is_published=True).first(),
    })


def exhibit_detail(request, slug):
    exhibit = get_object_or_404(Exhibit.published.select_related("hall"), slug=slug)
    neighbours = Exhibit.published.filter(hall=exhibit.hall).exclude(pk=exhibit.pk)[:4] if exhibit.hall else []
    return render(request, "museum/exhibit_detail.html", {
        "exhibit": exhibit,
        "images": exhibit.images.all(),
        "neighbours": neighbours,
        "hotspot": exhibit.hotspots.select_related("panorama").filter(panorama__is_published=True).first(),
    })


def tour(request):
    panoramas = list(Panorama.objects.filter(is_published=True).prefetch_related(
        "hotspots__target_panorama", "hotspots__exhibit"))
    scenes = {}
    for p in panoramas:
        spots = []
        for h in p.hotspots.all():
            spot = {"pitch": h.pitch, "yaw": h.yaw, "text": h.label}
            if h.kind == h.KIND_SCENE and h.target_panorama and h.target_panorama.is_published:
                spot.update(type="scene", sceneId=h.target_panorama.slug,
                            text=h.label or f"Перейти: {h.target_panorama.title}")
            elif h.kind == h.KIND_EXHIBIT and h.exhibit and h.exhibit.is_published:
                spot.update(type="info", text=h.label or h.exhibit.title, URL=h.exhibit.get_absolute_url(),
                            cssClass="hs-exhibit",
                            exhibit={"title": h.exhibit.title, "short": h.exhibit.short,
                                     "image": h.exhibit.image.url if h.exhibit.image else "",
                                     "url": h.exhibit.get_absolute_url()})
            elif h.kind == h.KIND_INFO:
                spot.update(type="info")
            else:
                continue
            spots.append(spot)
        scenes[p.slug] = {
            "title": p.title, "panorama": p.image.url, "yaw": p.initial_yaw, "pitch": p.initial_pitch,
            "hotSpots": spots,
        }
    first = request.GET.get("scene")
    if first not in scenes:
        first = panoramas[0].slug if panoramas else None
    return render(request, "museum/tour.html", {
        "scenes": scenes, "first_scene": first, "panoramas": panoramas,
        "markup": request.GET.get("markup") == "1" and request.user.is_staff,
    })


def cockpit(request):
    """3D-кабина Ил-62: осмотр, интерактивные органы управления, имитация полёта."""
    return render(request, "museum/cockpit.html")


def about(request):
    return render(request, "museum/about.html", {"timeline": TimelineEvent.objects.all()})


def visit(request):
    form = ExcursionRequestForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        req = form.save()
        notify_admin(
            "✈️ Новая заявка на экскурсию",
            f"{req.name}, {req.phone}{', ' + req.email if req.email else ''}\n"
            f"{req.group or 'без класса'}, {req.people} чел., дата: {req.desired_date or 'не указана'}\n"
            f"{req.message}\n\n"
            f"{request.build_absolute_uri(reverse('admin:museum_excursionrequest_change', args=[req.pk]))}",
        )
        messages.success(request, "Заявка принята! Мы свяжемся с вами, чтобы согласовать время экскурсии.")
        return redirect("museum:visit")
    return render(request, "museum/visit.html", {"form": form})


def documents(request):
    return render(request, "museum/documents.html", {"documents": Document.objects.filter(is_published=True)})


def people(request):
    qs = Person.objects.filter(is_published=True)
    q = request.GET.get("q", "").strip()
    if q:
        qs = qs.filter(Q(full_name__icontains=q) | Q(rank__icontains=q) | Q(biography__icontains=q))
    letters = sorted({p.full_name[:1].upper() for p in Person.objects.filter(is_published=True).only("full_name")})
    letter = request.GET.get("letter", "")
    if letter:
        qs = qs.filter(full_name__istartswith=letter)
    return render(request, "museum/people.html", {"people": qs, "q": q, "letters": letters, "letter": letter})


def person_detail(request, slug):
    person = get_object_or_404(Person, slug=slug, is_published=True)
    return render(request, "museum/person_detail.html", {"person": person})


def privacy(request):
    return render(request, "museum/privacy.html")


def consent(request):
    return render(request, "museum/consent.html")


def accessibility(request):
    return render(request, "museum/accessibility.html")


@lru_cache(maxsize=1)
def code_version():
    """Версия кода: её сверяет проверка после автодеплоя (дошёл ли пуш до сервера)."""
    version_file = settings.BASE_DIR / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=settings.BASE_DIR, capture_output=True,
                              text=True, timeout=3).stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def health(request):
    from django.db import connection
    try:
        connection.ensure_connection()
        db = "ok"
    except Exception:
        db = "error"
    status = 200 if db == "ok" else 503
    return JsonResponse({"status": "ok" if status == 200 else "error", "db": db, "version": code_version()},
                        status=status)


def static_redirect(request, path):
    """Иконки, которые браузеры и боты просят из корня сайта (/favicon.ico).

    Адрес статики вычисляется при запросе, а не при импорте urls: при выкатке
    migrate импортирует urls раньше, чем collectstatic внесёт новый файл
    в манифест, и вычисление «заранее» роняло бы выкатку.
    """
    from django.templatetags.static import static
    return HttpResponsePermanentRedirect(static(path))
