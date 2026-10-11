/* Виртуальный тур на Pannellum (лежит локально в static/vendor/pannellum). */
(function () {
  "use strict";
  var scenes = JSON.parse(document.getElementById("scenes-data").textContent);
  var first = JSON.parse(document.getElementById("first-scene").textContent);
  var card = document.getElementById("exhibit-card");
  var titleEl = document.querySelector("[data-scene-title]");

  function showCard(ex) {
    var img = card.querySelector("[data-card-img]");
    img.hidden = !ex.image; if (ex.image) img.src = ex.image;
    card.querySelector("[data-card-title]").textContent = ex.title;
    card.querySelector("[data-card-text]").textContent = ex.short || "";
    card.querySelector("[data-card-link]").href = ex.url;
    card.hidden = false;
  }
  card.querySelector(".exhibit-card__close").addEventListener("click", function () { card.hidden = true; });

  var cfg = { default: { firstScene: first, autoLoad: true, sceneFadeDuration: 900, hfov: 100, autoRotate: -2,
    strings: { loadingLabel: "Загрузка панорамы…", loadButtonLabel: "Нажмите,<br>чтобы загрузить", bylineLabel: "",
      noPanoramaError: "Панорама не найдена", fileAccessError: "Файл %s недоступен", genericWebGLError: "Браузер не поддерживает WebGL" } },
    scenes: {} };
  Object.keys(scenes).forEach(function (id) {
    var s = scenes[id];
    cfg.scenes[id] = { title: s.title, type: "equirectangular", panorama: s.panorama, yaw: s.yaw, pitch: s.pitch,
      hotSpots: s.hotSpots.map(function (h) {
        var o = { pitch: h.pitch, yaw: h.yaw, type: h.type, text: h.text };
        if (h.sceneId) o.sceneId = h.sceneId;
        if (h.exhibit) {
          o.cssClass = "hs-exhibit";
          o.clickHandlerFunc = function () { showCard(h.exhibit); };
        }
        return o;
      }) };
  });

  var viewer = pannellum.viewer("pano", cfg);
  var buttons = document.querySelectorAll("[data-scene]");
  function mark(id) {
    buttons.forEach(function (b) { b.classList.toggle("is-active", b.dataset.scene === id); });
    if (titleEl && scenes[id]) titleEl.textContent = scenes[id].title;
    card.hidden = true;
  }
  viewer.on("scenechange", mark); mark(first);
  buttons.forEach(function (b) { b.addEventListener("click", function () { viewer.loadScene(b.dataset.scene); }); });
  viewer.on("mousedown", function () { viewer.stopAutoRotate(); });

  if (window.TOUR_MARKUP) {
    var out = document.querySelector("[data-markup-out]");
    viewer.on("mouseup", function (e) {
      var c = viewer.mouseEventToCoords(e);
      out.textContent = "pitch " + c[0].toFixed(1) + " · yaw " + c[1].toFixed(1);
    });
  }
})();
