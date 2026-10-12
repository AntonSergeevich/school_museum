/* Музей истории авиации — интерактив. Без зависимостей. */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var a11yOn = function () { return root.dataset.a11y === "on"; };

  /* ---------- Меню ---------- */
  var burger = document.querySelector("[data-burger]");
  var nav = document.getElementById("nav");
  var header = document.querySelector(".site-header");
  function setMenu(open) {
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

  /* ---------- Версия для слабовидящих ---------- */
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

  /* ---------- Cookie ---------- */
  var cookie = document.getElementById("cookie");
  if (cookie && !store.get("cookie-ok")) {
    cookie.hidden = false;
    cookie.querySelector("[data-cookie-ok]").addEventListener("click", function () { store.set("cookie-ok", "1"); cookie.hidden = true; });
  }

  /* ---------- Появление при скролле ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else reveals.forEach(function (el) { el.classList.add("is-in"); });

  /* ---------- Табло: перелистывание букв ---------- */
  var ABC = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789-";
  function flapify(el) {
    var text = el.dataset.flap; el.textContent = ""; el.setAttribute("aria-label", text);
    // Буквы собраны в слова: на узком экране строка переносится между словами, а не посреди слова
    var word = null;
    var cells = Array.from(text).map(function (ch) {
      var s = document.createElement("span"); s.className = "ch" + (ch === " " ? " sp" : "");
      s.textContent = ch === " " ? "\u00a0" : ch; s.setAttribute("aria-hidden", "true");
      if (ch === " ") { word = null; el.appendChild(s); return s; }
      if (!word) { word = document.createElement("span"); word.className = "w"; el.appendChild(word); }
      word.appendChild(s); return s;
    });
    return function play() {
      cells.forEach(function (c, i) {
        var target = text[i]; if (target === " ") return;
        var n = 4 + Math.floor(Math.random() * 6) + Math.floor(i / 2);
        (function step() {
          if (n-- <= 0) { c.textContent = target; return; }
          c.textContent = ABC[Math.floor(Math.random() * ABC.length)];
          setTimeout(step, 45);
        })();
      });
    };
  }
  var flaps = document.querySelectorAll("[data-flap]");
  if (flaps.length && !reduce) {
    var plays = Array.from(flaps).map(flapify);
    var board = document.querySelector(".board");
    var fio = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { plays.forEach(function (p, i) { setTimeout(p, i * 60); }); fio.disconnect(); }
    }, { threshold: .3 });
    fio.observe(board);
  }

  /* ---------- Небо: звёзды и падающие звёзды ---------- */
  var hero = document.querySelector(".hero");
  var heroVisible = true;
  if (hero && "IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { heroVisible = es[0].isIntersecting; }).observe(hero);
  }
  var canvas = document.getElementById("sky");
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext("2d"), stars = [], meteor = null, W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var resize = function () {
      W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round(W * H / 2600) }, function () {
        return { x: Math.random() * W, y: Math.random() * H * .85, r: Math.random() * 1.3 + .2, p: Math.random() * 6.28, s: .5 + Math.random() * 1.5 };
      });
    };
    resize(); window.addEventListener("resize", resize);
    var drawSky = function (t) {
      ctx.clearRect(0, 0, W, H);
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#040817"); g.addColorStop(.6, "#0b1638"); g.addColorStop(1, "#1d2550");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      stars.forEach(function (s) {
        ctx.globalAlpha = .35 + .65 * Math.abs(Math.sin(s.p + t / 1000 * s.s));
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
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
    if (reduce) drawSky(0);
    else (function loop(t) { if (heroVisible && !a11yOn()) drawSky(t); requestAnimationFrame(loop); })(0);
  }

  /* ---------- Эскадрилья: самолёты музея в небе ---------- */
  var fleetEl = document.getElementById("fleet");
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
    planes = planes.map(function (el) {
      var p = { el: el, paused: false };
      el.addEventListener("mouseenter", function () { p.paused = true; });
      el.addEventListener("mouseleave", function () { p.paused = false; });
      setup(p, true); return p;
    });
    var place = function (p, t) {
      var y = p.y0 + Math.sin(t / 900 + p.phase) * p.bob + p.x * p.climb + mouseY * 18 * p.depth;
      var tilt = Math.cos(t / 900 + p.phase) * 1.4 + p.climb * -40 * (p.left ? -1 : 1);
      p.el.style.transform = "translate3d(" + p.x.toFixed(1) + "px," + y.toFixed(1) + "px,0) rotate(" + tilt.toFixed(2) + "deg)";
    };
    hero.addEventListener("pointermove", function (e) { mouseY = e.clientY / window.innerHeight - .5; });
    if (reduce) {
      planes.forEach(function (p, i) { p.x = hero.clientWidth * (.15 + .7 * i / Math.max(planes.length, 1)); place(p, 0); });
    } else {
      (function fly(t) {
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
  }

  /* ---------- HUD и приборы ---------- */
  var alt = document.querySelector("[data-altitude]");
  document.querySelectorAll(".gauge__ticks").forEach(function (g) {
    for (var i = 0; i < 40; i++) {
      var a = (i / 40) * 360, major = i % 5 === 0, r1 = major ? 44 : 47;
      var l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      var rad = (a - 90) * Math.PI / 180;
      l.setAttribute("x1", 60 + Math.cos(rad) * r1); l.setAttribute("y1", 60 + Math.sin(rad) * r1);
      l.setAttribute("x2", 60 + Math.cos(rad) * 51); l.setAttribute("y2", 60 + Math.sin(rad) * 51);
      if (major) l.setAttribute("class", "major"); g.appendChild(l);
    }
  });
  var speedG = document.querySelector('[data-gauge="speed"]');
  var altG = document.querySelector('[data-gauge="alt"]');
  var ball = document.querySelector(".horizon__ball");
  var lastY = window.scrollY, roll = 0;
  function onScroll() {
    var y = window.scrollY;
    if (alt) alt.textContent = Math.min(Math.round(y * 9 / 10) * 10, 10600).toLocaleString("ru-RU");
    var dash = document.querySelector(".dash");
    if (dash) {
      var r = dash.getBoundingClientRect(), k = Math.max(0, Math.min(1, 1 - r.top / window.innerHeight));
      if (speedG) setGauge(speedG, k * 300, Math.round(k * 850) + " км/ч");
      if (altG) setGauge(altG, k * 330, Math.round(k * 11000).toLocaleString("ru-RU") + " м");
      roll = Math.max(-25, Math.min(25, (y - lastY) * 1.5));
      if (ball) ball.style.transform = "rotate(" + roll + "deg) translateY(" + (k * 14 - 7) + "px)";
    }
    lastY = y;
  }
  function setGauge(g, deg, text) {
    g.querySelector(".gauge__needle").style.transform = "rotate(" + deg + "deg)";
    g.querySelector("[data-gauge-value]").textContent = text;
  }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* ---------- Лайтбокс ---------- */
  var lb = document.getElementById("lightbox");
  if (lb && lb.showModal) {
    document.querySelectorAll("[data-zoom]").forEach(function (b) {
      b.addEventListener("click", function () { lb.querySelector("img").src = b.dataset.zoom; lb.showModal(); });
    });
    lb.addEventListener("click", function () { lb.close(); });
  }
})();
