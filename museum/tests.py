import datetime

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import ExcursionRequest, Exhibit, Hall


@override_settings(MEDIA_ROOT="/tmp/museum-test-media")
class SiteTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", verbosity=0)

    def test_pages_open(self):
        ex = Exhibit.published.first()
        hall = Hall.objects.first()
        for url in ["/", "/tour/", "/exhibits/", "/about/", "/visit/", "/documents/", "/privacy/",
                    "/consent/", "/accessibility/", "/sitemap.xml", "/robots.txt",
                    ex.get_absolute_url(), hall.get_absolute_url(), "/exhibits/?q=Ил&hall=" + hall.slug]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_unpublished_exhibit_hidden(self):
        ex = Exhibit.objects.first()
        ex.is_published = False
        ex.save()
        self.assertEqual(self.client.get(ex.get_absolute_url()).status_code, 404)

    def test_fleet_uses_exhibits(self):
        resp = self.client.get("/")
        self.assertContains(resp, 'href="%s"' % Exhibit.objects.get(sky_silhouette="il62").get_absolute_url())

    def test_slug_transliterated(self):
        self.assertEqual(Hall.objects.create(title="Новый зал").slug, "novyy-zal")

    def test_excursion_requires_consent(self):
        data = {"name": "Иванова А. А.", "phone": "+79990000000", "people": 25,
                "desired_date": (datetime.date.today() + datetime.timedelta(days=3)).isoformat()}
        self.client.post(reverse("museum:visit"), data)
        self.assertEqual(ExcursionRequest.objects.count(), 0)
        resp = self.client.post(reverse("museum:visit"), {**data, "consent": "on"})
        self.assertRedirects(resp, reverse("museum:visit"))
        self.assertEqual(ExcursionRequest.objects.count(), 1)

    def test_honeypot(self):
        self.client.post(reverse("museum:visit"), {"name": "bot", "phone": "1", "people": 1,
                                                   "consent": "on", "website": "spam"})
        self.assertEqual(ExcursionRequest.objects.count(), 0)

    def test_markup_mode_only_for_staff(self):
        self.assertNotContains(self.client.get("/tour/?markup=1"), "Режим разметки")
        User.objects.create_superuser("adm", "a@a.ru", "pass-12345-x")
        self.client.login(username="adm", password="pass-12345-x")
        self.assertContains(self.client.get("/tour/?markup=1"), "Режим разметки")

    def test_admin_pages(self):
        User.objects.create_superuser("adm", "a@a.ru", "pass-12345-x")
        self.client.login(username="adm", password="pass-12345-x")
        for m in ["exhibit", "hall", "panorama", "excursionrequest", "document", "timelineevent"]:
            with self.subTest(m=m):
                self.assertEqual(self.client.get(f"/cabinet/museum/{m}/").status_code, 200)
                self.assertEqual(self.client.get(f"/cabinet/museum/{m}/add/").status_code, 200)
