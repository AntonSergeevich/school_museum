/* 3D-кабина Ил-62 — учебная реконструкция.
 *
 * Всё строится кодом: ни одной внешней модели или текстуры. Приборы рисуются
 * на canvas и показывают живые значения; штурвал, РУДы, тумблеры, кран шасси
 * и кнопки запуска можно трогать. Режим полёта — простая аркадная модель:
 * её задача — показать, как приборы связаны с движением самолёта, а не
 * научить пилотированию.
 *
 * Система координат кабины: метры, x — вправо, y — вверх, −z — вперёд по полёту.
 */
import * as THREE from "three";

const app = document.getElementById("cockpit-app");
const canvas = document.getElementById("pit-canvas");
const $ = (sel) => app.querySelector(sel);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = window.matchMedia("(pointer: coarse)").matches;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ Рендер */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
} catch (e) {
  $("[data-fallback]").hidden = false;
  $("[data-loader]").hidden = true;
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.03, 90000);
camera.rotation.order = "YXZ";
const aircraft = new THREE.Group();       // кабина + камера; движется по миру в режиме полёта
scene.add(aircraft);
aircraft.add(camera);
const cockpit = new THREE.Group();
aircraft.add(cockpit);

/* ------------------------------------------------------------- Материалы */
const M = {
  panel: new THREE.MeshStandardMaterial({ color: 0x4a7f83, roughness: 0.85 }),        // «советская бирюза»
  panelDark: new THREE.MeshStandardMaterial({ color: 0x2f5357, roughness: 0.85 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x8c9590, roughness: 0.95, side: THREE.DoubleSide }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xb7bcb4, roughness: 0.95, side: THREE.DoubleSide }),
  black: new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.6 }),
  bezel: new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 0.5, metalness: 0.15 }),
  // без карты окружения сильный metalness даёт чёрный металл — держим умеренным
  metal: new THREE.MeshStandardMaterial({ color: 0xaab2b6, roughness: 0.45, metalness: 0.35 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe4e6, roughness: 0.3, metalness: 0.45 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x3a3f3c, roughness: 1 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x3a4a6a, roughness: 0.95 }),
  seatFrame: new THREE.MeshStandardMaterial({ color: 0x5b6266, roughness: 0.6, metalness: 0.4 }),
  yoke: new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc8261f, roughness: 0.5 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x5f6b6a, roughness: 0.8, side: THREE.DoubleSide }),
  glass: new THREE.MeshBasicMaterial({ color: 0xa8d8e8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 1 }),
};
const lampOff = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.4 });

/* ----------------------------------------------------------- Помощники */
function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = cockpit) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, parent = cockpit, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
/** Табличка с надписью (белым по тёмному, как гравировка на приборных щитках). */
function placard(text, w, h, parent, x, y, z, opts = {}) {
  const px = 256, c = makeCanvas(px * (w / h) | 0, px);
  const g = c.getContext("2d");
  g.fillStyle = opts.bg || "#24403f";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = opts.color || "#f2f2ea";
  g.font = `700 ${opts.size || 150}px Arial, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 8, c.width - 20);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTexture(c), toneMapped: false }));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/* ================================================================ ПРИБОРЫ */
/* Каждый прибор — canvas-текстура на круглом циферблате. Перерисовывается
 * только когда меняется показание, поэтому десятки приборов не грузят видеокарту. */
const gauges = [];
const S = 256; // размер холста прибора

function face(g, label, sub) {
  g.clearRect(0, 0, S, S);
  const r = S / 2;
  g.fillStyle = "#0b0d0f";
  g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#2c3236"; g.lineWidth = 6;
  g.beginPath(); g.arc(r, r, r - 4, 0, Math.PI * 2); g.stroke();
  if (label) { g.fillStyle = "#c8d0cc"; g.font = "600 17px Arial"; g.textAlign = "center"; g.fillText(label, r, r - 34); }
  if (sub) { g.fillStyle = "#8f9a96"; g.font = "600 15px Arial"; g.textAlign = "center"; g.fillText(sub, r, r + 48); }
}
function scale(g, { min, max, a0, a1, major, minor, every = 1, fmt = (v) => v, radius = 112, red, numR = 84, font = 22 }) {
  const r = S / 2;
  const ang = (v) => (a0 + (v - min) / (max - min) * (a1 - a0) - 90) * DEG;
  if (red) {
    g.strokeStyle = "#d22"; g.lineWidth = 9;
    g.beginPath(); g.arc(r, r, radius - 5, ang(red[0]), ang(red[1])); g.stroke();
  }
  g.strokeStyle = "#e9ece6"; g.fillStyle = "#e9ece6";
  for (let v = min, i = 0; v <= max + 1e-6; v += minor, i++) {
    const isMajor = Math.abs(((v - min) / major) - Math.round((v - min) / major)) < 1e-6;
    const a = ang(v), l = isMajor ? 16 : 8;
    g.lineWidth = isMajor ? 3.5 : 2;
    g.beginPath();
    g.moveTo(r + Math.cos(a) * radius, r + Math.sin(a) * radius);
    g.lineTo(r + Math.cos(a) * (radius - l), r + Math.sin(a) * (radius - l));
    g.stroke();
    if (isMajor && (Math.round((v - min) / major) % every === 0)) {
      g.font = `700 ${font}px Arial`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(fmt(v), r + Math.cos(a) * numR, r + Math.sin(a) * numR);
    }
  }
  return ang;
}
function needle(g, a, len, width, color = "#f4f4ee", tail = 18) {
  const r = S / 2;
  g.save(); g.translate(r, r); g.rotate(a);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-tail, -width / 2); g.lineTo(len - 10, -width / 2.6); g.lineTo(len, 0); g.lineTo(len - 10, width / 2.6); g.lineTo(-tail, width / 2);
  g.closePath(); g.fill();
  g.restore();
}
function hub(g) {
  const r = S / 2;
  g.fillStyle = "#30363a"; g.beginPath(); g.arc(r, r, 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#9aa"; g.beginPath(); g.arc(r, r, 4, 0, Math.PI * 2); g.fill();
}

const DRAW = {
  speed(g, v) { // КУС: широкая — приборная, тонкая — истинная
    face(g, "СКОРОСТЬ", "км/ч");
    const ang = scale(g, { min: 0, max: 1000, a0: -150, a1: 150, major: 100, minor: 20, fmt: (x) => x / 100, red: [900, 1000] });
    needle(g, ang(clamp(v[1], 0, 1000)), 96, 5, "#f2c14e");
    needle(g, ang(clamp(v[0], 0, 1000)), 100, 13);
    hub(g);
  },
  alt(g, h) { // ВД: большая стрелка — метры, малая — километры
    face(g, "ВЫСОТА", "");
    const r = S / 2;
    scale(g, { min: 0, max: 1000, a0: 0, a1: 360, major: 100, minor: 20, fmt: (x) => (x === 1000 ? "" : x / 100) });
    g.fillStyle = "#111"; g.fillRect(r - 30, r + 30, 60, 26);
    g.strokeStyle = "#555"; g.strokeRect(r - 30, r + 30, 60, 26);
    g.fillStyle = "#f2f2ea"; g.font = "700 18px monospace"; g.textAlign = "center"; g.fillText("760", r, r + 44);
    g.fillStyle = "#8f9a96"; g.font = "600 13px Arial"; g.fillText("км", r - 46, r - 6); g.fillText("м", r + 46, r - 6);
    const hh = Math.max(0, h);
    needle(g, ((hh / 20000) * 360 - 90) * DEG, 58, 15, "#e9ece6", 10);
    needle(g, (((hh % 1000) / 1000) * 360 - 90) * DEG, 104, 8);
    hub(g);
  },
  vario(g, vs) { // ВАР: ±30 м/с, ноль — слева
    face(g, "", "м/с");
    const r = S / 2;
    const ang = (x) => (-90 + clamp(x, -30, 30) / 30 * 165 - 90) * DEG;
    g.strokeStyle = "#e9ece6"; g.fillStyle = "#e9ece6"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let x = -30; x <= 30; x += 2.5) {
      const major = x % 10 === 0 || Math.abs(x) === 5, a = ang(x);
      g.lineWidth = major ? 3.5 : 2;
      g.beginPath(); g.moveTo(r + Math.cos(a) * 112, r + Math.sin(a) * 112); g.lineTo(r + Math.cos(a) * (major ? 96 : 104), r + Math.sin(a) * (major ? 96 : 104)); g.stroke();
      if (major) { g.font = "700 21px Arial"; g.fillText(Math.abs(x), r + Math.cos(a) * 80, r + Math.sin(a) * 80); }
    }
    g.font = "700 15px Arial"; g.fillStyle = "#8f9a96"; g.fillText("ПОДЪЁМ", r + 34, r - 44); g.fillText("СПУСК", r + 34, r + 50);
    needle(g, ang(vs), 102, 10);
    hub(g);
  },
  attitude(g, v) { // ПКП/АГД: горизонт смещается по тангажу, силуэт наклоняется по крену
    const [pitch, roll] = v, r = S / 2;
    g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(r, r, r - 6, 0, Math.PI * 2); g.clip();
    const k = 3.2, off = clamp(pitch, -40, 40) * k;
    g.fillStyle = "#3d86d6"; g.fillRect(0, 0, S, r + off);
    g.fillStyle = "#7a5230"; g.fillRect(0, r + off, S, S);
    g.strokeStyle = "#fff"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, r + off); g.lineTo(S, r + off); g.stroke();
    g.lineWidth = 2; g.fillStyle = "#fff"; g.font = "700 14px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let p = -30; p <= 30; p += 5) {
      if (!p) continue;
      const y = r + off - p * k, w = p % 10 === 0 ? 40 : 18;
      g.beginPath(); g.moveTo(r - w, y); g.lineTo(r + w, y); g.stroke();
      if (p % 10 === 0) { g.fillText(Math.abs(p), r - w - 14, y); g.fillText(Math.abs(p), r + w + 14, y); }
    }
    g.restore();
    // шкала крена
    g.strokeStyle = "#fff"; g.lineWidth = 3;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const rad = (a - 90) * DEG, l = a % 30 === 0 ? 16 : 9;
      g.beginPath(); g.moveTo(r + Math.cos(rad) * (r - 8), r + Math.sin(rad) * (r - 8)); g.lineTo(r + Math.cos(rad) * (r - 8 - l), r + Math.sin(rad) * (r - 8 - l)); g.stroke();
    }
    // силуэт самолёта, наклонённый по крену
    g.save(); g.translate(r, r); g.rotate(roll * DEG);
    g.strokeStyle = "#ffb000"; g.fillStyle = "#ffb000"; g.lineWidth = 7; g.lineCap = "round";
    g.beginPath(); g.moveTo(-70, 0); g.lineTo(-22, 0); g.lineTo(-10, 12); g.moveTo(10, 12); g.lineTo(22, 0); g.lineTo(70, 0); g.stroke();
    g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(0, -(r - 30)); g.lineTo(-9, -(r - 46)); g.lineTo(9, -(r - 46)); g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = "#1b1f22"; g.lineWidth = 10; g.beginPath(); g.arc(r, r, r - 5, 0, Math.PI * 2); g.stroke();
  },
  hsi(g, v) { // ПНП: картушка курса
    const [hdg, crs] = v, r = S / 2;
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#0b0d0f"; g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(r, r); g.rotate(-hdg * DEG);
    g.strokeStyle = "#e9ece6"; g.fillStyle = "#e9ece6"; g.textAlign = "center"; g.textBaseline = "middle";
    const letters = { 0: "С", 90: "В", 180: "Ю", 270: "З" };
    for (let a = 0; a < 360; a += 5) {
      const rad = (a - 90) * DEG, l = a % 10 === 0 ? 14 : 7;
      g.lineWidth = a % 10 === 0 ? 3 : 1.5;
      g.beginPath(); g.moveTo(Math.cos(rad) * 112, Math.sin(rad) * 112); g.lineTo(Math.cos(rad) * (112 - l), Math.sin(rad) * (112 - l)); g.stroke();
      if (a % 30 === 0) {
        g.save(); g.rotate(a * DEG);
        g.font = letters[a] ? "700 26px Arial" : "700 20px Arial";
        g.fillStyle = letters[a] ? "#ffb000" : "#e9ece6";
        g.fillText(letters[a] || a / 10, 0, -82);
        g.restore();
      }
    }
    g.rotate(crs * DEG); // стрелка заданного курса
    g.fillStyle = "#f2c14e"; g.strokeStyle = "#f2c14e"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, -66); g.lineTo(0, 66); g.stroke();
    g.beginPath(); g.moveTo(0, -78); g.lineTo(-10, -60); g.lineTo(10, -60); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = "#ffb000"; g.beginPath(); g.moveTo(r, 10); g.lineTo(r - 9, 26); g.lineTo(r + 9, 26); g.closePath(); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 5; g.lineCap = "round";
    g.beginPath(); g.moveTo(r, r - 24); g.lineTo(r, r + 26); g.moveTo(r - 24, r - 2); g.lineTo(r + 24, r - 2); g.moveTo(r - 10, r + 22); g.lineTo(r + 10, r + 22); g.stroke();
  },
  clock(g) { // АЧС: настоящее время
    face(g, "", "");
    const r = S / 2, now = new Date();
    scale(g, { min: 0, max: 60, a0: 0, a1: 360, major: 5, minor: 1, fmt: (x) => (x ? x / 5 : 12), font: 24 });
    g.fillStyle = "#8f9a96"; g.font = "600 13px Arial"; g.textAlign = "center"; g.fillText("АЧС", r, r + 44);
    const s = now.getSeconds(), m = now.getMinutes() + s / 60, h = (now.getHours() % 12) + m / 60;
    needle(g, (h / 12 * 360 - 90) * DEG, 64, 11);
    needle(g, (m / 60 * 360 - 90) * DEG, 96, 8);
    needle(g, (s / 60 * 360 - 90) * DEG, 104, 3, "#e33");
    hub(g);
  },
  dial(g, v, o) { // универсальный стрелочный прибор
    face(g, o.label, o.unit);
    const ang = scale(g, o.scale);
    needle(g, ang(clamp(v, o.scale.min, o.scale.max)), 98, 10, o.color);
    hub(g);
    if (o.num) { g.fillStyle = "#ffb000"; g.font = "700 26px Arial"; g.textAlign = "center"; g.fillText(o.num, S / 2, S / 2 + 74); }
  },
  radar(g, t) { // экран радиолокатора штурмана
    const r = S / 2;
    g.fillStyle = "rgba(2, 18, 6, .22)"; g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.fill();
    const a = (t / 1600) % (Math.PI * 2);
    g.strokeStyle = "rgba(90, 255, 120, .9)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(r, r); g.lineTo(r + Math.cos(a) * (r - 6), r + Math.sin(a) * (r - 6)); g.stroke();
    // «засветки» облаков и береговой линии под лучом
    for (let i = 0; i < 6; i++) {
      const b = a - i * 0.02, d = 40 + 70 * (0.5 + 0.5 * Math.sin(b * 3.1 + 1.3) * Math.cos(b * 1.7));
      if (Math.sin(b * 5) > 0.2) { g.fillStyle = "rgba(120,255,140,.55)"; g.fillRect(r + Math.cos(b) * d, r + Math.sin(b) * d, 3, 3); }
    }
    g.strokeStyle = "rgba(90,255,120,.25)"; g.lineWidth = 1;
    for (const rr of [40, 80, 118]) { g.beginPath(); g.arc(r, r, rr, 0, Math.PI * 2); g.stroke(); }
  },
};

class Gauge {
  constructor(type, radius, parent, x, y, z, opts = {}) {
    this.type = type; this.opts = opts; this.read = opts.read || (() => 0);
    this.canvas = makeCanvas(S, S); this.g = this.canvas.getContext("2d");
    this.tex = canvasTexture(this.canvas);
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    const bez = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.13, radius * 1.18, 0.022, 36), M.bezel);
    bez.rotation.x = Math.PI / 2;
    grp.add(bez);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.face = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), this.mat);
    this.face.position.z = 0.0115;
    grp.add(this.face);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    glass.position.z = 0.014;
    grp.add(glass);
    parent.add(grp);
    this.group = grp;
    this.last = undefined;
    gauges.push(this);
    this.update(true);
  }
  update(force) {
    const v = this.read();
    const key = Array.isArray(v) ? v.map((x) => Math.round(x * 4)).join() : Math.round(v * (this.opts.prec || 2));
    if (!force && key === this.last) return;
    this.last = key;
    DRAW[this.type](this.g, v, this.opts);
    this.tex.needsUpdate = true;
  }
}

/* ======================================================== СОСТОЯНИЕ САМОЛЁТА */
const state = {
  mode: "inspect",          // inspect | fly
  speed: 0, alt: 0, vs: 0, pitch: 0, roll: 0, hdg: 0, gamma: 0,
  pos: new THREE.Vector3(0, 0, 1350),
  onGround: true, gear: 1, gearTarget: 1, flaps: 15, flapsPos: 15, brake: true, ap: false, apAlt: 0, apHdg: 0,
  throttle: 0, input: { pitch: 0, roll: 0 }, keys: {}, stall: false, crashed: false,
  engines: [0, 1, 2, 3].map(() => ({ n: 0, running: false, starting: 0 })),
  fuel: 62, night: false, lights: { landing: false, nav: true, panel: false, beacon: true, wipers: false, heat: true },
  spoilers: false, yokeVis: { pitch: 0, roll: 0 }, time: 0,
};
const kmh = () => state.speed * 3.6;
const egt = (n) => (n < 1 ? 15 : 260 + n * 4.3);

/* ============================================================ ИНТЕРАКТИВ */
const pickables = [];          // меши, по которым можно щёлкнуть
const INFO = {};               // id → описание
const actions = {};            // id → действие по щелчку

function info(id, group, title, text, opts = {}) {
  INFO[id] = { id, group, title, text, ...opts };
}
/** Привязать объект к описанию; clone — свои материалы для подсветки. */
function tag(obj, id, opts = {}) {
  obj.traverse((m) => {
    if (!m.isMesh) return;
    if (!opts.keepMaterial && m.material && m.material.emissive) m.material = m.material.clone();
    m.userData.info = id;
    if (opts.drag) m.userData.drag = opts.drag;
    if (opts.arg !== undefined) m.userData.arg = opts.arg;
    pickables.push(m);
  });
  return obj;
}

/* ================================================================ КАБИНА */
const CYL_R = 1.62, CYL_Y = 0.5;       // радиус и центр сечения фюзеляжа (внутри)
const NOSE_Z0 = 0.05;                  // отсюда назад — цилиндр, вперёд — нос с остеклением
const SILL_Y = 1.05, TOP_Y = 1.62, ROOF_Y = 2.04;

/** Отрезок-стойка между двумя точками. */
function strut(a, b, r, mat, parent = cockpit) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m);
  return m;
}
/** Полоса четырёхугольников между двумя «кольцами» точек. */
function strip(A, B, mat) {
  const pos = [];
  for (let i = 0; i < A.length - 1; i++) {
    pos.push(...A[i].toArray(), ...B[i].toArray(), ...A[i + 1].toArray(), ...A[i + 1].toArray(), ...B[i].toArray(), ...B[i + 1].toArray());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  cockpit.add(m);
  return m;
}

/** Нос: остекление по каркасу (вид сверху — ломаная), ниже — обшивка, выше — потолок.
 *  Нижняя кромка стёкол чуть ниже глаз пилота, как в настоящей кабине. */
let windshield, sill = [], topRing = [];
function buildNose() {
  const plan = [[-1.5, 0.05], [-1.42, -0.45], [-0.85, -0.95], [0, -1.16], [0.85, -0.95], [1.42, -0.45], [1.5, 0.05]];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const floorRing = plan.map(([x, z]) => V(x, 0, z));
  sill = plan.map(([x, z]) => V(x, SILL_Y, z));
  topRing = plan.map(([x, z]) => V(x * 0.78, TOP_Y, z * 0.76 + 0.06));
  const roof = plan.map(([x, z]) => V(x * 0.42, ROOF_Y, z * 0.45 + 0.12));
  strip(floorRing, sill, M.wall);
  windshield = strip(sill, topRing, M.glass);
  strip(topRing, roof, M.ceiling);
  // купол над головой: веер от кромки к центру
  const apex = V(0, CYL_Y + CYL_R - 0.01, 0.12), fan = [];
  for (let i = 0; i < roof.length - 1; i++) fan.push(...roof[i].toArray(), ...apex.toArray(), ...roof[i + 1].toArray());
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fan, 3)); fg.computeVertexNormals();
  cockpit.add(new THREE.Mesh(fg, M.ceiling));
  // переплёт: стойки, нижняя и верхняя кромки
  plan.forEach((_, i) => strut(sill[i], topRing[i], i === 3 ? 0.022 : i === 0 || i === 6 ? 0.04 : 0.018, M.frame));
  for (let i = 0; i < plan.length - 1; i++) { strut(sill[i], sill[i + 1], 0.016, M.frame); strut(topRing[i], topRing[i + 1], 0.02, M.frame); }
}

function buildShell() {
  // фюзеляж за носом: толстостенная дуга, выдавленная назад
  const shape = new THREE.Shape(), a0 = -32 * DEG, a1 = 212 * DEG, R1 = CYL_R, R2 = CYL_R + 0.08;
  shape.absarc(0, CYL_Y, R2, a0, a1, false);
  shape.absarc(0, CYL_Y, R1, a1, a0, true);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.8, bevelEnabled: false, curveSegments: 40 });
  const shell = new THREE.Mesh(geo, M.wall);
  shell.position.z = NOSE_Z0;
  cockpit.add(shell);
  // потолок светлее: отдельная дуга чуть внутри обшивки
  const cs = new THREE.Shape();
  cs.absarc(0, CYL_Y, CYL_R - 0.005, 50 * DEG, 130 * DEG, false);
  cs.absarc(0, CYL_Y, CYL_R - 0.02, 130 * DEG, 50 * DEG, true);
  const ceil = new THREE.Mesh(new THREE.ExtrudeGeometry(cs, { depth: 2.8, bevelEnabled: false, curveSegments: 16 }), M.ceiling);
  ceil.position.z = NOSE_Z0;
  cockpit.add(ceil);
  // пол с рифлёным покрытием
  box(3.1, 0.05, 4.4, M.floor, 0, -0.025, 0.6);
  // задняя переборка с дверью в салон
  const bulk = new THREE.Group(); bulk.position.z = 2.85; cockpit.add(bulk);
  box(3.4, 2.4, 0.05, M.wall, 0, 1.0, 0, bulk);
  const door = box(0.75, 1.85, 0.06, M.panelDark, 0, 0.93, -0.03, bulk);
  box(0.06, 0.06, 0.08, M.chrome, 0.28, 0.95, -0.06, bulk);
  placard("САЛОН", 0.22, 0.07, bulk, 0, 1.6, -0.065, { bg: "#1d2e2e" });
  tag(door, "door");
}

/* ------------------------------------------------------- Приборная доска */
let gearLamps = [], annunciator, gearLever, flapsLever, brakeLever, spoilerLever;
const panel = new THREE.Group();
function buildPanel() {
  panel.position.set(0, 0.76, -0.86);
  panel.rotation.x = -0.12;
  cockpit.add(panel);
  // три секции + нижняя часть до пола
  const left = box(0.74, 0.56, 0.06, M.panel, -0.58, 0, 0, panel);
  const right = box(0.74, 0.56, 0.06, M.panel, 0.58, 0, 0, panel);
  const center = box(0.42, 0.62, 0.06, M.panel, 0, -0.03, 0, panel);
  tag(left, "panel"); tag(right, "panel"); tag(center, "enginePanel");
  box(1.85, 0.06, 0.4, M.panelDark, 0, 0.47, -0.98);  // низ доски
  // козырёк от бликов
  const shield = new THREE.Group(); shield.position.set(0, 1.02, -0.93); cockpit.add(shield);
  const top = box(1.75, 0.03, 0.36, M.black, 0, 0.0, 0, shield);
  const lip = box(1.75, 0.06, 0.03, M.black, 0, -0.02, 0.16, shield);
  tag(top, "glareshield"); tag(lip, "glareshield");
  // пульт автопилота на козырьке
  const ap = new THREE.Group(); ap.position.set(0, -0.015, 0.18); shield.add(ap);
  const apBox = box(0.56, 0.065, 0.02, M.panelDark, 0, 0, 0, ap);
  tag(apBox, "autopilot");
  const apLabels = ["АП", "ВЫС", "КУРС", "СТАБ"];
  apLabels.forEach((t, i) => {
    const b = placard(t, 0.075, 0.035, ap, -0.2 + i * 0.13, 0, 0.012, { bg: "#2b2b2b", size: 120 });
    tag(b, i === 0 ? "apButton" : "autopilot");
    if (i === 0) apButtonMesh = b;
  });
  // главные сигнальные лампы перед каждым пилотом
  for (const side of [-1, 1]) {
    const warn = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0x000000 }));
    warn.position.set(side * 0.6, -0.015, 0.18); shield.add(warn);
    const caut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), new THREE.MeshStandardMaterial({ color: 0x554411, emissive: 0x000000 }));
    caut.position.set(side * 0.68, -0.015, 0.18); shield.add(caut);
    tag(warn, "masterWarn"); tag(caut, "masterWarn");
    masterLamps.push(warn, caut);
    // солнцезащитный щиток у окна
    const visor = box(0.4, 0.18, 0.008, new THREE.MeshStandardMaterial({ color: 0x2c4a3a, transparent: true, opacity: 0.8 }), side * 0.5, 1.66, -0.45);
    visor.rotation.x = -1.45;
    tag(visor, "visor");
  }

  // ПРИБОРЫ ПИЛОТОВ: по шесть основных у каждого, зеркально
  const z = 0.032;
  for (const side of [-1, 1]) {
    const cx = side * 0.58, who = side < 0 ? "КВС" : "второй пилот";
    tag(new Gauge("speed", 0.058, panel, cx - 0.2, 0.12, z, { read: () => [kmh(), kmh() * (1 + state.alt / 45000)] }).group, "speed");
    tag(new Gauge("attitude", 0.075, panel, cx, 0.1, z, { read: () => [state.pitch, state.roll] }).group, "attitude");
    tag(new Gauge("alt", 0.058, panel, cx + 0.2, 0.12, z, { read: () => state.alt, prec: 1 }).group, "alt");
    tag(new Gauge("vario", 0.05, panel, cx + 0.2, -0.06, z, { read: () => state.vs, prec: 4 }).group, "vario");
    tag(new Gauge("hsi", 0.07, panel, cx, -0.09, z, { read: () => [state.hdg, 0] }).group, "hsi");
    tag(new Gauge("clock", 0.042, panel, cx - 0.2, -0.06, z, { read: () => Math.floor(Date.now() / 1000) }).group, "clock");
    tag(new Gauge("dial", 0.04, panel, cx - 0.2, -0.2, z, { read: () => state.speed * 3.6 / 1200, prec: 200,
      label: "М", unit: "число М", scale: { min: 0.3, max: 1, a0: -140, a1: 140, major: 0.1, minor: 0.05, fmt: (x) => x.toFixed(1), font: 18 } }).group, "mach");
    tag(new Gauge("dial", 0.04, panel, cx + 0.2, -0.2, z, { read: () => Math.max(0, Math.min(state.alt, 750)), prec: 1,
      label: "РВ", unit: "м", scale: { min: 0, max: 750, a0: -140, a1: 140, major: 100, minor: 50, fmt: (x) => x, font: 17 } }).group, "radioAlt");
    placard(who === "КВС" ? "КОМАНДИР" : "2-Й ПИЛОТ", 0.14, 0.026, panel, cx, -0.255, z, { size: 120 });
  }
  // ЦЕНТР: двигатели
  for (let i = 0; i < 4; i++) {
    const x = -0.15 + i * 0.1;
    tag(new Gauge("dial", 0.043, panel, x, 0.16, 0.032, { read: () => state.engines[i].n, prec: 1, label: "", unit: "%", num: String(i + 1),
      scale: { min: 0, max: 110, a0: -135, a1: 135, major: 10, minor: 5, every: 2, fmt: (x) => x, red: [102, 110], font: 19 } }).group, "tacho");
    tag(new Gauge("dial", 0.038, panel, x, 0.06, 0.032, { read: () => egt(state.engines[i].n), prec: 0.2, label: "", unit: "t°C×100",
      scale: { min: 0, max: 900, a0: -135, a1: 135, major: 100, minor: 50, every: 2, fmt: (x) => x / 100, red: [750, 900], font: 19 }, color: "#f2c14e" }).group, "egt");
  }
  tag(new Gauge("dial", 0.045, panel, -0.11, -0.055, 0.032, { read: () => state.fuel, prec: 2, label: "ТОПЛИВО", unit: "т",
    scale: { min: 0, max: 90, a0: -135, a1: 135, major: 10, minor: 5, every: 2, fmt: (x) => x, red: [0, 8], font: 19 } }).group, "fuelGauge");
  tag(new Gauge("dial", 0.045, panel, 0.11, -0.055, 0.032, { read: () => state.flapsPos, prec: 2, label: "ЗАКРЫЛКИ", unit: "град",
    scale: { min: 0, max: 45, a0: -120, a1: 120, major: 15, minor: 5, fmt: (x) => x, font: 20 } }).group, "flapsInd");
  // табло сигнализации
  annunciator = new Annunciator(panel, 0, -0.18, 0.032);
  tag(annunciator.mesh, "annunciator");
  // кран шасси с тремя лампами
  const gearGrp = new THREE.Group(); gearGrp.position.set(0.31, -0.2, 0.035); panel.add(gearGrp);
  box(0.11, 0.13, 0.01, M.panelDark, 0, 0, 0, gearGrp);
  placard("ШАССИ", 0.09, 0.022, gearGrp, 0, 0.052, 0.007, { size: 120 });
  for (let i = 0; i < 3; i++) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 14), lampOff.clone());
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(-0.03 + (i === 1 ? 0.03 : i === 0 ? 0 : 0.06), i === 1 ? 0.025 : 0.005, 0.008);
    gearGrp.add(lamp); gearLamps.push(lamp);
  }
  gearLever = new THREE.Group(); gearLever.position.set(-0.035, -0.025, 0.006); gearGrp.add(gearLever);
  const rod = cyl(0.005, 0.005, 0.07, M.chrome, 0, 0.035, 0, gearLever);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 20), M.white);
  knob.rotation.z = Math.PI / 2; knob.position.y = 0.07; gearLever.add(knob); // колесо-ручка, как у настоящих кранов шасси
  tag(gearGrp, "gear");
  gearLever.rotation.x = 0.5;
}
let apButtonMesh;
const masterLamps = [];

class Annunciator {
  constructor(parent, x, y, z) {
    this.c = makeCanvas(512, 128); this.g = this.c.getContext("2d"); this.tex = canvasTexture(this.c);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.mesh.position.set(x, y, z); parent.add(this.mesh);
    this.cells = [
      ["ПОЖАР", "#ff3b30", () => false], ["СВАЛИВАНИЕ", "#ff3b30", () => state.stall],
      ["ОПАСНАЯ ВЫСОТА", "#ff3b30", () => state.mode === "fly" && !state.onGround && state.alt < 150 && state.vs < -6],
      ["ШАССИ НЕ ВЫПУЩЕНО", "#ff3b30", () => state.mode === "fly" && !state.onGround && state.alt < 300 && state.gear < 1 && state.throttle < 0.35],
      ["СТОЯН. ТОРМОЗ", "#ffb000", () => state.brake], ["ЗАКРЫЛКИ", "#ffb000", () => Math.abs(state.flapsPos - state.flaps) > 0.3],
      ["ИНТЕРЦЕПТОРЫ", "#ffb000", () => state.spoilers], ["АВТОПИЛОТ", "#34d058", () => state.ap],
    ];
    this.last = "";
    this.update();
  }
  update() {
    const lit = this.cells.map((c) => c[2]());
    const key = lit.join();
    if (key === this.last) return;
    this.last = key;
    const g = this.g, cw = 128, ch = 64;
    g.fillStyle = "#050505"; g.fillRect(0, 0, 512, 128);
    this.cells.forEach(([t, col], i) => {
      const x = (i % 4) * cw, y = Math.floor(i / 4) * ch, on = lit[i];
      g.fillStyle = on ? col : "#161616"; g.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      g.fillStyle = on ? "#111" : "#3a3a3a"; g.font = "700 17px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
      const words = t.split(" ");
      if (words.length > 1 && t.length > 11) { g.fillText(words[0], x + cw / 2, y + ch / 2 - 10, cw - 12); g.fillText(words.slice(1).join(" "), x + cw / 2, y + ch / 2 + 11, cw - 12); }
      else g.fillText(t, x + cw / 2, y + ch / 2, cw - 12);
    });
    this.tex.needsUpdate = true;
    const alarm = lit[1] || lit[2] || lit[3];
    masterLamps.forEach((m, i) => m.material.emissive.setHex(alarm && i % 2 === 0 ? 0xff2200 : 0x000000));
  }
}

/* --------------------------------------------------------- Центральный пульт */
const throttles = [];
function buildPedestal() {
  const ped = new THREE.Group(); ped.position.set(0, 0, 0); cockpit.add(ped);
  // корпус: наклонная передняя часть и горизонтальная задняя
  const front = box(0.42, 0.06, 0.5, M.panelDark, 0, 0.63, -0.42, ped); front.rotation.x = 0.35;
  const body = box(0.42, 0.62, 0.95, M.panelDark, 0, 0.31, -0.05, ped);
  const top = box(0.42, 0.03, 0.72, M.panel, 0, 0.635, 0.08, ped);
  tag(front, "pedestal"); tag(body, "pedestal"); tag(top, "pedestal");
  // прорезь под РУДы
  box(0.3, 0.012, 0.22, M.black, 0, 0.652, -0.12, ped);
  placard("МГ", 0.05, 0.02, ped, -0.18, 0.656, -0.03, { size: 140 }).rotation.x = -Math.PI / 2;
  placard("ВЗЛЁТ", 0.07, 0.02, ped, -0.17, 0.656, -0.22, { size: 120 }).rotation.x = -Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group(); g.position.set(-0.105 + i * 0.07, 0.655, -0.12); ped.add(g);
    cyl(0.007, 0.007, 0.2, M.chrome, 0, 0.1, 0, g);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.04), M.black);
    knob.position.set(0, 0.2, 0); g.add(knob);
    placard(String(i + 1), 0.022, 0.02, g, 0, 0.2, 0.021, { bg: "#111", size: 160 });
    if (i === 0 || i === 3) { // рычаги реверса — только на крайних двигателях
      const rev = box(0.012, 0.05, 0.012, M.red, 0, 0.16, 0.022, g);
      rev.rotation.x = 0.4;
    }
    tag(g, "throttle", { drag: "throttle", arg: i });
    throttles.push(g);
  }
  // кран закрылков с гребёнкой
  flapsLever = new THREE.Group(); flapsLever.position.set(0.15, 0.655, 0.12); ped.add(flapsLever);
  cyl(0.006, 0.006, 0.14, M.chrome, 0, 0.07, 0, flapsLever);
  const fk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.03), M.white); fk.position.y = 0.14; flapsLever.add(fk);
  tag(flapsLever, "flaps");
  ["0", "15", "30"].forEach((t, i) => { const p = placard(t, 0.03, 0.02, ped, 0.19, 0.656, 0.04 + i * 0.075, { size: 130 }); p.rotation.x = -Math.PI / 2; });
  // интерцепторы
  spoilerLever = new THREE.Group(); spoilerLever.position.set(-0.15, 0.655, 0.12); ped.add(spoilerLever);
  cyl(0.006, 0.006, 0.12, M.chrome, 0, 0.06, 0, spoilerLever);
  box(0.04, 0.02, 0.03, M.panelDark, 0, 0.12, 0, spoilerLever);
  tag(spoilerLever, "spoilers");
  // стояночный тормоз
  brakeLever = new THREE.Group(); brakeLever.position.set(0, 0.655, 0.22); ped.add(brakeLever);
  const bh = box(0.08, 0.02, 0.02, M.red, 0, 0.04, 0, brakeLever);
  cyl(0.005, 0.005, 0.04, M.chrome, -0.03, 0.02, 0, brakeLever); cyl(0.005, 0.005, 0.04, M.chrome, 0.03, 0.02, 0, brakeLever);
  tag(brakeLever, "brake");
  placard("СТОЯН. ТОРМОЗ", 0.12, 0.018, ped, 0, 0.656, 0.27, { size: 110 }).rotation.x = -Math.PI / 2;
  // штурвальчики триммера по бокам
  for (const side of [-1, 1]) {
    const tw = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 10, 28), M.black);
    tw.rotation.y = Math.PI / 2; tw.position.set(side * 0.215, 0.5, 0.0); ped.add(tw);
    tag(tw, "trim");
  }
  // радиопульты на задней части
  for (let k = 0; k < 2; k++) {
    const rp = new THREE.Group(); rp.position.set(0, 0.652, 0.36 + k * 0.13); ped.add(rp);
    const plate = box(0.38, 0.008, 0.11, M.black, 0, 0, 0, rp);
    const disp = radioDisplay(k ? "121.50" : "118.10");
    disp.rotation.x = -Math.PI / 2; disp.position.set(-0.05, 0.006, 0); rp.add(disp);
    for (const kx of [0.11, 0.155]) { const kn = cyl(0.016, 0.018, 0.018, M.bezel, kx, 0.012, 0, rp); }
    tag(rp, "radio");
  }
}
function radioDisplay(txt) {
  const c = makeCanvas(256, 64), g = c.getContext("2d");
  g.fillStyle = "#120a02"; g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#ff9a1a"; g.font = "700 46px monospace"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(txt, 128, 34);
  return new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.04), new THREE.MeshBasicMaterial({ map: canvasTexture(c), toneMapped: false }));
}

/* ----------------------------------------------------- Штурвалы и педали */
const yokes = [];
const pedals = [];
function buildYokes() {
  for (const side of [-1, 1]) {
    const col = new THREE.Group(); col.position.set(side * 0.6, 0.02, -0.5); cockpit.add(col);   // шарнир колонки у пола
    cyl(0.025, 0.035, 0.68, M.yoke, 0, 0.34, 0, col);
    const boot = cyl(0.06, 0.08, 0.1, M.rubber, 0, 0.05, 0, col);
    const wheel = new THREE.Group(); wheel.position.set(0, 0.7, 0.05); col.add(wheel);           // «рога»
    const hubMesh = box(0.07, 0.07, 0.07, M.yoke, 0, 0, 0, wheel);
    const bar = box(0.34, 0.03, 0.035, M.yoke, 0, 0.01, 0.02, wheel);
    for (const s of [-1, 1]) {
      const grip = cyl(0.018, 0.02, 0.13, M.yoke, s * 0.17, 0.06, 0.02, wheel);
      grip.rotation.z = s * -0.18;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 10), M.yoke); cap.position.set(s * 0.18, 0.125, 0.02); wheel.add(cap);
      const btn = cyl(0.007, 0.007, 0.01, s === side ? M.red : M.white, s * 0.185, 0.14, 0.02, wheel); // кнопка радиосвязи и триммер
    }
    placard("Ил-62", 0.06, 0.02, wheel, 0, 0, 0.037, { bg: "#2a2624", size: 130 });
    tag(col, "yoke", { drag: "yoke" });
    yokes.push({ col, wheel });
    // педали
    for (const s of [-1, 1]) {
      const p = new THREE.Group(); p.position.set(side * 0.6 + s * 0.12, 0.06, -0.72); cockpit.add(p);
      const plate = box(0.1, 0.2, 0.02, M.metal, 0, 0.08, 0, p); plate.rotation.x = -0.35;
      box(0.012, 0.012, 0.2, M.seatFrame, 0, 0.0, 0.1, p);
      tag(p, "pedals");
      pedals.push({ p, s });
    }
  }
}

/* ------------------------------------------------------------- Кресла */
function seat(x, z, rotY, id) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; cockpit.add(g);
  cyl(0.05, 0.08, 0.32, M.seatFrame, 0, 0.16, 0, g);
  box(0.52, 0.05, 0.5, M.seatFrame, 0, 0.33, 0, g);
  box(0.5, 0.1, 0.48, M.seat, 0, 0.4, 0, g);
  const back = box(0.5, 0.68, 0.12, M.seat, 0, 0.78, 0.25, g); back.rotation.x = -0.12;
  const head = box(0.3, 0.18, 0.1, M.seat, 0, 1.2, 0.3, g); head.rotation.x = -0.12;
  for (const s of [-1, 1]) {
    box(0.06, 0.06, 0.4, M.seatFrame, s * 0.29, 0.58, 0.03, g);
    box(0.05, 0.6, 0.012, new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 1 }), s * 0.13, 0.78, 0.18, g).rotation.x = -0.12; // ремни
  }
  tag(g, id);
  return g;
}

/* ------------------------------------------------------------ Верхний щиток */
const switches = [];
function buildOverhead() {
  const oh = new THREE.Group(); oh.position.set(0, 1.86, -0.22); oh.rotation.x = -0.36; cockpit.add(oh);
  const base = box(0.96, 0.05, 1.05, M.panel, 0, 0.025, 0, oh);
  tag(base, "overhead");
  const c = makeCanvas(1024, 1120), g = c.getContext("2d");
  g.fillStyle = "#4a7f83"; g.fillRect(0, 0, 1024, 1120);
  const sections = ["ОСВЕЩЕНИЕ", "ОБОГРЕВ", "ТОПЛИВО", "ГИДРОСИСТЕМА", "ПРОТИВОПОЖАРНАЯ"];
  g.strokeStyle = "#e9ece6"; g.lineWidth = 3; g.fillStyle = "#f2f2ea"; g.textAlign = "center";
  sections.forEach((t, i) => { const y = 40 + i * 220; g.strokeRect(20, y, 984, 200); g.font = "700 30px Arial"; g.fillText(t, 512, y + 34); });
  const named = [
    ["landing", "ФАРЫ"], ["nav", "АНО"], ["beacon", "МАЯК"], ["panel", "ПОДСВЕТ"], ["wipers", "ДВОРНИКИ"], ["heat", "ОБОГР. СТЁКОЛ"],
  ];
  const all = [];
  for (let row = 0; row < 5; row++) for (let colI = 0; colI < 6; colI++) {
    let id = null, label;
    if (row === 0) { [id, label] = named[colI] || []; }
    else if (row === 1) label = ["ПВД 1", "ПВД 2", "КРЫЛО", "ДВ. 1", "ДВ. 2", "ДВ. 3"][colI];
    else if (row === 2) label = ["НАСОС 1", "НАСОС 2", "НАСОС 3", "НАСОС 4", "КОЛЬЦЕВ.", "ПЕРЕКАЧ."][colI];
    else if (row === 3) label = ["НАСОС 1", "НАСОС 2", "РЕЗЕРВ", "ТОРМОЗ", "ПОВОРОТ", "АВАР."][colI];
    else label = ["ОГНЕТ. 1", "ОГНЕТ. 2", "ОГНЕТ. 3", "ОГНЕТ. 4", "КОНТР.", "СИГН."][colI];
    if (row === 0 && colI === 5) id = "heat";
    const x = 100 + colI * 164, y = 40 + row * 220 + 150;
    g.font = "700 22px Arial"; g.fillText(label, x, y + 36);
    all.push({ row, colI, id, label, u: x / 1024, v: y / 1120 });
  }
  const tex = canvasTexture(c);
  const face2 = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 1.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  face2.rotation.x = Math.PI / 2; face2.position.y = -0.001; oh.add(face2);
  tag(face2, "overhead", { keepMaterial: true });
  all.forEach((s) => {
    const sw = new THREE.Group();
    sw.position.set(-0.48 + s.u * 0.96, -0.002, 0.525 - s.v * 1.05);
    oh.add(sw);
    const plate = cyl(0.012, 0.012, 0.006, M.chrome, 0, -0.003, 0, sw, 12);
    const bat = new THREE.Group(); sw.add(bat);
    const stick = cyl(0.0035, 0.005, 0.035, s.row === 4 ? M.red : M.chrome, 0, -0.018, 0, bat, 8);
    s.bat = bat;
    s.on = s.id ? !!state.lights[s.id] : Math.random() < 0.6;
    bat.rotation.x = s.on ? -0.5 : 0.5;
    tag(sw, s.id ? "sw_" + s.id : "switch", { arg: switches.length });
    switches.push(s);
  });
  // плафоны освещения кабины
  for (const x of [-0.75, 0.75]) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x000000 }));
    dome.rotation.x = Math.PI; dome.position.set(x, 2.02, 0.7); cockpit.add(dome);
    domes.push(dome);
  }
}
const domes = [];

/* ----------------------------------------------------- Бортинженер и штурман */
let radarGauge, startButtons = [];
function buildStations() {
  // пульт бортинженера: правый борт за вторым пилотом, лицом к борту
  const fe = new THREE.Group(); fe.position.set(1.28, 1.05, 1.15); fe.rotation.y = -Math.PI / 2; cockpit.add(fe);
  const board = box(1.25, 0.95, 0.05, M.panel, 0, 0, 0, fe);
  tag(board, "engineer");
  box(1.25, 0.06, 0.38, M.panelDark, 0, -0.5, 0.17, fe);  // стол
  placard("ДВИГАТЕЛИ", 0.36, 0.035, fe, -0.3, 0.43, 0.03, { size: 120 });
  placard("ТОПЛИВНАЯ СИСТЕМА", 0.5, 0.035, fe, 0.3, 0.43, 0.03, { size: 120 });
  const rows = [
    ["ДАВЛ. МАСЛА", "кгс/см²", { min: 0, max: 8, a0: -135, a1: 135, major: 2, minor: 1, fmt: (x) => x, font: 20 }, (n) => (n > 1 ? 2.2 + n / 30 : 0)],
    ["ТЕМП. МАСЛА", "°C", { min: -50, max: 150, a0: -135, a1: 135, major: 50, minor: 25, fmt: (x) => x, font: 18 }, (n) => (n > 1 ? 40 + n * 0.5 : 5)],
    ["ВИБРАЦИЯ", "мм/с", { min: 0, max: 100, a0: -135, a1: 135, major: 20, minor: 10, fmt: (x) => x, red: [80, 100], font: 18 }, (n) => n * 0.18],
  ];
  rows.forEach(([label, unit, sc, f], ri) => {
    for (let i = 0; i < 4; i++) {
      tag(new Gauge("dial", 0.045, fe, -0.52 + i * 0.12, 0.3 - ri * 0.13, 0.032, { read: () => f(state.engines[i].n), prec: 2, label: ri ? "" : String(i + 1), unit: ri === 2 ? unit : unit, scale: sc }).group, "engineerGauges");
    }
    placard(label, 0.16, 0.025, fe, -0.52 + 4 * 0.12 - 0.04, 0.3 - ri * 0.13, 0.03, { size: 100 });
  });
  // кнопки запуска
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x22aa44, emissive: 0x000000 }));
    b.rotation.x = Math.PI / 2; b.position.set(-0.52 + i * 0.12, -0.12, 0.035); fe.add(b);
    placard("ЗАПУСК " + (i + 1), 0.1, 0.022, fe, -0.52 + i * 0.12, -0.165, 0.03, { size: 100 });
    tag(b, "start", { arg: i });
    startButtons.push(b);
  }
  // мнемосхема топливной системы
  const fc = makeCanvas(512, 384), g = fc.getContext("2d");
  g.fillStyle = "#1f3d3f"; g.fillRect(0, 0, 512, 384);
  g.strokeStyle = "#e9ece6"; g.lineWidth = 4; g.fillStyle = "#f2f2ea"; g.font = "700 20px Arial"; g.textAlign = "center";
  const tanks = [[40, 60, "БАК 1"], [150, 60, "БАК 2"], [292, 60, "БАК 3"], [402, 60, "БАК 4"], [196, 200, "ЦЕНТРОПЛАН"]];
  tanks.forEach(([x, y, t]) => { g.strokeRect(x, y, t.length > 6 ? 120 : 70, 70); g.fillText(t, x + (t.length > 6 ? 60 : 35), y + 42); });
  g.strokeStyle = "#ffb000"; g.lineWidth = 5;
  g.beginPath(); g.moveTo(75, 130); g.lineTo(75, 320); g.lineTo(437, 320); g.lineTo(437, 130); g.moveTo(185, 130); g.lineTo(185, 320); g.moveTo(327, 130); g.lineTo(327, 320); g.moveTo(256, 270); g.lineTo(256, 320); g.stroke();
  g.fillStyle = "#ffb000"; for (const x of [75, 185, 327, 437]) { g.beginPath(); g.arc(x, 350, 14, 0, 7); g.fill(); }
  g.fillStyle = "#f2f2ea"; g.font = "600 16px Arial"; g.fillText("к двигателям 1 · 2 · 3 · 4", 256, 378);
  const fuelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.375), new THREE.MeshBasicMaterial({ map: canvasTexture(fc), toneMapped: false }));
  fuelMesh.position.set(0.3, 0.17, 0.03); fe.add(fuelMesh);
  tag(fuelMesh, "fuelPanel");
  for (let i = 0; i < 3; i++) tag(new Gauge("dial", 0.045, fe, 0.14 + i * 0.16, -0.19, 0.032, { read: () => (i === 2 ? 27 + Math.sin(state.time / 3) * 0.2 : 205 + Math.sin(state.time + i) * 2), prec: 0.5,
    label: i === 2 ? "НАПРЯЖ." : "ГИДРО " + (i + 1), unit: i === 2 ? "В" : "кгс/см²",
    scale: i === 2 ? { min: 0, max: 30, a0: -135, a1: 135, major: 5, minor: 1, fmt: (x) => x, font: 19 } : { min: 0, max: 250, a0: -135, a1: 135, major: 50, minor: 25, fmt: (x) => x, font: 18 } }).group, "engineerGauges");
  seat(0.78, 1.15, -Math.PI / 2, "seatEngineer");

  // место штурмана: левый борт за командиром
  const nav = new THREE.Group(); nav.position.set(-1.26, 0, 1.1); nav.rotation.y = Math.PI / 2; cockpit.add(nav);
  const table = box(1.1, 0.04, 0.45, M.panelDark, 0, 0.74, 0.2, nav);
  tag(table, "navigator");
  box(1.1, 0.7, 0.05, M.panel, 0, 1.15, -0.02, nav);
  tag(new Gauge("hsi", 0.06, nav, 0.05, 1.3, 0.02, { read: () => [state.hdg, 0] }).group, "hsi");
  tag(new Gauge("clock", 0.045, nav, 0.22, 1.3, 0.02, { read: () => Math.floor(Date.now() / 1000) }).group, "clock");
  tag(new Gauge("dial", 0.05, nav, 0.38, 1.3, 0.02, { read: () => kmh() * (1 + state.alt / 45000) * Math.cos(state.gamma * DEG), prec: 0.5, label: "W", unit: "путевая, км/ч",
    scale: { min: 0, max: 1200, a0: -140, a1: 140, major: 200, minor: 100, fmt: (x) => x / 100, font: 18 } }).group, "groundSpeed");
  tag(new Gauge("alt", 0.05, nav, 0.05, 1.12, 0.02, { read: () => state.alt, prec: 1 }).group, "alt");
  placard("НАВИГАЦИЯ", 0.3, 0.035, nav, 0.22, 1.45, 0.03, { size: 120 });
  radarGauge = new Gauge("radar", 0.11, nav, -0.28, 1.17, 0.02, { read: () => state.time });
  radarGauge.update = function () { DRAW.radar(this.g, state.time * 1000); this.tex.needsUpdate = true; };
  radarGauge.g.fillStyle = "#020c04"; radarGauge.g.fillRect(0, 0, S, S);
  tag(radarGauge.group, "radar");
  // карта трассы АлСиб
  const mc = makeCanvas(1024, 640), m = mc.getContext("2d");
  m.fillStyle = "#efe6cc"; m.fillRect(0, 0, 1024, 640);
  m.strokeStyle = "#9fc3d9"; m.lineWidth = 6;
  for (const [x1, y1, x2, y2, x3, y3] of [[600, 640, 640, 420, 700, 260], [380, 640, 420, 470, 330, 330], [130, 640, 170, 500, 120, 360]]) { m.beginPath(); m.moveTo(x1, y1); m.quadraticCurveTo(x2, y2, x3, y3); m.stroke(); }
  m.fillStyle = "#bcd7e6"; m.fillRect(880, 0, 144, 640);
  const cities = [["Фэрбенкс", 960, 200], ["Уэлькаль", 840, 150], ["Марково", 760, 230], ["Сеймчан", 640, 270], ["Якутск", 470, 330], ["Киренск", 320, 410], ["Красноярск", 150, 470]];
  m.strokeStyle = "#c8261f"; m.lineWidth = 7; m.setLineDash([22, 12]);
  m.beginPath(); cities.forEach(([, x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y))); m.stroke(); m.setLineDash([]);
  m.font = "700 30px Arial"; m.textAlign = "center";
  cities.forEach(([t, x, y]) => { m.fillStyle = "#1b2440"; m.beginPath(); m.arc(x, y, 10, 0, 7); m.fill(); m.fillText(t, x, y - 22); });
  m.font = "700 40px Arial"; m.fillStyle = "#1b2440"; m.textAlign = "left"; m.fillText("Трасса Аляска — Сибирь, 1942–1945", 30, 60);
  const map = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), new THREE.MeshStandardMaterial({ map: canvasTexture(mc), roughness: 0.9 }));
  map.rotation.x = -Math.PI / 2 + 0.06; map.position.set(0.18, 0.765, 0.22); nav.add(map);
  tag(map, "map", { keepMaterial: true });
  // радиоместо с телеграфным ключом (бортрадист) — дальше по левому борту
  const ro = new THREE.Group(); ro.position.set(-1.26, 0, 2.15); ro.rotation.y = Math.PI / 2; cockpit.add(ro);
  box(0.8, 0.04, 0.4, M.panelDark, 0, 0.74, 0.18, ro);
  const radioBox = box(0.7, 0.42, 0.25, M.panelDark, 0, 1.0, 0.05, ro);
  tag(radioBox, "radioOp");
  for (let i = 0; i < 5; i++) cyl(0.02, 0.022, 0.03, M.bezel, -0.25 + i * 0.12, 0.95, 0.19, ro).rotation.x = Math.PI / 2;
  const dial = radioDisplay("8.364"); dial.position.set(0, 1.12, 0.18); ro.add(dial);
  const key = new THREE.Group(); key.position.set(0.1, 0.77, 0.25); ro.add(key);
  box(0.08, 0.012, 0.12, M.black, 0, 0, 0, key);
  const lever = box(0.012, 0.012, 0.1, M.chrome, 0, 0.02, 0.0, key);
  const kn = cyl(0.016, 0.016, 0.012, M.black, 0, 0.032, 0.045, key);
  tag(key, "morse");
  morseKey = lever;
  seat(-0.82, 1.1, Math.PI / 2, "seatNav");
  // огнетушитель и кислородная маска
  const ext = cyl(0.06, 0.06, 0.4, M.red, 1.35, 0.35, 2.55); tag(ext, "extinguisher");
  cyl(0.02, 0.02, 0.06, M.black, 1.35, 0.58, 2.55);
  for (const side of [-1, 1]) {
    const ox = box(0.14, 0.12, 0.08, M.panelDark, side * 1.2, 1.1, 0.25); tag(ox, "oxygen");
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8f55, roughness: 0.8 }));
    mask.rotation.z = side * Math.PI / 2; mask.position.set(side * 1.12, 1.1, 0.25); cockpit.add(mask); tag(mask, "oxygen");
  }
  // боковые пульты у окон
  for (const side of [-1, 1]) {
    const cons = box(0.3, 0.08, 0.9, M.panel, side * 1.08, 0.72, -0.05);
    tag(cons, "sideConsole");
    box(0.12, 0.02, 0.16, M.black, side * 1.08, 0.77, -0.2);      // пепельница эпохи
    const chk = placard("КАРТА ПРОВЕРОК", 0.2, 0.13, cockpit, side * 1.08, 0.775, 0.2, { bg: "#efe6cc", color: "#1b2440", size: 34 });
    chk.rotation.x = -Math.PI / 2; tag(chk, "checklist");
  }
}
let morseKey;

/* ======================================================================== МИР */
const world = new THREE.Group(); scene.add(world);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5b5d43, 1.0); scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.55); scene.add(ambient);
const interior = new THREE.PointLight(0xfff0d0, 0, 4, 1.5); interior.position.set(0, 1.8, 0.4); aircraft.add(interior);
const panelLight = new THREE.PointLight(0xffd8a0, 0, 2.2, 1.6); panelLight.position.set(0, 1.25, -0.3); aircraft.add(panelLight);
scene.fog = new THREE.Fog(0xbfd4ec, 3000, 30000);

const skyUniforms = { top: { value: new THREE.Color(0x2f6fd0) }, horizon: { value: new THREE.Color(0xcfe2f5) }, bottom: { value: new THREE.Color(0x8aa0b0) }, sunDir: { value: new THREE.Vector3(0.3, 0.5, -0.6).normalize() }, sunAmt: { value: 1 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
  vertexShader: "varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,0.)).xyz); gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }",
  fragmentShader: `varying vec3 vDir; uniform vec3 top, horizon, bottom, sunDir; uniform float sunAmt;
    void main(){ float h = vDir.y; vec3 c = h > 0. ? mix(horizon, top, pow(h, .55)) : mix(horizon, bottom, pow(-h, .4));
      float s = max(dot(vDir, sunDir), 0.); c += sunAmt * (vec3(1., .9, .7) * pow(s, 900.) * 6. + vec3(1., .8, .55) * pow(s, 12.) * .25);
      gl_FragColor = vec4(c, 1.); }`,
}));
sky.renderOrder = -1;
scene.add(sky);
const stars = (() => {
  const g = new THREE.BufferGeometry(), p = [];
  for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.9 + 0.05; v.normalize().multiplyScalar(55000); p.push(v.x, v.y, v.z); }
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  const s = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 }));
  s.visible = false; scene.add(s); return s;
})();

/* Земля: повторяющаяся текстура полей и леса; плоскость «едет» за самолётом. */
const TILE = 1600;
function groundTexture() {
  const c = makeCanvas(1024, 1024), g = c.getContext("2d");
  g.fillStyle = "#5d7a3a"; g.fillRect(0, 0, 1024, 1024);
  const rnd = mulberry(7);
  const cols = ["#6f8b42", "#88994e", "#a3a35a", "#4f6b33", "#7c8f48", "#94a35f"];
  for (let i = 0; i < 70; i++) { g.fillStyle = cols[(rnd() * cols.length) | 0]; g.save(); g.translate(rnd() * 1024, rnd() * 1024); g.rotate(rnd() * 0.6 - 0.3); g.fillRect(-60, -40, 80 + rnd() * 160, 50 + rnd() * 120); g.restore(); }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${30 + rnd() * 20},${55 + rnd() * 25},${25 + rnd() * 15},.85)`; g.beginPath(); g.arc(rnd() * 1024, rnd() * 1024, 6 + rnd() * 26, 0, 7); g.fill(); }
  g.strokeStyle = "rgba(170,150,110,.8)"; g.lineWidth = 4;
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(rnd() * 1024, 0); g.bezierCurveTo(rnd() * 1024, 340, rnd() * 1024, 680, rnd() * 1024, 1024); g.stroke(); }
  const t = canvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gtex = groundTexture(); gtex.repeat.set(40, 40);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 40, TILE * 40), new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; world.add(ground);
// Енисей — широкая лента к западу от аэропорта
const river = new THREE.Mesh(new THREE.PlaneGeometry(700, 120000), new THREE.MeshStandardMaterial({ color: 0x3f6f8f, roughness: 0.25, metalness: 0.1 }));
river.rotation.x = -Math.PI / 2; river.rotation.z = 0.25; river.position.set(-6500, 0.6, 0); world.add(river);

// ВПП 3000 × 60 м: взлёт в сторону −z (курс 360°)
const RWY_L = 3000, RWY_W = 60, RWY_Z = 0;
function runwayTexture() {
  const c = makeCanvas(256, 4096), g = c.getContext("2d");
  g.fillStyle = "#4a4c4f"; g.fillRect(0, 0, 256, 4096);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${60 + Math.random() * 40},${60 + Math.random() * 40},${60 + Math.random() * 40},.5)`; g.fillRect(Math.random() * 256, Math.random() * 4096, 2, 6); }
  g.fillStyle = "#eee";
  g.fillRect(6, 0, 5, 4096); g.fillRect(245, 0, 5, 4096);
  for (let y = 300; y < 3800; y += 90) g.fillRect(125, y, 6, 50);
  for (const y0 of [20, 3940]) for (let i = 0; i < 8; i++) g.fillRect(22 + i * 28 + (i > 3 ? 10 : 0), y0, 14, 130);
  g.font = "700 120px Arial"; g.textAlign = "center";
  g.save(); g.translate(128, 3780); g.fillText("36", 0, 0); g.restore();
  g.save(); g.translate(128, 320); g.rotate(Math.PI); g.fillText("18", 0, 0); g.restore();
  for (const y of [700, 3390]) { g.fillRect(60, y, 30, 120); g.fillRect(166, y, 30, 120); }
  const t = canvasTexture(c); return t;
}
const runway = new THREE.Mesh(new THREE.PlaneGeometry(RWY_W, RWY_L), new THREE.MeshStandardMaterial({ map: runwayTexture(), roughness: 0.9 }));
runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0.15, RWY_Z); world.add(runway);
const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 600), new THREE.MeshStandardMaterial({ color: 0x77797a, roughness: 1 }));
apron.rotation.x = -Math.PI / 2; apron.position.set(260, 0.1, 300); world.add(apron);
const taxi = new THREE.Mesh(new THREE.PlaneGeometry(25, 150), new THREE.MeshStandardMaterial({ color: 0x5a5c5e, roughness: 1 }));
taxi.rotation.x = -Math.PI / 2; taxi.rotation.z = Math.PI / 2; taxi.position.set(105, 0.12, 300); world.add(taxi);
// огни ВПП и подхода
const lightMats = {
  white: new THREE.MeshBasicMaterial({ color: 0xfff2c8 }), green: new THREE.MeshBasicMaterial({ color: 0x44ff66 }), red: new THREE.MeshBasicMaterial({ color: 0xff3322 }),
};
function lightRow(points, mat, size = 0.9) {
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 6, 4), mat, points.length);
  const m4 = new THREE.Matrix4();
  points.forEach((p, i) => { m4.makeTranslation(p[0], 0.6, p[1]); im.setMatrixAt(i, m4); });
  world.add(im); return im;
}
const edge = [];
for (let z = -RWY_L / 2; z <= RWY_L / 2; z += 60) edge.push([-RWY_W / 2 - 2, z], [RWY_W / 2 + 2, z]);
const runwayLights = [lightRow(edge, lightMats.white)];
const thr = [], end = [], appr = [];
for (let x = -RWY_W / 2; x <= RWY_W / 2; x += 4) { thr.push([x, RWY_L / 2 + 3]); end.push([x, -RWY_L / 2 - 3]); }
for (let z = RWY_L / 2 + 60; z < RWY_L / 2 + 900; z += 30) { appr.push([0, z]); if ((z - RWY_L / 2) % 150 < 30) for (let x = -15; x <= 15; x += 5) appr.push([x, z]); }
runwayLights.push(lightRow(thr, lightMats.green, 1.1), lightRow(end, lightMats.red, 1.1), lightRow(appr, lightMats.white, 1.1));
// аэровокзал, вышка, ангары
function building(w, h, d, x, z, color, rot = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  b.position.set(x, h / 2, z); b.rotation.y = rot; world.add(b); return b;
}
building(60, 18, 220, 430, 300, 0xd8d4c8);
building(14, 34, 14, 360, 520, 0xcfcac0);
const towerTop = new THREE.Mesh(new THREE.CylinderGeometry(11, 9, 8, 8), new THREE.MeshStandardMaterial({ color: 0x2a4c5c, roughness: 0.2, metalness: 0.4 }));
towerTop.position.set(360, 38, 520); world.add(towerTop);
for (let i = 0; i < 3; i++) building(70, 22, 60, 300 + i * 85, -350, 0x9aa3a8);
(() => { // вывеска на аэровокзале
  const c = makeCanvas(1024, 128), g = c.getContext("2d");
  g.fillStyle = "#d8d4c8"; g.fillRect(0, 0, 1024, 128); g.fillStyle = "#1d4fa0"; g.font = "700 96px Arial"; g.textAlign = "center"; g.fillText("КРАСНОЯРСК", 512, 100);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(160, 20), new THREE.MeshBasicMaterial({ map: canvasTexture(c) }));
  s.position.set(399.5, 12, 300); s.rotation.y = -Math.PI / 2; world.add(s);
})();
// лес вокруг аэродрома
(() => {
  const rnd = mulberry(42), N = coarse ? 1400 : 3000;
  const tree = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 16, 6), new THREE.MeshStandardMaterial({ color: 0x2f4a24, roughness: 1 }), N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  let k = 0;
  while (k < N) {
    const x = (rnd() - 0.5) * 9000, z = (rnd() - 0.5) * 9000;
    if (Math.abs(x) < 220 && Math.abs(z) < 2600) continue;   // полоса и подходы
    if (x > 150 && x < 600 && z > -500 && z < 700) continue;   // перрон и здания
    const s = 0.7 + rnd() * 0.8; sc.set(s, s * (0.8 + rnd() * 0.5), s);
    m4.compose(new THREE.Vector3(x, 8 * sc.y, z), q, sc); tree.setMatrixAt(k++, m4);
  }
  world.add(tree);
})();
// сопки на горизонте (кольцо следует за самолётом)
const hills = (() => {
  const g = new THREE.CylinderGeometry(22000, 22000, 1, 128, 1, true);
  const pos = g.attributes.position, rnd = mulberry(3);
  const h = Array.from({ length: 129 }, (_, i) => 500 + 900 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11)) + rnd() * 250);
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, h[i % 129]); else pos.setY(i, -50);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x41573f, roughness: 1, side: THREE.BackSide }));
  world.add(m); return m;
})();
// облака
const clouds = (() => {
  const c = makeCanvas(128, 128), g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62); grd.addColorStop(0, "rgba(255,255,255,.95)"); grd.addColorStop(0.6, "rgba(255,255,255,.55)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const mat = new THREE.SpriteMaterial({ map: canvasTexture(c), transparent: true, depthWrite: false, opacity: 0.85 });
  const list = [], rnd = mulberry(11);
  for (let i = 0; i < 70; i++) {
    const s = new THREE.Sprite(mat); const sz = 500 + rnd() * 900; s.scale.set(sz * 1.8, sz * 0.7, 1);
    s.position.set((rnd() - 0.5) * 16000, 1500 + rnd() * 900, (rnd() - 0.5) * 16000); world.add(s); list.push(s);
  }
  return list;
})();
// огни города ночью (Красноярск — к юго-западу)
const cityLights = (() => {
  const g = new THREE.BufferGeometry(), p = [], rnd = mulberry(5);
  for (let i = 0; i < 4000; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 7000; p.push(-9000 + Math.cos(a) * r, 2, 9000 + Math.sin(a) * r * 0.6); }
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc47a, size: 2.2, sizeAttenuation: false }));
  pts.visible = false; world.add(pts); return pts;
})();
// посадочные фары
const landingLight = new THREE.SpotLight(0xfff6e0, 0, 1800, 0.22, 0.5, 1.2);
landingLight.position.set(0, -2.5, -6); aircraft.add(landingLight); aircraft.add(landingLight.target); landingLight.target.position.set(0, -60, -400);

function setNight(on) {
  state.night = on;
  sun.intensity = on ? 0.05 : 2.4;
  hemi.intensity = on ? 0.06 : 1.0;
  ambient.intensity = on ? 0.06 : 0.55;
  skyUniforms.top.value.set(on ? 0x020713 : 0x2f6fd0);
  skyUniforms.horizon.value.set(on ? 0x0c1a33 : 0xcfe2f5);
  skyUniforms.bottom.value.set(on ? 0x05080d : 0x8aa0b0);
  skyUniforms.sunAmt.value = on ? 0 : 1;
  scene.fog.color.set(on ? 0x07101f : 0xbfd4ec);
  stars.visible = on; cityLights.visible = on;
  clouds.forEach((c) => (c.material.opacity = on ? 0.18 : 0.85));
  runwayLights.forEach((l) => (l.visible = true));
  Object.values(lightMats).forEach((m) => (m.color.multiplyScalar(1)));
  applyLights();
}
function applyLights() {
  const L = state.lights, night = state.night;
  landingLight.intensity = L.landing ? (night ? 60 : 8) : 0;
  panelLight.intensity = L.panel ? (night ? 1.6 : 0.6) : night ? 0.15 : 0;
  interior.intensity = night ? (L.panel ? 0.6 : 0.12) : 0;
  domes.forEach((d) => d.material.emissive.setHex(night && L.panel ? 0xfff0c0 : 0x000000));
  const dim = night ? (L.panel ? 0.95 : 0.55) : 1;
  gauges.forEach((g) => g.mat.color.setScalar(dim));
}

/* =========================================================== ОПИСАНИЯ */
info("yoke", "Пилотирование", "Штурвал", `<p>Штурвал управляет рулём высоты и элеронами: <b>от себя</b> — нос опускается, <b>на себя</b> — поднимается, поворот «рогов» — крен. Штурвалы командира и второго пилота связаны и двигаются вместе.</p><p>Рули Ил-62 отклоняются тросовой проводкой без гидроусилителей — пилоту помогают сервокомпенсаторы, но штурвал всё равно требует силы.</p>`, { hint: "Потяните штурвал мышью или пальцем" });
info("pedals", "Пилотирование", "Педали", `<p>Педали отклоняют руль направления, а на земле поворачивают переднюю стойку шасси. Нажатие на верхнюю часть педали включает тормоза колёс.</p>`);
info("throttle", "Двигатели", "Рычаги управления двигателями (РУД)", `<p>Четыре рычага — по одному на каждый двигатель в хвосте самолёта. Назад до упора — <b>малый газ</b> (МГ), вперёд — <b>взлётный режим</b>. Обычно их двигают все вместе одной рукой.</p><p>Красные рычажки на 1-м и 4-м РУД — реверс: на Ил-62 обратная тяга есть только у крайних двигателей.</p>`, { hint: "Потяните рычаги вперёд — стрелки тахометров пойдут вверх (сначала запустите двигатели у бортинженера или начните полёт)" });
info("tacho", "Двигатели", "Тахометры двигателей", `<p>Показывают обороты каждого из четырёх двигателей в процентах от максимальных. На малом газу — примерно 60 %, на взлётном режиме — около 100 %. Красная дуга — запретная зона.</p>`);
info("egt", "Двигатели", "Указатели температуры газов", `<p>Температура газов за турбиной — главный показатель «здоровья» двигателя. Если стрелка подходит к красной черте, режим уменьшают.</p>`);
info("enginePanel", "Двигатели", "Центральная панель", `<p>Посередине доски — приборы двигателей, видные обоим пилотам: тахометры, температура газов, топливомер, указатель закрылков и табло сигнализации.</p>`);
info("speed", "Пилотирование", "Указатель скорости", `<p>Широкая стрелка — приборная скорость относительно воздуха, тонкая жёлтая — истинная (на высоте она больше). Шкала — в сотнях км/ч.</p><p>Ил-62 отрывается от полосы примерно на 300 км/ч, а в крейсерском полёте летит около 850–900 км/ч.</p>`);
info("alt", "Пилотирование", "Высотомер", `<p>Большая стрелка показывает сотни метров, маленькая — километры. В окошке — давление аэродрома в миллиметрах ртутного столба: пилот выставляет его перед вылетом, и тогда на земле прибор показывает ноль.</p><p>Обычная высота полёта Ил-62 — 10–12 км.</p>`);
info("attitude", "Пилотирование", "Авиагоризонт (командно-пилотажный прибор)", `<p>Показывает положение самолёта относительно горизонта: голубое — небо, коричневое — земля. Линии со цифрами — угол тангажа.</p><p>В советских авиагоризонтах крен показывает наклоняющийся силуэт самолёта — как будто вы смотрите на свой самолёт сзади. В облаках, когда земли не видно, пилот летит по этому прибору.</p>`);
info("hsi", "Навигация", "Плановый навигационный прибор", `<p>Картушка показывает курс — куда смотрит нос самолёта: <b>С</b> — север (0°), <b>В</b> — восток (90°), <b>Ю</b> — юг (180°), <b>З</b> — запад (270°). Цифры — десятки градусов. Жёлтая стрелка — заданный курс.</p>`);
info("vario", "Пилотирование", "Вариометр", `<p>Показывает вертикальную скорость — насколько быстро самолёт набирает высоту или снижается, в метрах в секунду. Перед касанием полосы стрелка должна быть близко к нулю: тогда посадка мягкая.</p>`);
info("clock", "Навигация", "Авиационные часы", `<p>Часы с секундомером и счётчиком времени полёта — здесь они идут по-настоящему. По времени штурман рассчитывает, где находится самолёт, особенно над тайгой и океаном, где нет ориентиров.</p>`);
info("mach", "Пилотирование", "Указатель числа М", `<p>Число Маха — скорость в долях скорости звука. Реактивные лайнеры вроде Ил-62 летят примерно на 0,8 М: быстрее нельзя, начинаются волновые явления на крыле.</p>`);
info("radioAlt", "Пилотирование", "Радиовысотомер", `<p>Измеряет высоту над землёй прямо под самолётом радиолучом — до 750 м. Нужен при заходе на посадку, когда важна точная высота над полосой, а не над уровнем моря.</p>`);
info("annunciator", "Системы", "Табло сигнализации", `<p>Лампы загораются, когда экипажу нужно обратить внимание: <b style="color:#ff6b6b">красные</b> — опасность, <b style="color:#ffb000">жёлтые</b> — предупреждение, <b style="color:#4be39a">зелёные</b> — система включена.</p>`);
info("masterWarn", "Системы", "Лампы «Отказ» и «Опасность»", `<p>Главная сигнализация — прямо перед глазами пилотов на козырьке. Если где-то в самолёте неисправность, загорается лампа, и пилот сразу смотрит на табло.</p>`);
info("gear", "Пилотирование", "Кран шасси", `<p>Убирает и выпускает шасси. Три лампы показывают положение стоек: <b style="color:#4be39a">зелёные</b> — выпущены и стоят на замках, <b style="color:#ff6b6b">красные</b> — в движении, погасли — убраны.</p><p>У Ил-62 есть и четвёртая, хвостовая опора: её выпускают на стоянке, иначе при загрузке самолёт с тяжёлыми двигателями в хвосте мог бы сесть на хвост.</p>`, { hint: "Нажмите, чтобы убрать или выпустить шасси" });
info("flaps", "Пилотирование", "Кран закрылков", `<p>Закрылки выдвигаются из задней кромки крыла и увеличивают подъёмную силу на малой скорости. На взлёте их выпускают немного, на посадке — больше. В модели три положения: 0°, 15° и 30°.</p>`, { hint: "Нажмите, чтобы переключить положение" });
info("flapsInd", "Пилотирование", "Указатель закрылков", `<p>Показывает, на сколько градусов выпущены закрылки. Закрылки выходят не мгновенно — стрелка догоняет положение крана за несколько секунд.</p>`);
info("fuelGauge", "Системы", "Топливомер", `<p>Сколько топлива осталось на борту, в тоннах. В долгом рейсе Ил-62 сжигает десятки тонн керосина; бортинженер следит, чтобы баки расходовались равномерно.</p>`);
info("brake", "Пилотирование", "Стояночный тормоз", `<p>Держит самолёт на месте на стоянке. Перед разбегом его обязательно снимают — иначе самолёт не тронется, а колёса перегреются.</p>`, { hint: "Нажмите, чтобы включить или снять" });
info("spoilers", "Пилотирование", "Рычаг интерцепторов", `<p>Интерцепторы — щитки на верхней стороне крыла. После посадки они поднимаются, «гасят» подъёмную силу и помогают быстрее остановиться, а в полёте — быстро снизиться.</p>`, { hint: "Нажмите, чтобы выпустить или убрать" });
info("trim", "Пилотирование", "Штурвальчик триммера", `<p>Триммер снимает усилие со штурвала: пилот крутит колесо, и самолёт сам держит нужный угол, не требуя всё время тянуть штурвал.</p>`);
info("pedestal", "Пилотирование", "Центральный пульт", `<p>Между пилотами — РУДы, кран закрылков, интерцепторы, стояночный тормоз и радиопульты. До всего этого одинаково удобно дотянуться и командиру, и второму пилоту.</p>`);
info("radio", "Навигация", "Пульт радиостанции", `<p>По УКВ-радио пилоты говорят с диспетчером. Частота набирается ручками, цифры светятся в окошке. 121,5 МГц — аварийная частота, которую слушают все.</p>`);
info("autopilot", "Пилотирование", "Пульт автопилота", `<p>Автопилот удерживает высоту и курс, освобождая руки пилотов в многочасовом полёте. Кнопки включают разные режимы: стабилизацию, удержание высоты, удержание курса.</p>`);
info("apButton", "Пилотирование", "Кнопка «АП»", `<p>Включает автопилот. В режиме полёта нажмите её: самолёт выровняется, будет держать текущую высоту и курс.</p>`, { hint: "В полёте нажмите — или клавиша P" });
info("glareshield", "Кабина", "Козырёк приборной доски", `<p>Защищает приборы от солнечных бликов. На нём — пульт автопилота и главные сигнальные лампы.</p>`);
info("panel", "Пилотирование", "Приборная доска пилотов", `<p>Перед каждым пилотом — одинаковый набор: скорость, авиагоризонт, высота, курс, вертикальная скорость, часы. Так любой из пилотов может вести самолёт, а если откажет прибор у одного — работает у другого.</p>`);
info("overhead", "Системы", "Верхний щиток", `<p>Над головой пилотов — переключатели систем: освещение, обогрев стёкол и приёмников воздушного давления, топливные и гидравлические насосы, противопожарная система.</p>`, { hint: "Пощёлкайте тумблерами: фары, подсвет и дворники работают" });
info("switch", "Системы", "Тумблер", `<p>Обычный тумблер щитка: вверх — включено, вниз — выключено. Противопожарные тумблеры — с красными рычажками, чтобы их не перепутать.</p>`, { hint: "Нажмите, чтобы переключить" });
info("sw_landing", "Системы", "Тумблер «Фары»", `<p>Включает посадочные фары: они освещают полосу при посадке ночью. Включите режим «Ночь» и посмотрите вперёд.</p>`, { hint: "Нажмите, чтобы включить фары" });
info("sw_nav", "Системы", "Аэронавигационные огни (АНО)", `<p>Красный огонь на левом крыле, зелёный — на правом, белый — на хвосте. По ним другие экипажи ночью понимают, куда летит самолёт.</p>`);
info("sw_beacon", "Системы", "Проблесковый маяк", `<p>Красная мигалка на фюзеляже: включается перед запуском двигателей и предупреждает всех вокруг — у самолёта опасно.</p>`);
info("sw_panel", "Системы", "Подсвет приборов", `<p>Включает подсветку приборов и плафоны кабины — пригодится ночью.</p>`, { hint: "Нажмите и включите режим «Ночь»" });
info("sw_wipers", "Системы", "Стеклоочистители", `<p>Дворники на лобовых стёклах: в дождь на взлёте и посадке без них ничего не видно.</p>`, { hint: "Нажмите — дворники заработают" });
info("sw_heat", "Системы", "Обогрев стёкол", `<p>Электрообогрев не даёт стёклам запотевать и обледеневать — а ещё делает их прочнее при ударе птицы.</p>`);
info("visor", "Кабина", "Солнцезащитный щиток", `<p>Тонированная шторка: опускается, когда солнце светит прямо в глаза.</p>`);
info("engineer", "Экипаж", "Пульт бортинженера", `<p>Бортинженер следит за двигателями, топливом, гидравликой и электричеством. На Ил-62 его место — за вторым пилотом, лицом к правому борту.</p>`, { hint: "Нажмите кнопки «ЗАПУСК» — двигатели оживут" });
info("engineerGauges", "Двигатели", "Приборы бортинженера", `<p>По каждому двигателю — давление и температура масла, вибрация; ниже — давление в гидросистемах и напряжение бортовой сети. Пилотам эти цифры не нужны каждую секунду, поэтому они у бортинженера.</p>`);
info("start", "Двигатели", "Кнопки запуска двигателей", `<p>Двигатели запускают по очереди. Стартер раскручивает вал, затем подаётся топливо, и двигатель выходит на малый газ — около 60 % оборотов. Следите за тахометрами на центральной панели!</p>`, { hint: "Нажмите кнопку — двигатель запустится (включите звук)" });
info("fuelPanel", "Системы", "Топливная мнемосхема", `<p>Схема баков и трубопроводов. Бортинженер переключает насосы так, чтобы топливо расходовалось равномерно и самолёт оставался сбалансированным.</p>`);
info("navigator", "Экипаж", "Место штурмана", `<p>Штурман ведёт самолёт по маршруту: рассчитывает курс, время и расход топлива, следит за радиолокатором. На столе — карта трассы Аляска — Сибирь.</p>`);
info("groundSpeed", "Навигация", "Указатель путевой скорости", `<p>Путевая скорость — скорость относительно земли. Она отличается от воздушной на величину ветра: со встречным ветром самолёт летит над землёй медленнее. По ней штурман считает, когда самолёт придёт в точку маршрута.</p>`);
info("radar", "Навигация", "Экран радиолокатора", `<p>Радиолокатор «видит» грозовые облака и очертания местности впереди. Яркие пятна — места, которые лучше облететь.</p>`);
info("map", "Навигация", "Карта трассы АлСиб", `<p>По Красноярской воздушной трассе в 1942–1945 годах перегоняли самолёты из США: от Фэрбенкса через Уэлькаль, Марково, Сеймчан, Якутск и Киренск — в Красноярск. Об этой трассе рассказывает наш музей.</p>`);
info("radioOp", "Экипаж", "Место бортрадиста", `<p>Бортрадист держал дальнюю связь — в том числе азбукой Морзе. Позже связь стала проще, и эта профессия ушла из экипажей.</p>`, { hint: "Нажмите на телеграфный ключ (включите звук)" });
info("morse", "Экипаж", "Телеграфный ключ", `<p>Короткое нажатие — точка, длинное — тире. Сигнал бедствия SOS: три точки, три тире, три точки — «· · · — — — · · ·».</p>`, { hint: "Нажимайте и держите — ключ пищит, пока нажат" });
info("seatCaptain", "Экипаж", "Кресло командира", `<p>Левое кресло — командира воздушного судна (КВС). Кресло регулируется, чтобы глаза пилота были на расчётной высоте: так он одновременно видит приборы и полосу.</p>`);
info("seatCopilot", "Экипаж", "Кресло второго пилота", `<p>Правое кресло. Второй пилот ведёт радиосвязь, читает карту проверок и в любой момент готов взять управление.</p>`);
info("seatEngineer", "Экипаж", "Кресло бортинженера", `<p>Вращающееся кресло: на взлёте бортинженер поворачивается вперёд и держит руку на РУДах, а в полёте — к своему пульту.</p>`);
info("seatNav", "Экипаж", "Кресло штурмана", `<p>Рабочее место штурмана — со столом для карт и навигационными приборами.</p>`);
info("sideConsole", "Кабина", "Боковой пульт", `<p>У окна — кислородная маска, держатель карт и пепельница: в 1960-е курить в кабине ещё разрешалось.</p>`);
info("checklist", "Экипаж", "Карта контрольных проверок", `<p>Перед каждым этапом полёта экипаж читает карту вслух: один читает пункт, другой проверяет и отвечает.</p><ul><li>Стояночный тормоз — включён</li><li>Топливо — проверено</li><li>Закрылки — 15°, выпущены</li><li>Триммеры — взлётное положение</li><li>Двигатели — запущены, параметры в норме</li><li>Стояночный тормоз — снят</li></ul>`);
info("oxygen", "Системы", "Кислородная маска", `<p>Если на высоте кабина разгерметизируется, экипаж за несколько секунд надевает маски — на 11 км воздух слишком разрежен, чтобы дышать.</p>`);
info("extinguisher", "Системы", "Огнетушитель", `<p>Ручной огнетушитель на случай пожара в кабине. Для двигателей — отдельная система с тумблерами на верхнем щитке.</p>`);
info("door", "Кабина", "Дверь в салон", `<p>За ней — пассажирский салон: Ил-62 брал на борт больше 150 пассажиров и летал без посадки на тысячи километров.</p>`);
info("windshield", "Кабина", "Лобовые стёкла", `<p>Многослойные стёкла с электрообогревом: не запотевают и выдерживают удар птицы на большой скорости.</p>`);

const VIEWS = [
  { id: "captain", label: "Командир", pos: [-0.6, 1.2, 0.18], yaw: 0, pitch: -0.2 },
  { id: "copilot", label: "Второй пилот", pos: [0.6, 1.2, 0.18], yaw: 0, pitch: -0.2 },
  { id: "pedestal", label: "Пульт", pos: [0, 1.28, 0.42], yaw: 0, pitch: -1.05, fov: 58 },
  { id: "overhead", label: "Верхний щиток", pos: [0, 1.22, 0.12], yaw: 0, pitch: 1.3, fov: 70 },
  { id: "engineer", label: "Бортинженер", pos: [0.62, 1.22, 1.15], yaw: -Math.PI / 2, pitch: -0.12 },
  { id: "navigator", label: "Штурман", pos: [-0.65, 1.25, 1.1], yaw: Math.PI / 2, pitch: -0.4 },
  { id: "radio", label: "Бортрадист", pos: [-0.7, 1.22, 2.15], yaw: Math.PI / 2, pitch: -0.4 },
  { id: "overview", label: "Общий вид", pos: [0, 1.62, 2.3], yaw: 0, pitch: -0.22, fov: 72 },
];

/* ================================================================= СБОРКА */
buildShell();
buildNose();
buildPanel();
buildPedestal();
buildYokes();
seat(-0.6, 0.38, 0, "seatCaptain");
seat(0.6, 0.38, 0, "seatCopilot");
buildOverhead();
buildStations();
tag(windshield, "windshield", { keepMaterial: true });
// стеклоочистители снаружи центральных стёкол: группа в плоскости стекла, дворник качается вокруг нормали
const wipers = [];
for (const [i, j, side] of [[2, 3, -1], [3, 4, 1]]) {
  const sm = sill[i].clone().lerp(sill[j], 0.5), tm = topRing[i].clone().lerp(topRing[j], 0.5);
  const u = sill[j].clone().sub(sill[i]).normalize(), w = tm.clone().sub(sm).normalize();
  const n = new THREE.Vector3().crossVectors(u, w).normalize();
  if (n.z > 0) n.negate();                                 // наружу — вперёд
  const piv = new THREE.Group();
  piv.position.copy(sm).addScaledVector(n, 0.03).addScaledVector(w, 0.025).addScaledVector(u, side * 0.17);
  piv.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, w, n.clone().negate()));
  cockpit.add(piv);
  const arm = new THREE.Group(); piv.add(arm);
  box(0.007, 0.34, 0.006, M.bezel, 0, 0.17, 0, arm);
  box(0.012, 0.3, 0.01, M.rubber, 0.008, 0.19, 0.003, arm);
  wipers.push({ arm, side });
}

/* ========================================================== КАМЕРА И ВЗГЛЯД */
const view = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 62, anim: null, current: "captain" };
function goTo(target, dur = 0.9) {
  const from = { pos: view.pos.clone(), yaw: view.yaw, pitch: view.pitch, fov: view.fov };
  let dy = target.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  view.anim = { from, to: { pos: new THREE.Vector3(...target.pos), yaw: from.yaw + dy, pitch: target.pitch, fov: target.fov || 62 }, t: 0, dur: reduceMotion ? 0.01 : dur };
}
function setView(id) {
  const v = VIEWS.find((x) => x.id === id); if (!v) return;
  view.current = id; goTo(v);
  viewsNav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === id));
}
/** Подлететь камерой к элементу и посмотреть на него. */
function focusOn(obj) {
  const wp = new THREE.Vector3(); obj.getWorldPosition(wp);
  const local = aircraft.worldToLocal(wp.clone());
  const camLocal = view.pos.clone();
  let dir = local.clone().sub(camLocal);
  const dist = dir.length();
  dir.normalize();
  const want = clamp(dist, 0.35, 0.75);
  const newPos = dist > want ? local.clone().sub(dir.clone().multiplyScalar(want)) : camLocal;
  // не выходить за кабину
  newPos.x = clamp(newPos.x, -1.15, 1.15); newPos.y = clamp(newPos.y, 0.6, 1.85); newPos.z = clamp(newPos.z, -0.55, 2.6);
  const d = local.clone().sub(newPos).normalize();
  goTo({ pos: newPos.toArray(), yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)), fov: 55 }, 0.8);
}

/* ============================================================ ВЗАИМОДЕЙСТВИЕ */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null, drag = null;
const tooltip = $("[data-tooltip]");
const infoBox = $("#pit-info");

function pick(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  ray.far = 6;
  const hit = ray.intersectObjects(pickables, false)[0];
  return hit ? hit.object : null;
}
function setHover(m) {
  if (hovered === m) return;
  const id = m && m.userData.info;
  pickables.forEach((p) => { if (p.material && p.material.emissive && p.userData.hl) { p.material.emissive.copy(p.userData.hl); p.userData.hl = null; } });
  hovered = m;
  if (m && id) {
    pickables.forEach((p) => {
      if (p.userData.info === id && p.userData.arg === m.userData.arg && p.material && p.material.emissive && !p.userData.lamp) {
        p.userData.hl = p.material.emissive.clone(); p.material.emissive.setHex(0x553300);
      }
    });
    canvas.classList.add("is-pointer");
  } else canvas.classList.remove("is-pointer");
}
function showInfo(id) {
  const d = INFO[id]; if (!d) return;
  infoBox.hidden = false;
  $("[data-info-group]").textContent = d.group;
  $("[data-info-title]").textContent = d.title;
  $("[data-info-text]").innerHTML = d.text;
  const hint = $("[data-info-hint]");
  hint.hidden = !d.hint; hint.textContent = d.hint ? "✋ " + d.hint : "";
}

/* Действия при щелчке */
function click(m) {
  const id = m.userData.info;
  audio.click();
  if (id === "gear") toggleGear();
  else if (id === "flaps") cycleFlaps();
  else if (id === "brake") { state.brake = !state.brake; toast(state.brake ? "Стояночный тормоз включён" : "Стояночный тормоз снят"); }
  else if (id === "spoilers") { state.spoilers = !state.spoilers; }
  else if (id === "apButton") toggleAP();
  else if (id === "start") startEngine(m.userData.arg);
  else if (id === "switch" || id.startsWith("sw_")) toggleSwitch(m.userData.arg);
  showInfo(id);
}
function toggleSwitch(i) {
  const s = switches[i]; if (!s) return;
  s.on = !s.on;
  if (s.id) { state.lights[s.id] = s.on; applyLights(); }
}
function toggleGear() {
  if (state.onGround && state.mode === "fly" && state.gearTarget === 1) { toast("На земле шасси не убираются — блокировка", "bad"); return; }
  state.gearTarget = state.gearTarget ? 0 : 1;
  toast(state.gearTarget ? "Шасси выпускаются" : "Шасси убираются");
}
function cycleFlaps() { state.flaps = state.flaps === 0 ? 15 : state.flaps === 15 ? 30 : 0; toast("Закрылки: " + state.flaps + "°"); }
function toggleAP() {
  if (state.mode !== "fly" || state.onGround) { state.ap = !state.ap; toast(state.ap ? "Автопилот включён (работает в полёте)" : "Автопилот выключен"); return; }
  state.ap = !state.ap;
  if (state.ap) { state.apAlt = state.alt; state.apHdg = state.hdg; }
  toast(state.ap ? `Автопилот: держу ${Math.round(state.apAlt)} м, курс ${Math.round(state.apHdg)}°` : "Автопилот выключен");
}
function startEngine(i) {
  const e = state.engines[i];
  if (e.running) { toast(`Двигатель ${i + 1} уже работает`); return; }
  e.running = true; e.starting = 1;
  toast(`Запуск двигателя ${i + 1}…`);
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  audio.unlock();
  const m = pick(e.clientX, e.clientY);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: 0, target: m, kind: m && m.userData.drag ? m.userData.drag : "look",
    yaw: view.yaw, pitch: view.pitch, start: { ...state.input }, thr: state.throttle };
  if (m && m.userData.info === "morse") { drag.kind = "morse"; audio.tone(true); morseKey.rotation.x = 0.12; }
  if (drag.kind === "look") canvas.classList.add("is-grabbing");
  view.anim = null;
});
canvas.addEventListener("pointermove", (e) => {
  if (pinch.active) return;
  if (!drag) {
    if (e.pointerType === "mouse") {
      const m = pick(e.clientX, e.clientY);
      setHover(m);
      if (m && INFO[m.userData.info]) {
        tooltip.hidden = false; tooltip.textContent = INFO[m.userData.info].title;
        const r = app.getBoundingClientRect(); tooltip.style.left = e.clientX - r.left + "px"; tooltip.style.top = e.clientY - r.top + "px";
      } else tooltip.hidden = true;
    }
    return;
  }
  if (e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.kind === "look") {
    const k = 0.0045 * (view.fov / 62);
    view.yaw = drag.yaw + dx * k;
    view.pitch = clamp(drag.pitch + dy * k, -1.35, 1.35);
  } else if (drag.kind === "yoke") {
    state.input.roll = clamp(drag.start.roll + dx / 140, -1, 1);
    state.input.pitch = clamp(drag.start.pitch + dy / 140, -1, 1); // вниз по экрану — на себя
    drag.holding = true;
  } else if (drag.kind === "throttle") {
    setThrottle(drag.thr - dy / 220);
  }
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  canvas.classList.remove("is-grabbing");
  if (drag.kind === "morse") { audio.tone(false); morseKey.rotation.x = 0; }
  if (drag.moved < 6 && drag.target) click(drag.target);
  else if (drag.target && drag.kind !== "look") showInfo(drag.target.userData.info);
  if (drag.kind === "yoke") drag.release = true;
  yokeHeld = false;
  drag = null;
}
let yokeHeld = false;
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("pointerleave", () => { if (!drag) { setHover(null); tooltip.hidden = true; } });
canvas.addEventListener("wheel", (e) => { e.preventDefault(); view.anim = null; view.fov = clamp(view.fov + e.deltaY * 0.03, 22, 85); }, { passive: false });
// щипок двумя пальцами — приближение
const pinch = { active: false, d0: 0, fov0: 62, pts: new Map() };
canvas.addEventListener("pointerdown", (e) => { pinch.pts.set(e.pointerId, [e.clientX, e.clientY]); if (pinch.pts.size === 2) { const [a, b] = [...pinch.pts.values()]; pinch.active = true; pinch.d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); pinch.fov0 = view.fov; drag = null; } });
canvas.addEventListener("pointermove", (e) => {
  if (!pinch.pts.has(e.pointerId)) return;
  pinch.pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch.active && pinch.pts.size === 2) { const [a, b] = [...pinch.pts.values()]; view.fov = clamp(pinch.fov0 * pinch.d0 / Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1])), 22, 85); }
});
const endPinch = (e) => { pinch.pts.delete(e.pointerId); if (pinch.pts.size < 2) pinch.active = false; };
canvas.addEventListener("pointerup", endPinch); canvas.addEventListener("pointercancel", endPinch);

function setThrottle(v) { state.throttle = clamp(v, 0, 1); touchThrottle.value = Math.round(state.throttle * 100); }

/* Клавиатура */
const KEYS = { KeyW: "down", ArrowUp: "down", KeyS: "up", ArrowDown: "up", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
window.addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input, textarea, dialog")) return;
  if (KEYS[e.code]) { state.keys[KEYS[e.code]] = true; if (state.mode === "fly") e.preventDefault(); }
  if (e.code === "KeyR" || e.code === "PageUp") { state.keys.thrUp = true; e.preventDefault(); }
  if (e.code === "KeyF" || e.code === "PageDown") { state.keys.thrDn = true; e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === "KeyG") toggleGear();
  if (e.code === "KeyV") cycleFlaps();
  if (e.code === "KeyP") toggleAP();
  if (e.code === "KeyB") { state.brake = !state.brake; toast(state.brake ? "Тормоз включён" : "Тормоз снят"); }
  if (e.code === "Escape" && !infoBox.hidden) infoBox.hidden = true;
});
window.addEventListener("keyup", (e) => {
  if (KEYS[e.code]) state.keys[KEYS[e.code]] = false;
  if (e.code === "KeyR" || e.code === "PageUp") state.keys.thrUp = false;
  if (e.code === "KeyF" || e.code === "PageDown") state.keys.thrDn = false;
});

/* ============================================================== ПОЛЁТ */
const VR = 300 / 3.6;               // скорость подъёма передней стойки
function stallSpeed() { return (state.flapsPos >= 25 ? 225 : state.flapsPos >= 10 ? 245 : 275) / 3.6; }

function resetFlight(kind) {
  Object.assign(state, { speed: 0, alt: 0, vs: 0, pitch: 0, roll: 0, hdg: 0, gamma: 0, onGround: true, gear: 1, gearTarget: 1, flaps: 15, flapsPos: 15,
    brake: true, ap: false, stall: false, wasStall: false, crashed: false, spoilers: false, fuel: 62, liftoff: false, km1: false, input: { pitch: 0, roll: 0 } });
  state.pos.set(0, 0, RWY_L / 2 - 120);
  state.engines.forEach((e) => { e.running = true; e.n = 61; e.starting = 0; });
  setThrottle(0);
  if (kind === "landing") {
    // 8 км до торца, 450 м, глиссада ~3°
    Object.assign(state, { speed: 290 / 3.6, alt: 420, pitch: 1.5, gamma: -3, onGround: false, flaps: 30, flapsPos: 30, brake: false });
    state.pos.set(0, 420, RWY_L / 2 + 8000);
    setThrottle(0.32);
    state.engines.forEach((e) => (e.n = 73.5));
    toast("Заход на посадку: держите полосу по центру, снижайтесь ~4 м/с", "");
  } else toast("Снимите тормоз (B), дайте полный газ (R) и на 300 км/ч возьмите штурвал на себя (S)", "");
}

function flightStep(dt) {
  const s = state, g = 9.81;
  // ввод: клавиатура + штурвал + автопилот
  let ip = s.input.pitch, ir = s.input.roll;
  if (s.keys.up) ip = Math.min(1, ip + 1); if (s.keys.down) ip = Math.max(-1, ip - 1);
  if (s.keys.left) ir = Math.max(-1, ir - 1); if (s.keys.right) ir = Math.min(1, ir + 1);
  if (s.keys.thrUp) setThrottle(s.throttle + dt * 0.45);
  if (s.keys.thrDn) setThrottle(s.throttle - dt * 0.45);
  if (s.ap && !s.onGround) {
    const vsWant = clamp((s.apAlt - s.alt) * 0.08, -8, 8);
    ip = clamp((vsWant - s.vs) * 0.08 - s.pitch * 0.02, -0.6, 0.6);
    let he = s.apHdg - s.hdg; he = ((he + 540) % 360) - 180;
    const rollWant = clamp(he * 1.2, -20, 20);
    ir = clamp((rollWant - s.roll) * 0.06, -0.5, 0.5);
    if (Math.abs(s.input.pitch) > 0.3 || Math.abs(s.input.roll) > 0.3) { s.ap = false; toast("Автопилот отключён штурвалом"); }
  }
  s.yokeVis.pitch = lerp(s.yokeVis.pitch, ip, Math.min(1, dt * 10));
  s.yokeVis.roll = lerp(s.yokeVis.roll, ir, Math.min(1, dt * 10));
  // двигатели
  const thrust = s.engines.reduce((a, e) => a + clamp((e.n - 55) / 45, 0, 1) ** 2, 0) / 4;
  // скорость
  const flapsDrag = 1 + s.flapsPos / 30 * 2.5, gearDrag = s.gear * 0.6, spoil = s.spoilers ? 1.2 : 0;
  const rho = 0.45 + 0.55 * Math.exp(-s.alt / 8000);
  const k = 3.6e-5 * (flapsDrag + gearDrag + spoil) * rho;
  let acc = thrust * 2.7 * (1 - s.alt / 22000) - k * s.speed * s.speed - g * Math.sin(s.gamma * DEG);
  if (s.onGround) acc -= (s.brake ? 2.8 : 0.15) * (s.speed > 0.3 ? 1 : 0) + (s.spoilers ? 0.4 : 0);
  s.speed = Math.max(0, s.speed + acc * dt);
  // угловое движение
  const authority = clamp(s.speed / 90, 0, 1);
  if (s.onGround) {
    if (s.speed > VR - 8) s.pitch = clamp(s.pitch + ip * 3.2 * dt * authority, 0, 12);
    else s.pitch = Math.max(0, s.pitch - 4 * dt);
    s.roll = lerp(s.roll, 0, Math.min(1, dt * 5));
    s.hdg += ir * 6 * dt * clamp(s.speed / 15, 0, 1) * (s.speed < 70 ? 1 : 0.3);
    s.gamma = 0;
    const aoaNeed = 4 * (VR * 1.08 / Math.max(s.speed, 1)) ** 2;
    if (s.speed > VR && s.pitch > aoaNeed) {
      s.onGround = false; s.alt = 0.3; s.gamma = Math.max(0.5, s.pitch - aoaNeed);   // сразу вверх, иначе «касание» в тот же кадр
      toast("Отрыв! Уберите шасси (G)", "good"); s.liftoff = true;
    }
  } else {
    s.pitch = clamp(s.pitch + ip * 5 * dt * authority, -25, 30);
    s.roll = clamp(s.roll + ir * 22 * dt * authority, -60, 60);
    if (Math.abs(ir) < 0.05 && !s.ap) s.roll = lerp(s.roll, 0, dt * 0.12);   // небольшая устойчивость по крену
    s.hdg += (g * Math.tan(s.roll * DEG) / Math.max(s.speed, 30)) / DEG * dt;
    const vs = stallSpeed();
    const aoaNeed = 4 * ((vs * 1.25) / Math.max(s.speed, 1)) ** 2 * (s.spoilers ? 1.5 : 1);
    s.stall = aoaNeed > 13 || s.speed < vs * 0.95;
    const gammaWant = s.stall ? Math.min(s.pitch - 13, -8) : s.pitch - aoaNeed;
    s.gamma = lerp(s.gamma, gammaWant, Math.min(1, dt * 1.6));
    if (s.stall && !s.wasStall) toast("Сваливание! Отдайте штурвал от себя и добавьте газ", "bad");
    s.wasStall = s.stall;
  }
  s.hdg = (s.hdg + 360) % 360;
  s.vs = s.speed * Math.sin(s.gamma * DEG);
  s.alt += s.vs * dt;
  // касание
  if (!s.onGround && s.alt <= 0 && s.vs <= 0) {
    s.alt = 0;
    const offRunway = Math.abs(s.pos.x) > RWY_W / 2 + 10 || s.pos.z > RWY_L / 2 + 50 || s.pos.z < -RWY_L / 2;
    if (s.vs < -6 || Math.abs(s.roll) > 15 || s.gear < 0.99 || s.pitch < -3) { s.crashed = true; toast(s.gear < 0.99 ? "Посадка на фюзеляж! Шасси не выпущено. «Заново»" : "Слишком жёсткое касание. Нажмите «Заново»", "bad"); shake = 1; }
    else {
      const q = -s.vs;
      toast(`Касание ${q < 1.5 ? "— мягкое, отлично!" : q < 3 ? "— хорошее" : "— жёсткое"} (${q.toFixed(1)} м/с)${offRunway ? ", но мимо полосы" : ""}. Тормоз — B`, q < 3 && !offRunway ? "good" : "");
      s.onGround = true; s.gamma = 0; s.vs = 0; s.roll = 0;
    }
  }
  // топливо
  s.fuel = Math.max(0, s.fuel - thrust * 0.0011 * dt);
  // движение по миру
  const hr = s.hdg * DEG, horiz = s.speed * Math.cos(s.gamma * DEG);
  s.pos.x += Math.sin(hr) * horiz * dt;
  s.pos.z -= Math.cos(hr) * horiz * dt;
  s.pos.y = s.alt;
  if (s.liftoff && s.alt > 1000 && !s.km1) { s.km1 = true; toast("Высота 1000 метров. Попробуйте автопилот (P)", "good"); }
}

let shake = 0;
function systemsStep(dt) {
  const s = state;
  // двигатели: обороты догоняют РУД, запуск — по своей кривой
  s.engines.forEach((e) => {
    let target = 0;
    if (e.running) target = 61 + s.throttle * 39;
    if (e.starting) {
      e.starting += dt;
      target = e.starting < 4 ? e.starting * 6 : 61;
      if (e.n > 59.5) { e.starting = 0; toast(`Двигатель ${s.engines.indexOf(e) + 1} вышел на малый газ`, "good"); }
    }
    const rate = target > e.n ? (e.starting ? 7 : 9) : 12;
    e.n += clamp(target - e.n, -rate * dt, rate * dt);
  });
  s.gear = s.gear + clamp(s.gearTarget - s.gear, -dt / 8, dt / 8);
  s.flapsPos += clamp(s.flaps - s.flapsPos, -dt * 4, dt * 4);
  // штурвал возвращается в нейтраль, если его отпустили
  if (!drag || drag.kind !== "yoke") {
    s.input.pitch = lerp(s.input.pitch, 0, Math.min(1, dt * 3));
    s.input.roll = lerp(s.input.roll, 0, Math.min(1, dt * 3));
  }
  if (s.mode !== "fly") { s.yokeVis.pitch = lerp(s.yokeVis.pitch, s.input.pitch, Math.min(1, dt * 10)); s.yokeVis.roll = lerp(s.yokeVis.roll, s.input.roll, Math.min(1, dt * 10)); }
}

function animateControls(dt) {
  const s = state;
  yokes.forEach(({ col, wheel }) => { col.rotation.x = s.yokeVis.pitch * 0.22; wheel.rotation.z = -s.yokeVis.roll * 1.1; });
  pedals.forEach(({ p, s: side }) => { p.position.z = -0.72 + side * s.yokeVis.roll * 0.03 * (s.onGround ? 1 : 0.3); });
  throttles.forEach((t) => { t.rotation.x = lerp(t.rotation.x, 0.55 - s.throttle * 1.1, Math.min(1, dt * 12)); });
  flapsLever.position.z = lerp(flapsLever.position.z, 0.04 + (s.flaps / 15) * 0.075, Math.min(1, dt * 8));
  spoilerLever.rotation.x = lerp(spoilerLever.rotation.x, s.spoilers ? 0.6 : 0, Math.min(1, dt * 8));
  brakeLever.position.y = lerp(brakeLever.position.y, s.brake ? 0.69 : 0.655, Math.min(1, dt * 10));
  gearLever.rotation.x = lerp(gearLever.rotation.x, s.gearTarget ? 0.5 : -0.5, Math.min(1, dt * 8));
  const moving = Math.abs(s.gear - s.gearTarget) > 0.01;
  gearLamps.forEach((l) => l.material.emissive.setHex(moving ? 0xff2200 : s.gear > 0.99 ? 0x22ff44 : 0x000000));
  gearLamps.forEach((l) => l.material.color.setHex(moving ? 0x661100 : s.gear > 0.99 ? 0x0a5a1a : 0x2b2b2b));
  startButtons.forEach((b, i) => b.material.emissive.setHex(s.engines[i].starting ? (Math.sin(s.time * 12) > 0 ? 0x22ff44 : 0x000000) : s.engines[i].running ? 0x0b5a1f : 0x000000));
  if (apButtonMesh) apButtonMesh.material.color.setHex(s.ap ? 0x66ff88 : 0xffffff);
  switches.forEach((sw) => { sw.bat.rotation.x = lerp(sw.bat.rotation.x, sw.on ? -0.5 : 0.5, Math.min(1, dt * 18)); });
  wipers.forEach((w) => {
    const rest = w.side * (Math.PI / 2 - 0.06);   // в покое дворник лежит вдоль нижней кромки
    w.arm.rotation.z = s.lights.wipers ? rest - w.side * (0.5 + 0.5 * Math.sin(s.time * 3.4)) * 1.3 : lerp(w.arm.rotation.z, rest, Math.min(1, dt * 4));
  });
}

/* =================================================================== ЗВУК */
const audio = (() => {
  let ctx = null, on = false, master, engGain, engOsc, whine, whineGain, noiseGain, toneOsc, toneGain;
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    engOsc = ctx.createOscillator(); engOsc.type = "sawtooth"; engGain = ctx.createGain(); engGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
    engOsc.connect(lp).connect(engGain).connect(master); engOsc.start();
    whine = ctx.createOscillator(); whine.type = "sine"; whineGain = ctx.createGain(); whineGain.gain.value = 0;
    whine.connect(whineGain).connect(master); whine.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "lowpass"; bp.frequency.value = 900;
    noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
    noise.connect(bp).connect(noiseGain).connect(master); noise.start();
    toneOsc = ctx.createOscillator(); toneOsc.frequency.value = 760; toneGain = ctx.createGain(); toneGain.gain.value = 0;
    toneOsc.connect(toneGain).connect(master); toneOsc.start();
  }
  return {
    get on() { return on; },
    toggle() { if (!ctx) init(); on = !on; ctx.resume(); master.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.05); return on; },
    unlock() { if (ctx && ctx.state === "suspended") ctx.resume(); },
    update() {
      if (!ctx || !on) return;
      const n = state.engines.reduce((a, e) => a + e.n, 0) / 4, t = ctx.currentTime;
      engOsc.frequency.setTargetAtTime(35 + n * 1.1, t, 0.1);
      engGain.gain.setTargetAtTime(n > 1 ? 0.02 + n / 100 * 0.07 : 0, t, 0.2);
      whine.frequency.setTargetAtTime(500 + n * 32, t, 0.1);
      whineGain.gain.setTargetAtTime(n > 1 ? 0.004 + n / 100 * 0.01 : 0, t, 0.2);
      noiseGain.gain.setTargetAtTime(Math.min(0.12, state.speed / 260 * 0.12) + (n > 1 ? 0.01 : 0), t, 0.2);
      const stallBeep = state.stall && Math.sin(state.time * 18) > 0;
      if (!morseDown) toneGain.gain.setTargetAtTime(stallBeep ? 0.06 : 0, t, 0.01);
    },
    click() {
      if (!ctx || !on) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = "square"; o.frequency.value = 1800; g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.05);
    },
    tone(down) { morseDown = down; if (!ctx || !on) return; toneGain.gain.setTargetAtTime(down ? 0.12 : 0, ctx.currentTime, 0.005); },
  };
})();
let morseDown = false;

/* ===================================================================== UI */
const viewsNav = $("[data-views]");
VIEWS.forEach((v) => {
  const b = document.createElement("button"); b.type = "button"; b.dataset.view = v.id; b.textContent = v.label;
  b.setAttribute("aria-pressed", "false"); b.addEventListener("click", () => setView(v.id)); viewsNav.appendChild(b);
});
// список элементов (доступен с клавиатуры и для экранных дикторов)
const listBox = $("#pit-list"), listInner = $("[data-list]");
(() => {
  const groups = {};
  Object.values(INFO).forEach((d) => { if (d.id === "switch" || d.id === "panel") return; (groups[d.group] = groups[d.group] || []).push(d); });
  Object.entries(groups).forEach(([gname, items]) => {
    const h = document.createElement("h3"); h.textContent = gname; listInner.appendChild(h);
    const ul = document.createElement("ul");
    items.forEach((d) => {
      const li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; b.textContent = d.title; if (d.hint) b.classList.add("is-interactive");
      b.addEventListener("click", () => {
        const m = pickables.find((p) => p.userData.info === d.id);
        if (m) focusOn(m);
        showInfo(d.id);
        if (window.innerWidth < 760) toggleList(false);
      });
      li.appendChild(b); ul.appendChild(li);
    });
    listInner.appendChild(ul);
  });
})();
function toggleList(force) {
  const open = force !== undefined ? force : listBox.hidden;
  listBox.hidden = !open;
  app.querySelector('[data-action="list"]').setAttribute("aria-expanded", open);
}
const toastEl = $("[data-toast]");
let toastTimer;
function toast(msg, kind = "") {
  if (coarse) msg = msg.replace(/\s*\((?:[A-Z]|PgUp)\)/g, "").replace(/\.\s*Тормоз — B$/, ".");  // на телефоне клавиш нет
  toastEl.textContent = msg; toastEl.className = "pit__toast is-on" + (kind ? " is-" + kind : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 4200);
  if (state.mode !== "fly") { infoHintFlash(msg); }
}
function infoHintFlash(msg) { /* в режиме осмотра тосты показываем в подсказке под описанием */
  const hint = $("[data-info-hint]");
  if (!infoBox.hidden) { hint.hidden = false; hint.textContent = "✓ " + msg; }
}
const hud = $("[data-hud]"), readouts = $("[data-readouts]"), touchBox = $("[data-touch]"), touchThrottle = $("[data-touch-throttle]");
function enterFlight(kind) {
  state.mode = "fly";
  app.classList.add("is-flying");
  hud.hidden = false; readouts.hidden = false; touchBox.hidden = !coarse;
  infoBox.hidden = true; toggleList(false);
  resetFlight(kind);
  setView("captain");
  state.lastScenario = kind;
}
function exitFlight() {
  state.mode = "inspect";
  app.classList.remove("is-flying");
  hud.hidden = true; readouts.hidden = true; touchBox.hidden = true;
  Object.assign(state, { speed: 0, alt: 0, vs: 0, pitch: 0, roll: 0, hdg: 0, gamma: 0, onGround: true, gear: 1, gearTarget: 1, stall: false, ap: false });
  state.pos.set(0, 0, RWY_L / 2 - 120);
  setThrottle(0);
}
app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]"); if (!b) return;
  const a = b.dataset.action;
  audio.unlock();
  if (a === "list") toggleList();
  else if (a === "close-info") infoBox.hidden = true;
  else if (a === "night") { setNight(!state.night); b.setAttribute("aria-pressed", state.night); }
  else if (a === "sound") { const on = audio.toggle(); b.setAttribute("aria-pressed", on); }
  else if (a === "help") $("#pit-help").showModal();
  else if (a === "fullscreen") { if (document.fullscreenElement) document.exitFullscreen(); else app.requestFullscreen && app.requestFullscreen().catch(() => {}); }
  else if (a === "takeoff") enterFlight("takeoff");
  else if (a === "landing") enterFlight("landing");
  else if (a === "exit") exitFlight();
  else if (a === "reset") resetFlight(state.lastScenario);
  else if (a === "gear") toggleGear();
  else if (a === "flaps") cycleFlaps();
  else if (a === "brake") { state.brake = !state.brake; }
  else if (a === "ap") toggleAP();
});
// сенсорное управление в полёте
touchThrottle.addEventListener("input", () => { state.throttle = touchThrottle.value / 100; });
(() => {
  const pad = $("[data-touch-yoke]"), knob = pad.querySelector("span");
  let id = null;
  const move = (e) => {
    const r = pad.getBoundingClientRect(), R = r.width / 2;
    const dx = clamp((e.clientX - r.left - R) / R, -1, 1), dy = clamp((e.clientY - r.top - R) / R, -1, 1);
    state.input.roll = dx; state.input.pitch = dy; yokeTouch = true;
    knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
  };
  pad.addEventListener("pointerdown", (e) => { id = e.pointerId; pad.setPointerCapture(id); move(e); });
  pad.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
  const up = (e) => { if (e.pointerId !== id) return; id = null; yokeTouch = false; knob.style.transform = ""; };
  pad.addEventListener("pointerup", up); pad.addEventListener("pointercancel", up);
})();
let yokeTouch = false;

function updateHud() {
  const s = state, set = (k, v) => { const el = app.querySelector(`[data-r="${k}"]`); if (el.textContent !== String(v)) el.textContent = v; };
  set("spd", Math.round(kmh())); set("alt", Math.round(s.alt)); set("vs", (s.vs >= 0 ? "+" : "") + s.vs.toFixed(1));
  set("hdg", String(Math.round(s.hdg) % 360).padStart(3, "0")); set("thr", Math.round(s.throttle * 100));
  set("gear", s.gearTarget ? (s.gear > 0.99 ? "выпущ." : "выпуск…") : s.gear < 0.01 ? "убраны" : "уборка…");
  set("flaps", s.flaps + "°"); set("brake", s.brake ? "вкл" : "выкл"); set("ap", s.ap ? "вкл" : "выкл");
}

/* ================================================================= ЦИКЛ */
function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
document.addEventListener("fullscreenchange", () => setTimeout(resize, 50));

let last = performance.now(), gaugeTimer = 0, hudTimer = 0;
const tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  state.time += dt;
  if (state.mode === "fly" && !state.crashed) {
    // несколько мелких шагов — устойчивее на медленных устройствах
    const n = Math.ceil(dt / 0.02);
    for (let i = 0; i < n; i++) flightStep(dt / n);
  }
  systemsStep(dt);
  animateControls(dt);
  // самолёт в мире
  aircraft.position.set(state.pos.x, state.alt + 4.6, state.pos.z);
  tmpEuler.set(state.pitch * DEG, -state.hdg * DEG, -state.roll * DEG, "YXZ");
  aircraft.quaternion.setFromEuler(tmpEuler);
  if (state.onGround && state.speed > 5) aircraft.position.y += Math.sin(state.time * 37) * 0.004 * Math.min(1, state.speed / 60);
  if (shake > 0) { aircraft.position.y += (Math.random() - 0.5) * shake * 0.15; shake = Math.max(0, shake - dt); }
  // мир «едет» за самолётом
  ground.position.set(Math.round(state.pos.x / TILE) * TILE, 0, Math.round(state.pos.z / TILE) * TILE);
  hills.position.set(state.pos.x, 0, state.pos.z);
  sky.position.copy(aircraft.position); stars.position.copy(aircraft.position);
  sun.position.set(state.pos.x + 3000, 6000, state.pos.z - 5000); sun.target.position.set(state.pos.x, 0, state.pos.z);
  clouds.forEach((c) => {
    const dx = c.position.x - state.pos.x, dz = c.position.z - state.pos.z;
    if (Math.abs(dx) > 8000) c.position.x -= Math.sign(dx) * 16000;
    if (Math.abs(dz) > 8000) c.position.z -= Math.sign(dz) * 16000;
  });
  // в режиме осмотра стрелки и WASD поворачивают взгляд
  if (state.mode !== "fly") {
    const k = state.keys;
    if (k.left || k.right || k.up || k.down) {
      view.anim = null;
      view.yaw += ((k.left ? 1 : 0) - (k.right ? 1 : 0)) * dt * 1.4;
      view.pitch = clamp(view.pitch + ((k.down ? 1 : 0) - (k.up ? 1 : 0)) * dt * 1.2, -1.35, 1.35);
    }
  }
  // камера
  if (view.anim) {
    const a = view.anim; a.t += dt / a.dur;
    const k = a.t >= 1 ? 1 : 1 - Math.pow(1 - a.t, 3);
    view.pos.lerpVectors(a.from.pos, a.to.pos, k);
    view.yaw = lerp(a.from.yaw, a.to.yaw, k); view.pitch = lerp(a.from.pitch, a.to.pitch, k); view.fov = lerp(a.from.fov, a.to.fov, k);
    if (a.t >= 1) view.anim = null;
  }
  camera.position.copy(view.pos);
  camera.rotation.set(view.pitch, view.yaw, 0, "YXZ");
  if (Math.abs(camera.fov - view.fov) > 0.01) { camera.fov = view.fov; camera.updateProjectionMatrix(); }
  // приборы: 30 раз в секунду
  gaugeTimer += dt;
  if (gaugeTimer > 1 / 30) {
    gaugeTimer = 0;
    gauges.forEach((g) => g.update());
    annunciator.update();
  }
  hudTimer += dt;
  if (hudTimer > 0.1 && state.mode === "fly") { hudTimer = 0; updateHud(); }
  audio.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ================================================================== СТАРТ */
if (!document.fullscreenEnabled) app.querySelector('[data-action="fullscreen"]').hidden = true;   // iPhone: полноэкранного режима для страниц нет
resize();
view.pos.set(...VIEWS[0].pos); view.yaw = VIEWS[0].yaw; view.pitch = VIEWS[0].pitch;
setView("captain");
view.anim = null;
view.pos.set(...VIEWS[0].pos);
setNight(false);
state.pos.set(0, 0, RWY_L / 2 - 120);
requestAnimationFrame((t) => {
  last = t; frame(t);
  $("[data-loader]").classList.add("is-done");
  try { if (!localStorage.getItem("pit-help")) { $("#pit-help").showModal(); localStorage.setItem("pit-help", "1"); } } catch (e) {}
});
// для автотестов и отладки
window.__cockpit = {
  THREE, scene, camera, renderer,
  state, enterFlight, exitFlight, INFO, pickables, focusOn, showInfo, setThrottle,
  setView(id, instant) { setView(id); if (instant && view.anim) { view.anim.t = 1; view.anim.dur = 1e-6; } },
  step(sec) { const n = Math.round(sec / 0.02); for (let i = 0; i < n; i++) { if (state.mode === "fly" && !state.crashed) flightStep(0.02); systemsStep(0.02); } },
};
