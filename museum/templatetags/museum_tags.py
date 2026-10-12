from django import template

register = template.Library()


@register.filter
def ru_plural(n, forms):
    """{{ n|ru_plural:"имя,имени,имён" }} → «1 имя», «2 имени», «5 имён»."""
    one, few, many = forms.split(",")
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many
