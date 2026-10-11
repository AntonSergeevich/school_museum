from django.conf import settings


def museum_info(request):
    return {"MUSEUM": settings.MUSEUM}
