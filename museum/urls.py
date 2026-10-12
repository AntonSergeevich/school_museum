from django.urls import path

from . import views

app_name = "museum"

urlpatterns = [
    path("", views.home, name="home"),
    path("tour/", views.tour, name="tour"),
    path("cockpit/", views.cockpit, name="cockpit"),
    path("exhibits/", views.exhibit_list, name="exhibits"),
    path("exhibits/<slug:slug>/", views.exhibit_detail, name="exhibit"),
    path("halls/<slug:slug>/", views.hall_detail, name="hall"),
    path("people/", views.people, name="people"),
    path("people/<slug:slug>/", views.person_detail, name="person"),
    path("about/", views.about, name="about"),
    path("visit/", views.visit, name="visit"),
    path("documents/", views.documents, name="documents"),
    path("privacy/", views.privacy, name="privacy"),
    path("consent/", views.consent, name="consent"),
    path("health/", views.health, name="health"),
    path("accessibility/", views.accessibility, name="accessibility"),
]
