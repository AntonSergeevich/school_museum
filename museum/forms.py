import datetime

from django import forms

from .models import ExcursionRequest


class ExcursionRequestForm(forms.ModelForm):
    consent = forms.BooleanField(
        required=True,
        label="Я даю согласие на обработку моих персональных данных в соответствии с Политикой обработки ПДн",
        error_messages={"required": "Без согласия мы не можем принять заявку (152-ФЗ, ст. 9)."},
    )
    # Ловушка для ботов: людям поле не видно.
    website = forms.CharField(required=False, widget=forms.TextInput(attrs={"tabindex": "-1", "autocomplete": "off"}))

    class Meta:
        model = ExcursionRequest
        fields = ["name", "phone", "email", "group", "people", "desired_date", "message", "consent"]
        widgets = {
            "desired_date": forms.DateInput(attrs={"type": "date"}),
            "message": forms.Textarea(attrs={"rows": 3}),
            "phone": forms.TextInput(attrs={"type": "tel", "autocomplete": "tel", "placeholder": "+7 ..."}),
            "name": forms.TextInput(attrs={"autocomplete": "name"}),
            "email": forms.EmailInput(attrs={"autocomplete": "email"}),
        }

    def clean_desired_date(self):
        d = self.cleaned_data.get("desired_date")
        if d and d < datetime.date.today():
            raise forms.ValidationError("Дата не может быть в прошлом.")
        return d

    def clean_website(self):
        if self.cleaned_data.get("website"):
            raise forms.ValidationError("spam")
        return ""
