import datetime
import re

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
            "phone": forms.TextInput(attrs={"type": "tel", "inputmode": "tel", "autocomplete": "tel",
                                            "placeholder": "+7 (___) ___-__-__", "data-phone": ""}),
            "name": forms.TextInput(attrs={"autocomplete": "name"}),
            "email": forms.EmailInput(attrs={"autocomplete": "email"}),
        }

    def clean_phone(self):
        """Любая запись номера → «+7 (912) 345-67-89». Маска в браузере делает то же,
        но без JavaScript человек может написать «8 912 345 67 89» или «+7912…»."""
        raw = self.cleaned_data.get("phone", "")
        digits = re.sub(r"\D", "", raw)
        if raw.strip().startswith("+") and not digits.startswith("7"):
            if 10 <= len(digits) <= 15:            # иностранный номер — сохраняем как есть
                return "+" + digits
            raise forms.ValidationError("Проверьте номер: в нём должно быть от 10 до 15 цифр.")
        if len(digits) == 11 and digits[0] in "78":
            digits = digits[1:]
        if len(digits) != 10:
            raise forms.ValidationError("Введите номер полностью: +7 (XXX) XXX-XX-XX.")
        return f"+7 ({digits[:3]}) {digits[3:6]}-{digits[6:8]}-{digits[8:]}"

    def clean_desired_date(self):
        d = self.cleaned_data.get("desired_date")
        if d and d < datetime.date.today():
            raise forms.ValidationError("Дата не может быть в прошлом.")
        return d

    def clean_website(self):
        if self.cleaned_data.get("website"):
            raise forms.ValidationError("spam")
        return ""
