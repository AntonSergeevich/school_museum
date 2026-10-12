/* Музей истории авиации — интерактив. Без зависимостей.
 *
 * Устройство:
 *  • общая часть (меню, шапка, версия для слабовидящих, cookie) запускается один раз;
 *  • страничная часть — initPage(main): небо, самолёты, табло, приборы, поиск, форма.
 *    Она возвращает функцию уборки: при переходе без перезагрузки старые циклы
 *    анимации и обработчики снимаются, а для новой страницы initPage вызывается снова;
 *  • роутер перехватывает внутренние ссылки, грузит страницу fetch-ем и меняет <main>.
 *    Страницы со своими скриптами (тур 360°, 3D-кабина) открываются обычным переходом.
 */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var touch = window.matchMedia("(hover: none)").matches;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var a11yOn = function () { return root.dataset.a11y === "on"; };

  /* ================================================================ МЕНЮ */
  var burger = document.querySelector("[data-burger]");
  var nav = document.getElementById("nav");
  var header = document.querySelector(".site-header");
  function setMenu(open) {
    if (!nav) return;
    nav.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", open);
    burger.querySelector(".visually-hidden").textContent = open ? "Закрыть меню" : "Меню";
    document.body.classList.toggle("nav-open", open);
  }
  if (burger && nav) {
    burger.addEventListener("click", function () { setMenu(!nav.classList.contains("is-open")); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { setMenu(false); burger.focus(); }
    });
    window.matchMedia("(min-width: 1280px)").addEventListener("change", function (m) { if (m.matches) setMenu(false); });
  }

  /* Шапка уезжает при прокрутке вниз и возвращается при прокрутке вверх */
  if (header) {
    var lastHeaderY = window.scrollY;
    window.addEventListener("scroll", function () {
      var y = window.scrollY, menuOpen = nav && nav.classList.contains("is-open");
      if (Math.abs(y - lastHeaderY) < 6) return;
      header.classList.toggle("is-hidden", !menuOpen && y > lastHeaderY && y > 240);
      lastHeaderY = y;
    }, { passive: true });
    header.addEventListener("focusin", function () { header.classList.remove("is-hidden"); });
  }

  /* ==================================================== ВЕРСИЯ ДЛЯ СЛАБОВИДЯЩИХ */
  var panel = document.getElementById("a11y-panel");
  function a11ySave() {
    store.set("a11y", JSON.stringify({ font: root.dataset.a11yFont, scheme: root.dataset.a11yScheme, images: root.dataset.a11yImages }));
    markPressed();
  }
  function markPressed() {
    if (!panel) return;
    panel.querySelectorAll("button").forEach(function (b) {
      var k = Object.keys(b.dataset)[0];
      if (!k || k === "a11yOff") return;
      b.setAttribute("aria-pressed", root.dataset[k] === b.dataset[k]);
    });
  }
  if (panel) {
    if (a11yOn()) { panel.hidden = false; markPressed(); }
    document.querySelector("[data-a11y-toggle]").addEventListener("click", function () {
      if (!a11yOn()) {
        root.dataset.a11y = "on"; root.dataset.a11yFont = root.dataset.a11yFont || "2";
        root.dataset.a11yScheme = root.dataset.a11yScheme || "bw"; root.dataset.a11yImages = root.dataset.a11yImages || "on";
        a11ySave();
      }
      panel.hidden = false; panel.querySelector("button").focus();
    });
    panel.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if ("a11yOff" in b.dataset) {
        ["a11y", "a11yFont", "a11yScheme", "a11yImages"].forEach(function (k) { delete root.dataset[k]; });
        store.del("a11y"); panel.hidden = true; return;
      }
      ["a11yFont", "a11yScheme", "a11yImages"].forEach(function (k) { if (b.dataset[k]) root.dataset[k] = b.dataset[k]; });
      a11ySave();
    });
  }

  /* ============================================================== COOKIE */
  var cookie = document.getElementById("cookie");
  if (cookie && !store.get("cookie-ok")) {
    cookie.hidden = false;
    cookie.querySelector("[data-cookie-ok]").addEventListener("click", function () { store.set("cookie-ok", "1"); cookie.hidden = true; });
  }

  /* ========================================================== СТРАНИЦА */
  function initPage(scope) {
    var ctl = new AbortController(), sig = ctl.signal, alive = true;
    var on = function (el, ev, fn, opts) { el.addEventListener(ev, fn, Object.assign({ signal: sig }, opts || {})); };
    var observers = [];

    /* Появление при скролле */
    var reveals = scope.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window && !reduce) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -8% 0px" });
      reveals.forEach(function (el) { io.observe(el); });
      observers.push(io);
    } else reveals.forEach(function (el) { el.classList.add("is-in"); });

    /* Табло: перелистывание букв */
    var ABC = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789-";
    function flapify(el) {
      var text = el.dataset.flap; el.textContent = ""; el.setAttribute("aria-label", text);
      // Буквы собраны в слова: на узком экране строка переносится между словами, а не посреди слова
      var word = null;
      var cells = Array.from(text).map(function (ch) {
        var s = document.createElement("span"); s.className = "ch" + (ch === " " ? " sp" : "");
        s.textContent = ch === " " ? " " : ch; s.setAttribute("aria-hidden", "true");
        if (ch === " ") { word = null; el.appendChild(s); return s; }
        if (!word) { word = document.createElement("span"); word.className = "w"; el.appendChild(word); }
        word.appendChild(s); return s;
      });
      return function play() {
        cells.forEach(function (c, i) {
          var target = text[i]; if (target === " ") return;
          var n = 4 + Math.floor(Math.random() * 6) + Math.floor(i / 2);
          (function step() {
            if (!alive) return;
            if (n-- <= 0) { c.textContent = target; return; }
            c.textContent = ABC[Math.floor(Math.random() * ABC.length)];
            setTimeout(step, 45);
          })();
        });
      };
    }
    var flaps = scope.querySelectorAll("[data-flap]");
    if (flaps.length && !reduce) {
      var plays = Array.from(flaps).map(flapify);
      var fio = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { plays.forEach(function (p, i) { setTimeout(p, i * 60); }); fio.disconnect(); }
      }, { threshold: .3 });
      fio.observe(scope.querySelector(".board"));
      observers.push(fio);
    }

    /* Небо: звёзды и падающие звёзды */
    var hero = scope.querySelector(".hero");
    var heroVisible = true;
    if (hero && "IntersectionObserver" in window) {
      var hio = new IntersectionObserver(function (es) { heroVisible = es[0].isIntersecting; });
      hio.observe(hero); observers.push(hio);
    }
    var canvas = scope.querySelector("#sky");
    if (canvas && canvas.getContext) {
      var ctx = canvas.getContext("2d"), meteor = null, W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Звёзды хранятся в долях экрана: когда на телефоне прячется адресная строка и
      // окно меняет высоту, небо растягивается, а не рассыпается заново — раньше из-за
      // этого при прокрутке звёзды «прыгали».
      var stars = Array.from({ length: 420 }, function () {
        return { x: Math.random(), y: Math.random() * .85, r: Math.random() * 1.3 + .2, p: Math.random() * 6.28, s: .5 + Math.random() * 1.5, k: Math.random() };
      });
      var resize = function () {
        var w = canvas.clientWidth, h = canvas.clientHeight;
        if (w === W && Math.abs(h - H) < 2) return;
        W = w; H = h; canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (reduce) drawSky(0);
      };
      var drawSky = function (t) {
        ctx.clearRect(0, 0, W, H);
        var g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, "#040817"); g.addColorStop(.6, "#0b1638"); g.addColorStop(1, "#1d2550");
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        var density = Math.min(1, W * H / (2600 * 420));   // на узком экране — меньше звёзд
        stars.forEach(function (s) {
          if (s.k > density) return;
          ctx.globalAlpha = .35 + .65 * Math.abs(Math.sin(s.p + t / 1000 * s.s));
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.28); ctx.fill();
        });
        ctx.globalAlpha = 1;
        if (!meteor && Math.random() < .004) meteor = { x: Math.random() * W, y: Math.random() * H * .3, l: 0 };
        if (meteor) {
          meteor.l += 14; var x2 = meteor.x - meteor.l, y2 = meteor.y + meteor.l * .45;
          var mg = ctx.createLinearGradient(meteor.x - meteor.l + 120, meteor.y + (meteor.l - 120) * .45, x2, y2);
          mg.addColorStop(0, "rgba(255,255,255,0)"); mg.addColorStop(1, "rgba(255,255,255,.9)");
          ctx.strokeStyle = mg; ctx.lineWidth = 1.6; ctx.beginPath();
          ctx.moveTo(x2 + 120, y2 - 54); ctx.lineTo(x2, y2); ctx.stroke();
          if (meteor.l > W * .6) meteor = null;
        }
      };
      resize(); on(window, "resize", resize);
      if (reduce) drawSky(0);
      else (function loop(t) { if (!alive) return; if (heroVisible && !a11yOn()) drawSky(t); requestAnimationFrame(loop); })(0);
    }

    /* Эскадрилья: самолёты музея в небе */
    var fleetEl = scope.querySelector("#fleet");
    if (fleetEl && hero) {
      var planes = Array.from(fleetEl.querySelectorAll(".fleet__plane"));
      var mouseY = 0, boost = 1, last = 0;
      var rand = function (a, b) { return a + Math.random() * (b - a); };
      var setup = function (p, initial) {
        var hw = hero.clientWidth, hh = hero.clientHeight, small = hw < 700;
        p.depth = rand(.35, 1);
        p.w = (small ? 90 : 120) + p.depth * (small ? 110 : 200);
        p.left = Math.random() < .3;                         // часть самолётов летит навстречу
        p.speed = (30 + p.depth * 80) * (p.left ? -1 : 1);   // px/с — ближние быстрее
        p.y0 = rand(hh * .06, hh * (small ? .35 : .55));
        p.climb = rand(-.06, .02);                           // лёгкий набор высоты
        p.bob = rand(3, 9); p.phase = rand(0, 6.28);
        p.x = initial ? rand(-p.w, hw) : (p.left ? hw + rand(40, 400) : -p.w * 3.4 - rand(40, 600));
        p.el.style.setProperty("--w", p.w + "px");
        p.el.style.setProperty("--o", (.45 + p.depth * .55).toFixed(2));
        p.el.style.zIndex = Math.round(p.depth * 10);
        p.el.style.filter = p.depth < .55 ? "blur(1px) drop-shadow(0 0 8px rgba(160,200,255,.35))" : "";
        p.el.classList.toggle("is-left", p.left);
        p.el.classList.add("is-flying");
      };
      var held = null, holdTimer = 0;
      var release = function () {
        if (!held) return;
        held.paused = false; held.el.classList.remove("is-held", "is-near"); held = null;
        fleetEl.classList.remove("has-held");
      };
      planes = planes.map(function (el) {
        var p = { el: el, paused: false };
        on(el, "mouseenter", function () { if (!touch) p.paused = true; });
        on(el, "mouseleave", function () { if (!touch) p.paused = false; });
        // На телефоне наведения нет: первое касание останавливает самолёт и показывает
        // подпись, второе — открывает экспонат. Касание мимо — самолёт летит дальше.
        on(el, "click", function (e) {
          if (!touch) return;
          if (held !== p) {
            e.preventDefault(); e.stopPropagation();
            release();
            held = p; p.paused = true; el.classList.add("is-held", "is-near"); fleetEl.classList.add("has-held");
            clearTimeout(holdTimer); holdTimer = setTimeout(release, 6000);
          }
        });
        setup(p, true); return p;
      });
      on(hero, "click", function (e) { if (!e.target.closest(".fleet__plane")) release(); });
      var place = function (p, t) {
        var y = p.y0 + Math.sin(t / 900 + p.phase) * p.bob + p.x * p.climb + mouseY * 18 * p.depth;
        var tilt = Math.cos(t / 900 + p.phase) * 1.4 + p.climb * -40 * (p.left ? -1 : 1);
        p.el.style.transform = "translate3d(" + p.x.toFixed(1) + "px," + y.toFixed(1) + "px,0) rotate(" + tilt.toFixed(2) + "deg)";
      };
      on(hero, "pointermove", function (e) { if (e.pointerType === "mouse") mouseY = e.clientY / window.innerHeight - .5; });
      if (reduce) {
        planes.forEach(function (p, i) { p.x = hero.clientWidth * (.15 + .7 * i / Math.max(planes.length, 1)); place(p, 0); });
      } else {
        (function fly(t) {
          if (!alive) return;
          var dt = Math.min((t - last) / 1000, .05); last = t;
          if (heroVisible && !document.hidden && !a11yOn()) {
            var hw = hero.clientWidth;
            boost += ((1 + Math.min(window.scrollY / 250, 3)) - boost) * .05; // при прокрутке — «взлётный режим»
            planes.forEach(function (p) {
              if (!p.paused) p.x += p.speed * boost * dt;
              if ((!p.left && p.x > hw + 40) || (p.left && p.x < -p.w - 40)) setup(p, false);
              place(p, t);
            });
          }
          requestAnimationFrame(fly);
        })(0);
      }
      sig.addEventListener("abort", function () { clearTimeout(holdTimer); });
    }

    /* HUD и приборы */
    var alt = scope.querySelector("[data-altitude]");
    scope.querySelectorAll(".gauge__ticks").forEach(function (g) {
      for (var i = 0; i < 40; i++) {
        var a = (i / 40) * 360, major = i % 5 === 0, r1 = major ? 44 : 47;
        var l = document.createElementNS("http://www.w3.org/2000/svg", "line");
        var rad = (a - 90) * Math.PI / 180;
        l.setAttribute("x1", 60 + Math.cos(rad) * r1); l.setAttribute("y1", 60 + Math.sin(rad) * r1);
        l.setAttribute("x2", 60 + Math.cos(rad) * 51); l.setAttribute("y2", 60 + Math.sin(rad) * 51);
        if (major) l.setAttribute("class", "major"); g.appendChild(l);
      }
    });
    var speedG = scope.querySelector('[data-gauge="speed"]');
    var altG = scope.querySelector('[data-gauge="alt"]');
    var ball = scope.querySelector(".horizon__ball");
    var dash = scope.querySelector(".dash");
    var lastY = window.scrollY, roll = 0;
    function setGauge(g, deg, text) {
      g.querySelector(".gauge__needle").style.transform = "rotate(" + deg + "deg)";
      g.querySelector("[data-gauge-value]").textContent = text;
    }
    function onScroll() {
      var y = window.scrollY;
      if (alt) alt.textContent = Math.min(Math.round(y * 9 / 10) * 10, 10600).toLocaleString("ru-RU");
      if (dash) {
        var r = dash.getBoundingClientRect(), k = Math.max(0, Math.min(1, 1 - r.top / window.innerHeight));
        if (speedG) setGauge(speedG, k * 300, Math.round(k * 850) + " км/ч");
        if (altG) setGauge(altG, k * 330, Math.round(k * 11000).toLocaleString("ru-RU") + " м");
        roll = Math.max(-25, Math.min(25, (y - lastY) * 1.5));
        if (ball) ball.style.transform = "rotate(" + roll + "deg) translateY(" + (k * 14 - 7) + "px)";
      }
      lastY = y;
    }
    if (alt || dash) { on(window, "scroll", onScroll, { passive: true }); onScroll(); }

    /* Лайтбокс */
    var lb = scope.querySelector("#lightbox");
    if (lb && lb.showModal) {
      scope.querySelectorAll("[data-zoom]").forEach(function (b) {
        on(b, "click", function () { lb.querySelector("img").src = b.dataset.zoom; lb.showModal(); });
      });
      on(lb, "click", function () { lb.close(); });
    }

    /* Живой поиск: результаты обновляются по мере ввода, без перезагрузки */
    scope.querySelectorAll("form[data-live]").forEach(function (form) {
      var input = form.querySelector('input[type="search"]'), timer = 0, seq = 0;
      var update = function (url, push) {
        var my = ++seq;
        form.classList.add("is-loading");
        loadDoc(url).then(function (r) {
          if (my !== seq || !alive) return;             // пришёл ответ на устаревший запрос
          scope.querySelectorAll("[data-live-region]").forEach(function (el) {
            var fresh = r.doc.querySelector('[data-live-region="' + el.dataset.liveRegion + '"]');
            if (fresh) el.innerHTML = fresh.innerHTML;
          });
          history[push ? "pushState" : "replaceState"]({ y: window.scrollY }, "", r.url);
          form.classList.remove("is-loading");
        }).catch(function () { if (my === seq) location.href = url; });
      };
      var formUrl = function () {
        var params = new URLSearchParams(new FormData(form));
        Array.from(params.keys()).forEach(function (k) { if (!params.get(k)) params.delete(k); });
        var qs = params.toString();
        return location.pathname + (qs ? "?" + qs : "");
      };
      on(form, "submit", function (e) { e.preventDefault(); clearTimeout(timer); update(formUrl(), false); if (input && touch) input.blur(); });
      if (input) on(input, "input", function () { clearTimeout(timer); timer = setTimeout(function () { update(formUrl(), false); }, 280); });
      // буквы, разделы и страницы — тоже без перезагрузки
      on(form.closest("main") || form, "click", function (e) {
        var a = e.target.closest('[data-live-region] a[href^="?"], .pager a[href^="?"]');
        if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        var url = location.pathname + a.getAttribute("href");
        if (input && a.closest('[data-live-region="chips"]')) input.value = new URL(url, location.href).searchParams.get("q") || "";
        update(url, true);
        if (a.closest(".pager")) document.getElementById(form.getAttribute("aria-controls")).scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
      });
    });

    /* Маска телефона: +7 (912) 345-67-89 */
    scope.querySelectorAll("input[data-phone]").forEach(function (inp) { phoneMask(inp, on); });

    /* Форма заявки отправляется без перезагрузки */
    scope.querySelectorAll("form.boarding").forEach(function (form) {
      on(form, "submit", function (e) {
        e.preventDefault();
        var btn = form.querySelector('[type="submit"]');
        btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Отправляем…";
        fetch(form.action || location.href, { method: "POST", body: new FormData(form), credentials: "same-origin", headers: { "X-Requested-With": "fetch" } })
          .then(function (res) {
            if (res.status === 429) throw { busy: true };
            return res.text().then(function (html) { return { html: html, url: res.url }; });
          })
          .then(function (r) {
            var doc = new DOMParser().parseFromString(r.html, "text/html");
            return swapMain(doc, r.url, { push: false });
          })
          .then(function () {
            var target = document.querySelector(".flash, .field__error");
            if (target) target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
            var bad = document.querySelector(".field__error");
            if (bad) { var f = bad.closest(".field").querySelector("input, textarea, select"); if (f) f.focus({ preventScroll: true }); }
          })
          .catch(function (err) {
            btn.disabled = false; btn.textContent = btn.dataset.label;
            notice(err && err.busy ? "Слишком много попыток подряд. Подождите минуту и отправьте ещё раз." : "Нет связи с сервером. Проверьте интернет и попробуйте снова.", form);
          });
      });
    });

    return function cleanup() {
      alive = false; ctl.abort();
      observers.forEach(function (o) { o.disconnect(); });
    };
  }

  function notice(text, near) {
    var p = near.querySelector(".form-notice") || document.createElement("p");
    p.className = "flash flash--error form-notice"; p.setAttribute("role", "alert"); p.textContent = text;
    near.prepend(p);
  }

  /* ============================================================ ТЕЛЕФОН */
  function phoneMask(inp, on) {
    var PREFIX = "+7 (";
    // Цифры номера без кода страны (до 10). Понимает «8 912…», «+7 912…», «912…» и вставку.
    function localDigits(value) {
      var d = value.replace(/\D/g, "");
      if (value.trim().indexOf("+7") === 0) d = d.slice(1);
      else if (d.length > 10 && (d[0] === "7" || d[0] === "8")) d = d.slice(1);
      else if (d.length === 1 && (d === "7" || d === "8") && value.trim().length === 1) d = "";   // начали с «8» или «7» — это код страны
      if (d.length > 10 && (d[0] === "7" || d[0] === "8")) d = d.slice(1);                       // вставили «89…» в поле с «+7 (»
      return d.slice(0, 10);
    }
    function format(d) {
      if (!d) return "";
      var s = PREFIX + d.slice(0, 3);
      if (d.length >= 3) s += ") ";
      if (d.length > 3) s += d.slice(3, 6);
      if (d.length >= 6 && d.length > 6) s += "-" + d.slice(6, 8);
      if (d.length > 8) s += "-" + d.slice(8, 10);
      return s;
    }
    // позиция курсора: после n-й цифры номера
    function caretAfter(s, n) {
      if (n <= 0) return Math.min(s.length, PREFIX.length);
      var seen = 0;
      for (var i = PREFIX.length; i < s.length; i++) { if (/\d/.test(s[i]) && ++seen === n) return i + 1; }
      return s.length;
    }
    function apply(keepDigitsBefore) {
      var d = localDigits(inp.value), s = format(d);
      inp.value = s;
      if (document.activeElement === inp) { var c = caretAfter(s, keepDigitsBefore === undefined ? d.length : keepDigitsBefore); inp.setSelectionRange(c, c); }
      inp.setCustomValidity("");
    }
    function digitsBeforeCaret() {
      var pos = inp.selectionStart || 0, before = inp.value.slice(0, pos);
      var n = before.replace(/\D/g, "").length;
      if (inp.value.trim().indexOf("+7") === 0) n = Math.max(0, n - 1);
      return n;
    }
    on(inp, "focus", function () { if (!inp.value) { inp.value = PREFIX; requestAnimationFrame(function () { inp.setSelectionRange(PREFIX.length, PREFIX.length); }); } });
    on(inp, "blur", function () {
      if (!localDigits(inp.value)) inp.value = "";
      var n = localDigits(inp.value).length;
      inp.closest(".field") && inp.closest(".field").classList.toggle("is-incomplete", n > 0 && n < 10);
    });
    on(inp, "beforeinput", function (e) {
      // Backspace сразу за скобкой или дефисом стирает предыдущую цифру, а не символ маски
      if (e.inputType !== "deleteContentBackward" || inp.selectionStart !== inp.selectionEnd) return;
      var pos = inp.selectionStart;
      if (pos > 0 && !/\d/.test(inp.value[pos - 1])) {
        e.preventDefault();
        var n = digitsBeforeCaret(), d = localDigits(inp.value);
        if (n === 0) return;
        d = d.slice(0, n - 1) + d.slice(n);
        inp.value = format(d) || PREFIX;
        var c = caretAfter(inp.value, n - 1); inp.setSelectionRange(c, c);
      }
    });
    on(inp, "input", function () {
      var n = digitsBeforeCaret(), had = localDigits(inp.value).length;
      apply(Math.min(n, had));
      if (!inp.value && document.activeElement === inp) { inp.value = PREFIX; inp.setSelectionRange(PREFIX.length, PREFIX.length); }
    });
    if (inp.value) { var d0 = localDigits(inp.value); if (d0.length === 10) inp.value = format(d0); }
  }

  /* ============================================================== РОУТЕР */
  var main = document.getElementById("main");
  var ownScripts = function (doc) {
    // у страницы свои скрипты или стили (тур, 3D-кабина) — её нужно открывать обычным переходом
    return Array.from(doc.querySelectorAll("script[src], script[type=module], script[type=importmap], link[rel=stylesheet]")).some(function (s) {
      var u = s.getAttribute("src") || s.getAttribute("href") || "";
      return s.type === "importmap" || !/\/(main)(\.[0-9a-f]{12})?\.(js|css)$/.test(u);
    });
  };
  var routerOn = !!(window.fetch && window.DOMParser && history.pushState && main) && !ownScripts(document);
  var cleanupPage = initPage(document);
  var cache = new Map();

  function loadDoc(url) {
    var hit = cache.get(url);
    var p = hit && Date.now() - hit.t < 30000 ? hit.p : fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "fetch" } })
      .then(function (res) {
        if (!res.ok && res.status !== 404) throw new Error("HTTP " + res.status);
        return res.text().then(function (html) { return { html: html, url: res.url, status: res.status }; });
      });
    if (!hit || hit.p !== p) cache.set(url, { p: p, t: Date.now() });
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    return p.then(function (r) { return { doc: new DOMParser().parseFromString(r.html, "text/html"), url: r.url, status: r.status }; })
      .catch(function (e) { cache.delete(url); throw e; });
  }

  function swapMain(doc, url, opts) {
    var fresh = doc.getElementById("main");
    if (!fresh) { location.href = url; return Promise.resolve(); }
    var run = function () {
      if (cleanupPage) cleanupPage();
      main.replaceWith(fresh); main = fresh;
      document.title = doc.title;
      document.body.className = doc.body.className;
      var meta = document.querySelector('meta[name="description"]'), m2 = doc.querySelector('meta[name="description"]');
      if (meta && m2) meta.content = m2.content;
      var nav2 = doc.getElementById("nav");
      if (nav && nav2) nav.innerHTML = nav2.innerHTML;     // подсветка текущего раздела
      if (opts.push) history.pushState({ y: 0 }, "", url);
      else if (opts.replace !== false) history.replaceState({ y: window.scrollY }, "", url);
      cleanupPage = initPage(main);
    };
    // плавная смена страницы там, где браузер умеет View Transitions
    if (document.startViewTransition && !reduce) return document.startViewTransition(run).updateCallbackDone;
    run(); return Promise.resolve();
  }

  var bar = document.createElement("div"); bar.className = "route-progress"; document.body.appendChild(bar);
  var navSeq = 0;
  function navigate(url, push, restoreY) {
    var my = ++navSeq;
    bar.classList.remove("is-done"); bar.classList.add("is-on");
    history.replaceState(Object.assign({}, history.state, { y: window.scrollY }), "");
    loadDoc(url).then(function (r) {
      if (my !== navSeq) return;
      if (ownScripts(r.doc)) { location.href = url; return; }
      return swapMain(r.doc, r.url, { push: push, replace: !push }).then(function () {
      var hash = new URL(r.url, location.href).hash || new URL(url, location.href).hash;
      var target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
      if (restoreY !== undefined) window.scrollTo(0, restoreY);
      else if (target) target.scrollIntoView();
      else window.scrollTo(0, 0);
      var h1 = main.querySelector("h1");
      if (h1 && restoreY === undefined) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
      if (header) header.classList.remove("is-hidden");
      bar.classList.add("is-done"); setTimeout(function () { bar.classList.remove("is-on", "is-done"); }, 400);
      });
    }).catch(function () { location.href = url; });
  }

  function internal(a, e) {
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    if (a.target && a.target !== "_self") return false;
    if (a.hasAttribute("download") || a.dataset.noRouter !== undefined) return false;
    var u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return false;
    if (/^\/(cabinet|admin|static|media|sitemap|robots|health)/.test(u.pathname) || /\.[a-z0-9]{2,5}$/i.test(u.pathname)) return false;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return false;  // якорь на этой же странице
    return u;
  }
  if (routerOn) {
    history.scrollRestoration = "manual";
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a[href]"), u = internal(a, e);
      if (!u) return;
      e.preventDefault();
      setMenu(false);
      navigate(u.href, true);
    });
    window.addEventListener("popstate", function (e) {
      navigate(location.href, false, e.state && typeof e.state.y === "number" ? e.state.y : 0);
    });
    // предзагрузка: пока палец или курсор на ссылке, страница уже грузится
    var prefetch = function (e) {
      var a = e.target.closest && e.target.closest("a[href]"), u = internal(a, { button: 0 });
      if (u && u.href !== location.href) loadDoc(u.href).catch(function () {});
    };
    document.addEventListener("pointerover", prefetch, { passive: true });
    document.addEventListener("touchstart", prefetch, { passive: true });
  }
})();
