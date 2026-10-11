# Общая часть сервера: подключается из nginx-http.conf и nginx-https.conf.
# __ROOT__ подставляет render_nginx (deploy/lib.sh).

# Панорамы 360° весят до 60 МБ. По умолчанию nginx режет тело запроса
# на 1 МБ и отвечает 413 раньше, чем Django успеет объяснить причину.
client_max_body_size 64m;
client_body_timeout 120s;

location /static/ {
    alias __ROOT__/staticfiles/;
    access_log off;
    expires 30d;
    add_header Cache-Control "public";
}

location /media/ {
    alias __ROOT__/media/;
    expires 7d;
    add_header X-Content-Type-Options nosniff;
}

# Автодеплой: GitHub стучится сюда, слушатель на 127.0.0.1 проверяет подпись.
# Блок есть и в HTTP, и в HTTPS-сервере: GitHub не повторяет POST после
# редиректа, а когда-то этот путь жил только в одном из блоков и отвечал 404.
location = /internal/deploy-webhook {
    proxy_pass http://127.0.0.1:8099;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 30s;
}

# Лимит частоты — только на ОТПРАВКУ формы и вход в кабинет (POST).
# Открытие страниц не ограничиваем: раньше лимит считал просмотр страницы
# входа, и человек получал «сайт лёг» (503), хотя сайт работал.
location = /visit/ {
    limit_req zone=museum_post burst=5 nodelay;
    include /etc/nginx/proxy_params;
    proxy_pass http://unix:/run/museum/gunicorn.sock;
}
location = /cabinet/login/ {
    limit_req zone=museum_post burst=5 nodelay;
    include /etc/nginx/proxy_params;
    proxy_pass http://unix:/run/museum/gunicorn.sock;
}
limit_req_status 429;
error_page 429 /_429.html;
location = /_429.html {
    root __ROOT__/deploy;
    internal;
}

location / {
    include /etc/nginx/proxy_params;
    proxy_pass http://unix:/run/museum/gunicorn.sock;
    proxy_read_timeout 120s;
}
