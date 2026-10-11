import logging

from django.conf import settings
from django.contrib import messages
from django.core.mail import send_mail
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse

from .forms import ExcursionRequestForm
from .models import AIRCRAFT, Document, Exhibit, Hall, Panorama, TimelineEvent

log = logging.getLogger(__name__)


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


def about(request):
    return render(request, "museum/about.html", {"timeline": TimelineEvent.objects.all()})


def visit(request):
    form = ExcursionRequestForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        req = form.save()
        if settings.MUSEUM_NOTIFY_EMAILS:
            try:
                send_mail(
                    "Новая заявка на экскурсию в музей",
                    f"{req.name}, {req.phone}, {req.group}, {req.people} чел., дата: {req.desired_date or '—'}\n"
                    f"{request.build_absolute_uri(reverse('admin:museum_excursionrequest_change', args=[req.pk]))}",
                    settings.DEFAULT_FROM_EMAIL, settings.MUSEUM_NOTIFY_EMAILS, fail_silently=False,
                )
            except Exception:  # письмо — не критично, заявка уже сохранена
                log.exception("Не удалось отправить уведомление о заявке")
        messages.success(request, "Заявка принята! Мы свяжемся с вами, чтобы согласовать время экскурсии.")
        return redirect("museum:visit")
    return render(request, "museum/visit.html", {"form": form})


def documents(request):
    return render(request, "museum/documents.html", {"documents": Document.objects.all()})


def privacy(request):
    return render(request, "museum/privacy.html")


def consent(request):
    return render(request, "museum/consent.html")


def accessibility(request):
    return render(request, "museum/accessibility.html")
