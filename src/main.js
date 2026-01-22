// @ts-check

import { GpuSim } from "./gpu-sim.js";
import {
  buildLatentTexels,
  buildPaletteTexels,
  buildPropTexels,
  buildThermal0Texels,
  buildThermal1Texels,
  createParticleDefs,
  createThermalDefs,
  defaultCellForParticle,
  Particle,
} from "./particles.js";
import { createLevels, LEVEL_ID } from "./levels.js";

/** @typedef {import('./types.js').ViewMode} ViewMode */

/**
 * @param {string} v
 * @returns {{width: number, height: number}}
 */
function parseRes(v) {
  const m = /^(\d+)x(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`bad res: ${v}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * @param {HTMLElement} el
 * @param {string} msg
 */
function setText(el, msg) {
  el.textContent = msg;
}

/**
 * Writes a persistent hint message (replaces transient toasts).
 * @param {string} msg
 */
function notify(msg) {
  setText(hintStatusEl, msg);
  hintStatusEl.title = msg;
}

/**
 * Shows a blocking error overlay (e.g. WebGL2 unavailable).
 * @param {string} title
 * @param {string} msg
 */
function showFatalError(title, msg) {
  if (fatalOverlayEl) fatalOverlayEl.hidden = false;
  if (fatalTitleEl) setText(fatalTitleEl, title);
  if (fatalMessageEl) setText(fatalMessageEl, msg);
  if (loadingOverlayEl) loadingOverlayEl.hidden = true;
}

/**
 * @param {boolean} on
 * @param {string} [msg]
 */
function setLoading(on, msg) {
  if (!loadingOverlayEl) return;
  loadingOverlayEl.hidden = !on;
  if (msg && loadingMessageEl) setText(loadingMessageEl, msg);
}

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
const cursorCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("cursorCanvas"));
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));
const hintStatusEl = /** @type {HTMLElement} */ (document.getElementById("hintStatus"));
const fatalOverlayEl = /** @type {HTMLDivElement} */ (document.getElementById("fatalOverlay"));
const fatalTitleEl = /** @type {HTMLElement} */ (document.getElementById("fatalTitle"));
const fatalMessageEl = /** @type {HTMLElement} */ (document.getElementById("fatalMessage"));
const loadingOverlayEl = /** @type {HTMLDivElement} */ (document.getElementById("loadingOverlay"));
const loadingMessageEl = /** @type {HTMLElement} */ (document.getElementById("loadingMessage"));
const playPauseBtn = /** @type {HTMLButtonElement} */ (document.getElementById("playPauseBtn"));
const stepBtn = /** @type {HTMLButtonElement} */ (document.getElementById("stepBtn"));
const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById("clearBtn"));
const toolPaintBtn = /** @type {HTMLButtonElement} */ (document.getElementById("toolPaintBtn"));
const toolStampBtn = /** @type {HTMLButtonElement} */ (document.getElementById("toolStampBtn"));
const toolCopyBtn = /** @type {HTMLButtonElement} */ (document.getElementById("toolCopyBtn"));
const levelSelect = /** @type {HTMLSelectElement} */ (document.getElementById("levelSelect"));
const particleSelect = /** @type {HTMLSelectElement} */ (document.getElementById("particleSelect"));
const particleHotbar = /** @type {HTMLDivElement} */ (document.getElementById("particleHotbar"));
const particleMoreBtn = /** @type {HTMLButtonElement} */ (document.getElementById("particleMoreBtn"));
const particlePicker = /** @type {HTMLDivElement} */ (document.getElementById("particlePicker"));
const particleSearch = /** @type {HTMLInputElement} */ (document.getElementById("particleSearch"));
const particleGrid = /** @type {HTMLDivElement} */ (document.getElementById("particleGrid"));
const particlePickerCloseBtn = /** @type {HTMLButtonElement} */ (document.getElementById("particlePickerCloseBtn"));
const brushControl = /** @type {HTMLElement} */ (document.getElementById("brushControl"));
const stampControls = /** @type {HTMLElement} */ (document.getElementById("stampControls"));
const agentPaintControl = /** @type {HTMLElement} */ (document.getElementById("agentPaintControl"));
const agentPaintSelect = /** @type {HTMLSelectElement} */ (document.getElementById("agentPaintSelect"));
const agentDirControl = /** @type {HTMLElement} */ (document.getElementById("agentDirControl"));
const agentDirSelect = /** @type {HTMLSelectElement} */ (document.getElementById("agentDirSelect"));
const agentDrillControl = /** @type {HTMLElement} */ (document.getElementById("agentDrillControl"));
const agentDrill = /** @type {HTMLInputElement} */ (document.getElementById("agentDrill"));
const singlePaintControl = /** @type {HTMLElement} */ (document.getElementById("singlePaintControl"));
const singlePaint = /** @type {HTMLInputElement} */ (document.getElementById("singlePaint"));
const brushSize = /** @type {HTMLInputElement} */ (document.getElementById("brushSize"));
const rateMode = /** @type {HTMLSelectElement} */ (document.getElementById("rateMode"));
const simRateLabel = /** @type {HTMLSpanElement} */ (document.getElementById("simRateLabel"));
const simRate = /** @type {HTMLInputElement} */ (document.getElementById("simRate"));
const zoomInput = /** @type {HTMLInputElement} */ (document.getElementById("zoom"));
const viewSelect = /** @type {HTMLSelectElement} */ (document.getElementById("viewSelect"));
const resSelect = /** @type {HTMLSelectElement} */ (document.getElementById("resSelect"));
const pasteEdgeStone = /** @type {HTMLInputElement} */ (document.getElementById("pasteEdgeStone"));
const stampMode = /** @type {HTMLInputElement} */ (document.getElementById("stampMode"));
const stampW = /** @type {HTMLInputElement} */ (document.getElementById("stampW"));
const stampH = /** @type {HTMLInputElement} */ (document.getElementById("stampH"));
const stampLock = /** @type {HTMLInputElement} */ (document.getElementById("stampLock"));
const addMode = /** @type {HTMLInputElement} */ (document.getElementById("addMode"));
const caRule = /** @type {HTMLInputElement} */ (document.getElementById("caRule"));
const caInterval = /** @type {HTMLInputElement} */ (document.getElementById("caInterval"));
const caPaintSelect = /** @type {HTMLSelectElement} */ (document.getElementById("caPaintSelect"));
const caMode = /** @type {HTMLInputElement} */ (document.getElementById("caMode"));
const golMode = /** @type {HTMLInputElement} */ (document.getElementById("golMode"));
const golRateControl = /** @type {HTMLElement} */ (document.getElementById("golRateControl"));
const golRate = /** @type {HTMLInputElement} */ (document.getElementById("golRate"));
const levelHintEl = /** @type {HTMLElement} */ (document.getElementById("levelHint"));
const settingsBtn = /** @type {HTMLButtonElement} */ (document.getElementById("settingsBtn"));
const settingsPanel = /** @type {HTMLDivElement} */ (document.getElementById("settingsPanel"));
const brushSizeValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("brushSizeValue"));
const simRateValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("simRateValue"));
const caRuleValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("caRuleValue"));
const caIntervalValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("caIntervalValue"));
const golRateValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("golRateValue"));
const zoomValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("zoomValue"));
const topbar = /** @type {HTMLElement | null} */ (document.querySelector("header.topbar"));

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/** @type {CanvasRenderingContext2D | null} */
const cursorCtx = cursorCanvas.getContext("2d");
if (cursorCtx) cursorCtx.imageSmoothingEnabled = true;

const particleDefs = createParticleDefs();
for (const id of Object.values(Particle)) {
  const def = particleDefs[id];
  const opt = document.createElement("option");
  opt.value = String(def.id);
  opt.textContent = def.name;
  particleSelect.appendChild(opt);

  const opt2 = document.createElement("option");
  opt2.value = String(def.id);
  opt2.textContent = def.name;
  caPaintSelect.appendChild(opt2);
}
particleSelect.value = String(Particle.SAND);

for (const id of Object.values(Particle)) {
  if (id === Particle.BOT || id === Particle.GLIDER) continue;
  const def = particleDefs[id];
  const opt = document.createElement("option");
  opt.value = String(def.id);
  opt.textContent = def.name;
  agentPaintSelect.appendChild(opt);
}
agentPaintSelect.value = String(Particle.EMPTY);
caPaintSelect.value = String(Particle.SAND);

const paletteTexels = buildPaletteTexels(particleDefs);
const propTexels = buildPropTexels(particleDefs);
const thermalDefs = createThermalDefs();
const thermal0Texels = buildThermal0Texels(thermalDefs);
const thermal1Texels = buildThermal1Texels(thermalDefs);
const latentTexels = buildLatentTexels(thermalDefs);

const levels = createLevels(particleDefs);
for (const lvl of levels) {
  const opt = document.createElement("option");
  opt.value = lvl.id;
  opt.textContent = lvl.name;
  levelSelect.appendChild(opt);
}
levelSelect.value = LEVEL_ID.SANDBOX;
levelHintEl.textContent = "";

/** @type {GpuSim | null} */
let sim = null;

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * @returns {{maxTexSize: number, maxRbSize: number} | null}
 */
function queryWebgl2Limits() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    return {
      maxTexSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
      maxRbSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * @param {number} maxDim
 */
function populateResOptions(maxDim) {
  const widths = [256, 384, 512, 768, 1024, 1280, 1536, 1792, 2048, 2560, 3072, 3840, 4096, 5120, 6144, 7680];
  const opts = widths
    .map((w) => ({ w, h: Math.round((w * 9) / 16) }))
    .filter((r) => r.w <= maxDim && r.h <= maxDim);

  resSelect.replaceChildren();
  for (const r of opts) {
    const opt = document.createElement("option");
    opt.value = `${r.w}x${r.h}`;
    opt.textContent = `${r.w}×${r.h}`;
    resSelect.appendChild(opt);
  }

  const preferred = "768x432";
  if (Array.from(resSelect.options).some((o) => o.value === preferred)) resSelect.value = preferred;
  else if (resSelect.options.length) resSelect.selectedIndex = resSelect.options.length - 1;
}

function applyStartupParams() {
  const sp = new URLSearchParams(window.location.search);
  const rawRes = sp.get("res");
  if (rawRes) {
    const v = rawRes.trim().toLowerCase().replace("×", "x");
    try {
      const parsed = parseRes(v);
      const maxDim = Number(resSelect.dataset.maxDim || "0") || 0;
      const clampIntLocal = (n, lo, hi) => {
        n = n | 0;
        return n < lo ? lo : n > hi ? hi : n;
      };
      const w = maxDim ? clampIntLocal(parsed.width, 1, maxDim) : parsed.width;
      const h = maxDim ? clampIntLocal(parsed.height, 1, maxDim) : parsed.height;
      const vv = `${w}x${h}`;
      const ok = Array.from(resSelect.options).some((opt) => opt.value === vv);
      if (!ok) {
        const opt = document.createElement("option");
        opt.value = vv;
        opt.textContent = `${w}×${h}`;
        resSelect.appendChild(opt);
      }
      resSelect.value = vv;
    } catch {
      // ignore invalid res
    }
  }
}

async function boot() {
  setText(hintStatusEl, "Initializing GPU…");
  setLoading(true, "Compiling shaders…");
  // Let the loading overlay paint before shader compilation.
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    const limits = queryWebgl2Limits();
    const maxDim = limits ? Math.max(0, Math.min(limits.maxTexSize, limits.maxRbSize)) : 0;
    if (maxDim) resSelect.dataset.maxDim = String(maxDim);
    populateResOptions(maxDim || 8192);
    applyStartupParams();
    const { width, height } = parseRes(resSelect.value);
    sim = new GpuSim(canvas, particleDefs, paletteTexels, propTexels, thermal0Texels, thermal1Texels, latentTexels, {
      width,
      height,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
    setText(hintStatusEl, "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setText(statusEl, `Error: ${msg}`);
    setText(hintStatusEl, "");
    showFatalError("WebGL2 required", msg);
    return;
  } finally {
    setLoading(false);
  }

  startApp();
}

void boot();

function startApp() {
  if (!sim) return;
  let didAutoStartupStamp = false;

  /** @type {(typeof levels)[number]} */
  let activeLevel = levels.find((l) => l.id === levelSelect.value) ?? levels[0];
let remainingBudget = /** @type {number | null} */ (null);
let levelComplete = false;
let goalStable = 0;
let lastGoalCheckNow = 0;

/** @type {{down: boolean, x: number, y: number, lastX: number, lastY: number, mode: 'paint'|'erase'}} */
const brush = { down: false, x: 0, y: 0, lastX: 0, lastY: 0, mode: "paint" };
/** @type {{x: number, y: number, has: boolean}} */
const cursor = { x: Math.floor(sim.width / 2), y: Math.floor(sim.height / 2), has: false };

/** @typedef {{base: HTMLCanvasElement | OffscreenCanvas, srcW: number, srcH: number, w: number, h: number}} StampState */
/** @type {StampState | null} */
let stamp = null;

/** @type {'paint'|'stamp'|'copy'} */
let activeTool = "paint";

const pasteEdgeStoneWrap = pasteEdgeStone.closest("label");
/** @type {{active: boolean, pointerId: number, x0: number, y0: number, x1: number, y1: number}} */
const copySel = { active: false, pointerId: -1, x0: 0, y0: 0, x1: 0, y1: 0 };

function cancelCopySelection() {
  copySel.active = false;
  copySel.pointerId = -1;
}

/**
 * @param {number} id
 */
function setSelectedParticle(id) {
  const nextId = id | 0;
  particleSelect.value = String(nextId);
  pushRecentParticle(nextId);
  syncParticleUi();
}

function syncParticleUi() {
  const current = Number(particleSelect.value) | 0;
  for (const el of particleHotbar.querySelectorAll("button[data-pid]")) {
    if (!(el instanceof HTMLButtonElement)) continue;
    const pid = Number(el.dataset.pid) | 0;
    el.setAttribute("aria-pressed", pid === current ? "true" : "false");
  }
  refreshToolbarVisibility();
}

/**
 * @param {number} id
 */
function particleChipLabel(id) {
  const def = particleDefs[id];
  const [r, g, b] = def.color;
  return { name: def.name, color: `rgb(${r} ${g} ${b})` };
}

/** @type {number[]} */
const recentParticles = [Particle.SAND, Particle.WATER, Particle.STONE, Particle.DIRT, Particle.FIRE, Particle.SMOKE];

/** @type {StampState[]} */
const recentStamps = [];

/**
 * @param {number} id
 */
function pushRecentParticle(id) {
  if (!(id in particleDefs)) return;
  const idx = recentParticles.indexOf(id);
  if (idx >= 0) recentParticles.splice(idx, 1);
  recentParticles.unshift(id);
  if (recentParticles.length > 12) recentParticles.length = 12;
  buildHotbar();
}

function wantsCompactHotbar() {
  return window.matchMedia("(max-width: 620px)").matches;
}

function hotbarParticleIds() {
  if (wantsCompactHotbar()) return recentParticles.slice(0, 6);
  return [
    Particle.SAND,
    Particle.WATER,
    Particle.STONE,
    Particle.DIRT,
    Particle.MUD,
    Particle.OIL,
    Particle.PLANT,
    Particle.FIRE,
    Particle.SMOKE,
    Particle.STEAM,
    Particle.LAVA,
    Particle.ACID,
  ];
}

/**
 * @param {StampState} item
 */
function pushRecentStamp(item) {
  const idx = recentStamps.findIndex((s) => s.base === item.base);
  if (idx >= 0) recentStamps.splice(idx, 1);
  recentStamps.unshift(item);
  if (recentStamps.length > 6) recentStamps.length = 6;
  buildHotbar();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLCanvasElement | OffscreenCanvas} source
 * @param {number} srcW
 * @param {number} srcH
 */
function drawStampThumb(canvas, source, srcW, srcH) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  // @ts-ignore - CanvasImageSource is valid for drawImage.
  ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, canvas.width, canvas.height);
}

function buildHotbar() {
  particleHotbar.replaceChildren();
  if (activeTool === "stamp") {
    particleMoreBtn.textContent = "Paste";
    for (const s of recentStamps) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stampThumb";
      btn.setAttribute("aria-label", "Recent stamp");
      const c = document.createElement("canvas");
      c.width = 28;
      c.height = 28;
      drawStampThumb(c, s.base, s.srcW, s.srcH);
      btn.appendChild(c);
      btn.addEventListener("click", () => {
        stamp = { base: s.base, srcW: s.srcW, srcH: s.srcH, w: s.w, h: s.h };
        stampMode.checked = true;
        setTool("stamp");
        syncStampInputsFromState();
        pushRecentStamp(stamp);
      });
      particleHotbar.appendChild(btn);
    }
    return;
  }
  particleMoreBtn.textContent = "More";
  for (const id of hotbarParticleIds()) {
    const { name, color } = particleChipLabel(id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "particleChip";
    btn.dataset.pid = String(id);
    btn.title = name;
    btn.setAttribute("aria-label", name);
    btn.setAttribute("aria-pressed", "false");
    btn.style.setProperty("--chip", color);
    btn.addEventListener("click", () => setSelectedParticle(id));
    particleHotbar.appendChild(btn);
  }
  syncParticleUi();
}

function setParticlePickerOpen(open) {
  particlePicker.hidden = !open;
  if (open) {
    particleSearch.value = "";
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    if (!isCoarse) particleSearch.focus();
    syncParticleGrid();
  }
}

function syncParticleGrid() {
  const q = particleSearch.value.trim().toLowerCase();
  const current = Number(particleSelect.value) | 0;
  particleGrid.replaceChildren();
  for (const id of Object.values(Particle)) {
    const def = particleDefs[id];
    if (!def || !def.name) continue;
    if (q && !def.name.toLowerCase().includes(q)) continue;
    const [r, g, b] = def.color;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "particleTile";
    btn.dataset.pid = String(def.id);
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", def.id === current ? "true" : "false");
    btn.innerHTML = `<span class="particleTile__swatch" style="background: rgb(${r} ${g} ${b})"></span><span class="particleTile__name"></span>`;
    const nameEl = btn.querySelector(".particleTile__name");
    if (nameEl) nameEl.textContent = def.name;
    btn.addEventListener("click", () => {
      setSelectedParticle(def.id);
      setParticlePickerOpen(false);
    });
    particleGrid.appendChild(btn);
  }
}

particleSelect.addEventListener("change", () => syncParticleUi());
agentPaintSelect.addEventListener("change", () => {
  // no-op: used when painting bots/gliders
});
particleMoreBtn.addEventListener("click", (e) => {
  if (activeTool === "stamp") void startPasteFlow(e.shiftKey);
  else setParticlePickerOpen(true);
});
particlePickerCloseBtn.addEventListener("click", () => setParticlePickerOpen(false));
particlePicker.addEventListener("pointerdown", (e) => {
  if (e.target === particlePicker) setParticlePickerOpen(false);
});
particleSearch.addEventListener("input", () => syncParticleGrid());
particleSearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    setParticlePickerOpen(false);
  }
});

buildHotbar();
{
  const mq = window.matchMedia("(max-width: 620px)");
  const onChange = () => buildHotbar();
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
  // Safari < 14
  // @ts-ignore - addListener exists in older browsers.
  else if (typeof mq.addListener === "function") mq.addListener(onChange);
}

const camera = { centerX: 0.5, centerY: 0.5, zoom: 1.0 };
/** @type {{down: boolean, pointerId: number, startX: number, startY: number, startCenterX: number, startCenterY: number}} */
  const pan = { down: false, pointerId: -1, startX: 0, startY: 0, startCenterX: 0.5, startCenterY: 0.5 };
/** @type {{has: boolean, clientX: number, clientY: number}} */
  const pointerScreen = { has: false, clientX: 0, clientY: 0 };
  const keyPan = { left: false, right: false, up: false, down: false };
  let keyShiftDown = false;

/** @type {Map<number, {x: number, y: number}>} */
  const touchPoints = new Map();
/** @type {null | {startDist: number, startZoom: number, worldU: number, worldV: number}} */
  let pinch = null;

/**
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{x: number, y: number}}
 */
function screenToGrid(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  const su = clamp(nx, 0, 1);
  const sv = clamp(1 - ny, 0, 1);
  const u = (su - 0.5) / camera.zoom + camera.centerX;
  const v = (sv - 0.5) / camera.zoom + camera.centerY;
  const x = clampInt(Math.floor(u * sim.width), 0, sim.width - 1);
  const y = clampInt(Math.floor(v * sim.height), 0, sim.height - 1);
  return { x, y };
}

function updateCursorFromScreen() {
  if (!pointerScreen.has) return;
  const { x, y } = screenToGrid(pointerScreen.clientX, pointerScreen.clientY);
  cursor.x = x;
  cursor.y = y;
  cursor.has = true;
}

function clampCamera() {
  camera.zoom = clamp(Number(camera.zoom), 1, 8);
  const halfU = 0.5 / camera.zoom;
  camera.centerX = clamp(camera.centerX, halfU, 1 - halfU);
  camera.centerY = clamp(camera.centerY, halfU, 1 - halfU);
  sim.camCenterX = camera.centerX;
  sim.camCenterY = camera.centerY;
  sim.camZoom = camera.zoom;
  updateCursorFromScreen();
}

/**
 * @param {PointerEvent} e
 * @returns {{x: number, y: number}}
 */
function eventToGrid(e) {
  return screenToGrid(e.clientX, e.clientY);
}

/**
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {(x:number, y:number) => void} fn
 */
function forEachLinePoint(x0, y0, x1, y1, fn) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) {
    fn(x0, y0);
    return;
  }
  const step = Math.max(0.5, Number(brushSize.value) * 0.35);
  const n = Math.min(200, Math.ceil(dist / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    fn(Math.round(x0 + dx * t), Math.round(y0 + dy * t));
  }
}

/**
 * @param {number} x
 * @param {number} y
 * @param {'paint'|'erase'} mode
 * @param {0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|null} [agentDir]
 */
function paintAt(x, y, mode, agentDir) {
  const radiusUi = Number(brushSize.value) | 0;
  const radius = Math.max(0, radiusUi - 1);
  const inLevel = activeLevel.id !== LEVEL_ID.SANDBOX;

  let id = mode === "erase" ? Particle.EMPTY : Number(particleSelect.value) | 0;
  if (inLevel && mode !== "erase") {
    const allowed = activeLevel.allowedPaintIds ?? [];
    if (!allowed.includes(id)) id = allowed[0] ?? Particle.STONE;
    if (remainingBudget !== null) {
      const cost = activeLevel.paintCost(radius);
      if (remainingBudget < cost) {
        notify("out of budget");
        return;
      }
      remainingBudget -= cost;
    }
  }

  const base = defaultCellForParticle(/** @type {any} */ (id));
  const isErase = id === Particle.EMPTY;
  const doAdd = !isErase && addMode.checked;

  let flags = base.flags;
  let data = base.data;
  if (!isErase && (id === Particle.BOT || id === Particle.GLIDER)) {
    data = clampInt(Number(agentPaintSelect.value) || 0, 0, 255);
    flags = (flags & ~(1 << 5)) | (agentDrill.checked ? 1 << 5 : 0);
  }
  if (
    agentDir !== null &&
    (id === Particle.BOT || id === Particle.GLIDER)
  ) {
    flags = (flags & ~15) | (agentDir & 15);
  }

  sim.paintCircle(x, y, { id, temp: base.temp, data, flags }, radius, { addMode: doAdd });
}

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clampInt(v, lo, hi) {
  v |= 0;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 8-way direction index matching shader `dirIndexFromDelta`:
 * 0=up,1=up-right,2=right,3=down-right,4=down,5=down-left,6=left,7=up-left.
 * @param {number} dx
 * @param {number} dy
 * @returns {0|1|2|3|4|5|6|7}
 */
function dirIndex16FromDxDy(dx, dy) {
  // Compute an angle where 0 points "up" (+y) and increases clockwise.
  const angle = Math.atan2(dx, dy);
  const tau = Math.PI * 2;
  const t = ((angle % tau) + tau) % tau;
  const idx = Math.round((t / tau) * 16) & 15;
  return /** @type {0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15} */ (idx);
}

function syncStampInputsFromState() {
  if (!stamp) {
    stampMode.checked = false;
    stampW.value = "";
    stampH.value = "";
    stampW.disabled = true;
    stampH.disabled = true;
    stampLock.disabled = true;
    stampMode.disabled = true;
    return;
  }

  stampW.disabled = false;
  stampH.disabled = false;
  stampLock.disabled = false;
  stampMode.disabled = false;
  stampW.value = String(stamp.w);
  stampH.value = String(stamp.h);
}

function clearStamp() {
  stamp = null;
  syncStampInputsFromState();
  if (activeTool === "stamp") setTool("paint");
}

/**
 * @param {number} w
 * @param {number} h
 */
function setStampSize(w, h) {
  if (!stamp) return;
  const maxW = Math.max(1, sim.width - 2);
  const maxH = Math.max(1, sim.height - 1);
  stamp.w = clampInt(w, 1, maxW);
  stamp.h = clampInt(h, 1, maxH);
  syncStampInputsFromState();
}

function onStampWInput() {
  if (!stamp) return;
  const w = Number(stampW.value) | 0;
  if (!w) return;
  if (stampLock.checked) {
    const h = Math.max(1, Math.round((w * stamp.srcH) / Math.max(1, stamp.srcW)));
    setStampSize(w, h);
  } else {
    setStampSize(w, stamp.h);
  }
}

function onStampHInput() {
  if (!stamp) return;
  const h = Number(stampH.value) | 0;
  if (!h) return;
  if (stampLock.checked) {
    const w = Math.max(1, Math.round((h * stamp.srcW) / Math.max(1, stamp.srcH)));
    setStampSize(w, h);
  } else {
    setStampSize(stamp.w, h);
  }
}

stampW.addEventListener("input", onStampWInput);
stampH.addEventListener("input", onStampHInput);

function refreshToolbarVisibility() {
  const isStamp = activeTool === "stamp";
  const isCopy = activeTool === "copy";
  const selectedParticle = Number(particleSelect.value) | 0;
  const isAgent = selectedParticle === Particle.BOT || selectedParticle === Particle.GLIDER;
  brushControl.hidden = isStamp || isCopy;
  stampControls.hidden = !isStamp;
  agentPaintControl.hidden = isStamp || isCopy || !isAgent;
  agentDirControl.hidden = isStamp || isCopy || !isAgent;
  agentDrillControl.hidden = isStamp || isCopy || !isAgent;
  singlePaintControl.hidden = isStamp || isCopy;
  if (pasteEdgeStoneWrap) pasteEdgeStoneWrap.hidden = !isStamp;
}

function syncToolUi() {
  toolPaintBtn.setAttribute("aria-pressed", activeTool === "paint" ? "true" : "false");
  toolStampBtn.setAttribute("aria-pressed", activeTool === "stamp" ? "true" : "false");
  toolCopyBtn.setAttribute("aria-pressed", activeTool === "copy" ? "true" : "false");
  refreshToolbarVisibility();
  buildHotbar();
}

/**
 * @param {'paint'|'stamp'|'copy'} tool
 */
function setTool(tool) {
  if (tool !== "copy" && copySel.active) cancelCopySelection();
  if (tool === "stamp") {
    if (!stamp) {
      notify("paste an image to stamp first");
      void startPasteFlow(false);
      tool = "paint";
    } else {
      stampMode.checked = true;
    }
  } else if (stampMode.checked) {
    stampMode.checked = false;
  }
  activeTool = tool;
  syncToolUi();
}

toolPaintBtn.addEventListener("click", () => setTool("paint"));
toolStampBtn.addEventListener("click", () => setTool("stamp"));
toolCopyBtn.addEventListener("click", () => setTool("copy"));

stampMode.addEventListener("change", () => {
  if (!stamp) {
    stampMode.checked = false;
    if (activeTool === "stamp") setTool("paint");
    return;
  }
  if (stampMode.checked) setTool("stamp");
  else if (activeTool === "stamp") setTool("paint");
});
syncStampInputsFromState();
syncToolUi();

zoomInput.addEventListener("input", () => {
  camera.zoom = Number(zoomInput.value);
  clampCamera();
  syncRangeReadouts();
});
clampCamera();

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointerScreen.has = true;
  pointerScreen.clientX = e.clientX;
  pointerScreen.clientY = e.clientY;
  const { x, y } = eventToGrid(e);

  if (e.pointerType === "touch") {
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.size >= 2) {
      const pts = [...touchPoints.values()];
      const a = pts[0];
      const b = pts[1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1e-3, Math.hypot(dx, dy));
      const rect = canvas.getBoundingClientRect();
      const cx = (a.x + b.x) * 0.5;
      const cy = (a.y + b.y) * 0.5;
      const su = clamp((cx - rect.left) / rect.width, 0, 1);
      const sv = clamp(1 - (cy - rect.top) / rect.height, 0, 1);
      const worldU = (su - 0.5) / camera.zoom + camera.centerX;
      const worldV = (sv - 0.5) / camera.zoom + camera.centerY;
      pinch = { startDist: dist, startZoom: camera.zoom, worldU, worldV };
      brush.down = false;
      e.preventDefault();
      return;
    }
  }

  if (e.button === 1) {
    // Middle mouse: pan camera (keep Alt for pick).
    e.preventDefault();
    pan.down = true;
    pan.pointerId = e.pointerId;
    pan.startX = e.clientX;
    pan.startY = e.clientY;
    pan.startCenterX = camera.centerX;
    pan.startCenterY = camera.centerY;
    return;
  }

  if (activeTool === "copy" && e.button === 0 && !e.shiftKey && !e.altKey) {
    if (activeLevel.id !== LEVEL_ID.SANDBOX) return;
    e.preventDefault();
    brush.down = false;
    copySel.active = true;
    copySel.pointerId = e.pointerId;
    copySel.x0 = x;
    copySel.y0 = y;
    copySel.x1 = x;
    copySel.y1 = y;
    return;
  }

  if (stampMode.checked && stamp && e.button === 0 && !e.shiftKey && !e.altKey) {
    if (activeLevel.id !== LEVEL_ID.SANDBOX) return;
    e.preventDefault();
    placeStampAt(x, y);
    return;
  }

  const wantsPick = e.altKey;
  if (wantsPick) {
    if (activeLevel.id !== LEVEL_ID.SANDBOX) return;
    const cell = sim.readCell(x, y);
    if (cell.id in particleDefs) setSelectedParticle(cell.id);
    return;
  }

  brush.down = true;
  const wantsErase = e.button === 2 || e.shiftKey;
  brush.mode = wantsErase ? "erase" : "paint";
  if (!wantsErase && sim.caEnabled) {
    const id = Number(particleSelect.value) | 0;
    if (id === (sim.caPaintId | 0)) sim.setCaSeed(x, y);
  }
  brush.x = x;
  brush.y = y;
  brush.lastX = x;
  brush.lastY = y;
});

canvas.addEventListener("pointermove", (e) => {
  pointerScreen.has = true;
  pointerScreen.clientX = e.clientX;
  pointerScreen.clientY = e.clientY;

  if (e.pointerType === "touch" && touchPoints.has(e.pointerId)) {
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touchPoints.size >= 2) {
      const pts = [...touchPoints.values()];
      const a = pts[0];
      const b = pts[1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1e-3, Math.hypot(dx, dy));
      const rect = canvas.getBoundingClientRect();
      const cx = (a.x + b.x) * 0.5;
      const cy = (a.y + b.y) * 0.5;
      const su = clamp((cx - rect.left) / rect.width, 0, 1);
      const sv = clamp(1 - (cy - rect.top) / rect.height, 0, 1);

      camera.zoom = clamp((pinch.startZoom * dist) / pinch.startDist, 1, 8);
      camera.centerX = pinch.worldU - (su - 0.5) / camera.zoom;
      camera.centerY = pinch.worldV - (sv - 0.5) / camera.zoom;
      clampCamera();
      zoomInput.value = String(camera.zoom);
      syncRangeReadouts();
      e.preventDefault();
      return;
    }
  }

  if (pan.down && e.pointerId === pan.pointerId) {
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - pan.startX) / Math.max(1, rect.width);
    const dy = (e.clientY - pan.startY) / Math.max(1, rect.height);
    camera.centerX = pan.startCenterX - dx / camera.zoom;
    camera.centerY = pan.startCenterY + dy / camera.zoom;
    clampCamera();
    return;
  }

  const { x, y } = eventToGrid(e);
  cursor.x = x;
  cursor.y = y;
  cursor.has = true;
  if (copySel.active && e.pointerId === copySel.pointerId) {
    copySel.x1 = x;
    copySel.y1 = y;
    return;
  }
  if (brush.down) {
    brush.x = x;
    brush.y = y;
  }
});

function endBrush() {
  brush.down = false;
}

canvas.addEventListener("pointerup", endBrush);
canvas.addEventListener("pointercancel", endBrush);
canvas.addEventListener("pointerleave", () => {
  cursor.has = false;
  pointerScreen.has = false;
});

canvas.addEventListener("pointerup", (e) => {
  if (pan.down && e.pointerId === pan.pointerId) pan.down = false;
  if (e.pointerType === "touch") {
    touchPoints.delete(e.pointerId);
    if (touchPoints.size < 2) pinch = null;
    pointerScreen.has = false;
    cursor.has = false;
  }

  if (copySel.active && e.pointerId === copySel.pointerId) {
    const x0 = clampInt(Math.min(copySel.x0, copySel.x1), 0, sim.width - 1);
    const x1 = clampInt(Math.max(copySel.x0, copySel.x1), 0, sim.width - 1);
    const y0 = clampInt(Math.min(copySel.y0, copySel.y1), 0, sim.height - 1);
    const y1 = clampInt(Math.max(copySel.y0, copySel.y1), 0, sim.height - 1);
    cancelCopySelection();

    const w = (x1 - x0 + 1) | 0;
    const h = (y1 - y0 + 1) | 0;
    const raw = sim.readRegion(x0, y0, w, h);

    const base = document.createElement("canvas");
    base.width = w;
    base.height = h;
    const ctx = base.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let iy = 0; iy < h; iy++) {
      const dstY = h - 1 - iy;
      for (let ix = 0; ix < w; ix++) {
        const s = (iy * w + ix) * 4;
        const id = raw[s] | 0;
        const o = (dstY * w + ix) * 4;
        if (id === Particle.EMPTY) {
          d[o + 0] = 255;
          d[o + 1] = 255;
          d[o + 2] = 255;
          d[o + 3] = 255;
          continue;
        }
        const def = particleDefs[id];
        const col = def ? def.color : particleDefs[Particle.STONE].color;
        d[o + 0] = col[0] | 0;
        d[o + 1] = col[1] | 0;
        d[o + 2] = col[2] | 0;
        d[o + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
    stamp = { base, srcW: w, srcH: h, w, h };
    stampMode.checked = true;
    setTool("stamp");
    syncStampInputsFromState();
    pushRecentStamp(stamp);
  }
});
canvas.addEventListener("pointercancel", (e) => {
  if (pan.down && e.pointerId === pan.pointerId) pan.down = false;
  if (e.pointerType === "touch") {
    touchPoints.delete(e.pointerId);
    if (touchPoints.size < 2) pinch = null;
    pointerScreen.has = false;
    cursor.has = false;
  }
  if (copySel.active && e.pointerId === copySel.pointerId) cancelCopySelection();
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    pointerScreen.has = true;
    pointerScreen.clientX = e.clientX;
    pointerScreen.clientY = e.clientY;

    if (stampMode.checked && stamp && activeLevel.id === LEVEL_ID.SANDBOX && (e.ctrlKey || e.metaKey)) {
      const factor = Math.exp(-e.deltaY * 0.002);
      const nextW = Math.max(1, Math.round(stamp.w * factor));
      const nextH = stampLock.checked ? Math.max(1, Math.round((nextW * stamp.srcH) / Math.max(1, stamp.srcW))) : Math.max(1, Math.round(stamp.h * factor));
      setStampSize(nextW, nextH);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const su = clamp(nx, 0, 1);
    const sv = clamp(1 - ny, 0, 1);

    const worldU = (su - 0.5) / camera.zoom + camera.centerX;
    const worldV = (sv - 0.5) / camera.zoom + camera.centerY;

    const factor = Math.exp(-e.deltaY * 0.002);
    camera.zoom = clamp(camera.zoom * factor, 1, 8);
    camera.centerX = worldU - (su - 0.5) / camera.zoom;
    camera.centerY = worldV - (sv - 0.5) / camera.zoom;
    clampCamera();

    zoomInput.value = String(camera.zoom);
    syncRangeReadouts();
  },
  { passive: false },
);

let running = true;
let stepOnce = false;

// Allows fractional "steps per frame" by accumulating budget over frames.
let simStepAcc = 0;

/** @type {null | {startNow: number, holdMs: number, durationMs: number}} */
let startupStepRamp = null;

const MAX_STEPS_PER_FRAME = 8;
const MIN_STEPS_PER_SECOND = 0;
const MAX_STEPS_PER_SECOND = 1000;

function cancelStartupStepRamp() {
  startupStepRamp = null;
}

function startStartupStepRamp() {
  startupStepRamp = { startNow: performance.now(), holdMs: 500, durationMs: 3000 };
  running = false;
  playPauseBtn.textContent = "Play";
}

playPauseBtn.addEventListener("click", () => {
  cancelStartupStepRamp();
  running = !running;
  playPauseBtn.textContent = running ? "Pause" : "Play";
});

stepBtn.addEventListener("click", () => {
  cancelStartupStepRamp();
  stepOnce = true;
});

clearBtn.addEventListener("click", () => {
  if (activeLevel.id !== LEVEL_ID.SANDBOX) setActiveLevel(activeLevel.id);
  else sim.clear();
});

viewSelect.addEventListener("change", () => {
  sim.setViewMode(/** @type {ViewMode} */ (viewSelect.value));
});

sim.caRule = clampInt(Number(caRule.value) || 0, 0, 255);
caRule.value = String(sim.caRule);
sim.caInterval = Math.max(1, Number(caInterval.value) | 0);
caInterval.value = String(sim.caInterval);
sim.caPaintId = Number(caPaintSelect.value) | 0;
caPaintSelect.value = String(sim.caPaintId);

caMode.checked = sim.caEnabled;
caMode.addEventListener("change", async () => {
  const want = caMode.checked;
  caMode.disabled = true;
  try {
    await sim.setCaEnabled(want);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notify(`ca failed: ${msg}`);
  } finally {
    caMode.checked = sim.caEnabled;
    caMode.disabled = false;
  }
});

caPaintSelect.addEventListener("change", () => {
  sim.caPaintId = Number(caPaintSelect.value) | 0;
});

sim.golInterval = Math.max(1, Number(golRate.value) | 0);
golRate.value = String(sim.golInterval);
golRateControl.hidden = false;
golRate.disabled = false;
golMode.checked = sim.golEnabled;
golMode.addEventListener("change", async () => {
  const want = golMode.checked;
  golMode.disabled = true;
  golRate.disabled = true;
  try {
    await sim.setGolEnabled(want);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notify(`life failed: ${msg}`);
  } finally {
    golMode.checked = sim.golEnabled;
    golRateControl.hidden = false;
    golRate.disabled = false;
    golMode.disabled = false;
  }
});

resSelect.addEventListener("change", () => {
  if (activeLevel.id !== LEVEL_ID.SANDBOX) return;
  const { width, height } = parseRes(resSelect.value);
  sim.setWorldSize(width, height);
  if (stamp) setStampSize(stamp.w, stamp.h);
  clampCamera();
});

levelSelect.addEventListener("change", () => {
  setActiveLevel(levelSelect.value);
});

/**
 * @param {boolean} open
 */
function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

settingsBtn.addEventListener("click", () => {
  setSettingsOpen(settingsPanel.hidden);
});

setSettingsOpen(false);

window.addEventListener(
  "pointerdown",
  (e) => {
    if (settingsPanel.hidden) return;
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (settingsBtn.contains(t) || settingsPanel.contains(t)) return;
    setSettingsOpen(false);

    // If you tapped the canvas while the menu was open, treat it as a "close menu"
    // gesture instead of also drawing a particle stroke.
    if (!topbar?.contains(t)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  { capture: true },
);

let lastNow = performance.now();
let fps = 60;
let lastStatusNow = 0;
let simEffectiveSpsEma = 0;
let simTargetSpsForUi = 0;
let simSlow = false;
let lastUserRateChangeNow = performance.now();
let lastAutoTuneNow = 0;

function syncCaRuleReadout() {
  if (!caRuleValue) return;
  const n = clampInt(Number(caRule.value) || 0, 0, 255);
  caRuleValue.textContent = String(n);
}

function syncCaIntervalReadout() {
  if (!caIntervalValue) return;
  const n = Math.max(1, Number(caInterval.value) | 0);
  caIntervalValue.textContent = n === 1 ? "every tick" : `every ${n} ticks`;
}

function syncGolRateReadout() {
  if (!golRateValue) return;
  const n = Math.max(1, Number(golRate.value) | 0);
  golRateValue.textContent = n === 1 ? "every tick" : `every ${n} ticks`;
}

function syncRangeReadouts() {
  if (brushSizeValue) brushSizeValue.textContent = brushSize.value;
  if (zoomValue) zoomValue.textContent = `${Number(camera.zoom).toFixed(1)}×`;
  syncCaRuleReadout();
  syncCaIntervalReadout();
  syncGolRateReadout();
  syncSimRateReadout();
}

brushSize.addEventListener("input", syncRangeReadouts);
simRate.addEventListener("input", syncRangeReadouts);
caRule.addEventListener("input", syncRangeReadouts);
caRule.addEventListener("input", () => {
  sim.caRule = clampInt(Number(caRule.value) || 0, 0, 255);
});
caInterval.addEventListener("input", syncRangeReadouts);
caInterval.addEventListener("input", () => {
  sim.caInterval = Math.max(1, Number(caInterval.value) | 0);
});
golRate.addEventListener("input", syncRangeReadouts);
golRate.addEventListener("input", () => {
  sim.golInterval = Math.max(1, Number(golRate.value) | 0);
});
simRate.addEventListener("input", () => {
  lastUserRateChangeNow = performance.now();
});
syncRangeReadouts();

function nominalFps() {
  return clamp(fps, 10, 240);
}

function syncSimRateReadout() {
  if (!simRateValue) return;
  const m = /** @type {'sps'|'spf'} */ (rateMode.value);
  const nf = nominalFps();
  if (m === "sps") {
    const sps = clamp(Number(simRate.value) || 0, MIN_STEPS_PER_SECOND, MAX_STEPS_PER_SECOND);
    const approxSpf = clamp(sps / Math.max(1, nf), 0, MAX_STEPS_PER_FRAME);
    simRateValue.textContent = `${Math.round(sps)}/s (~${approxSpf.toFixed(1)}/f)`;
  } else {
    const spf = clampInt(Number(simRate.value) || 0, 0, MAX_STEPS_PER_FRAME);
    const approxSps = spf * nf;
    simRateValue.textContent = `${spf}/f (~${Math.round(approxSps)}/s)`;
  }
}

function syncRateUi() {
  const m = /** @type {'sps'|'spf'} */ (rateMode.value);
  if (m === "sps") {
    simRateLabel.textContent = "Steps/sec";
    simRate.min = String(MIN_STEPS_PER_SECOND);
    simRate.max = String(MAX_STEPS_PER_SECOND);
    simRate.step = "1";
  } else {
    simRateLabel.textContent = "Steps/frame";
    simRate.min = "0";
    simRate.max = String(MAX_STEPS_PER_FRAME);
    simRate.step = "1";
  }
  syncSimRateReadout();
}

rateMode.addEventListener("change", () => {
  cancelStartupStepRamp();
  lastUserRateChangeNow = performance.now();
  const nf = nominalFps();
  const m = /** @type {'sps'|'spf'} */ (rateMode.value);
  if (m === "spf") {
    const sps = clamp(Number(simRate.value) || 0, MIN_STEPS_PER_SECOND, MAX_STEPS_PER_SECOND);
    simRate.value = String(clampInt(Math.round(sps / Math.max(1, nf)), 0, MAX_STEPS_PER_FRAME));
  } else {
    const spf = clampInt(Number(simRate.value) || 0, 0, MAX_STEPS_PER_FRAME);
    simRate.value = String(clampInt(Math.round(spf * nf), MIN_STEPS_PER_SECOND, MAX_STEPS_PER_SECOND));
  }
  syncRateUi();
});

syncRateUi();

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * @param {string} levelId
 */
function setActiveLevel(levelId) {
  const next = levels.find((l) => l.id === levelId) ?? levels[0];
  activeLevel = next;
  levelComplete = false;
  goalStable = 0;
  lastGoalCheckNow = 0;
  remainingBudget = typeof next.budget === "number" ? next.budget : null;

  const isSandbox = next.id === LEVEL_ID.SANDBOX;

  levelSelect.value = next.id;
  particleSelect.disabled = !isSandbox;
  for (const el of particleHotbar.querySelectorAll("button")) {
    if (el instanceof HTMLButtonElement) el.disabled = !isSandbox;
  }
  particleMoreBtn.disabled = !isSandbox;
  toolStampBtn.disabled = !isSandbox;
  toolCopyBtn.disabled = !isSandbox;
  resSelect.disabled = !isSandbox;
  pasteEdgeStone.disabled = !isSandbox;
  agentPaintSelect.disabled = !isSandbox;
  agentDirSelect.disabled = !isSandbox;
  agentDrill.disabled = !isSandbox;
  if (!isSandbox) clearStamp();
  else syncStampInputsFromState();
  clearBtn.textContent = isSandbox ? "Clear" : "Restart";
  levelHintEl.textContent = isSandbox ? "" : next.hints.join(" ");

  if (isSandbox) {
    particleSelect.value = String(Particle.SAND);
    syncParticleUi();
    const { width, height } = parseRes(resSelect.value);
    if (sim.width !== width || sim.height !== height) sim.setWorldSize(width, height);
    else sim.clear();
    if (stamp) setStampSize(stamp.w, stamp.h);
    clampCamera();
    void autoStampStartupOnce();
    return;
  }

  if (sim.width !== next.size.width || sim.height !== next.size.height) {
    sim.setWorldSize(next.size.width, next.size.height);
  } else {
    sim.clear();
  }

  sim.seed = next.seed >>> 0;

  const { source, width, height, originX, originY } = next.buildStamp();
  sim.stampImage(source, width, height, originX, originY, { edgeStone: false, addMode: false });

  particleSelect.value = String(next.allowedPaintIds[0] ?? Particle.STONE);
  syncParticleUi();
}

setActiveLevel(levelSelect.value);

/**
 * @param {number} w
 * @param {number} h
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
function makeOffscreenCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * @param {CanvasImageSource} source
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} dstW
 * @param {number} dstH
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
function rasterizeToOffscreen(source, srcW, srcH, dstW, dstH) {
  const out = makeOffscreenCanvas(dstW, dstH);
  // @ts-ignore - OffscreenCanvas/HTMLCanvasElement share getContext at runtime.
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  // @ts-ignore - imageSmoothingQuality isn't in all TS libs.
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, dstW, dstH);
  // @ts-ignore - CanvasImageSource is valid for drawImage.
  ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
  return out;
}

/**
 * @param {Blob} blob
 * @returns {Promise<{source: CanvasImageSource, width: number, height: number, cleanup: (() => void) | null}>}
 */
async function decodeImageBlob(blob) {
  if ("createImageBitmap" in window) {
    // @ts-ignore - createImageBitmap exists at runtime.
    const bmp = await createImageBitmap(blob);
    return {
      source: bmp,
      width: bmp.width,
      height: bmp.height,
      cleanup: typeof bmp.close === "function" ? () => bmp.close() : null,
    };
  }

  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    if (typeof img.decode === "function") await img.decode();
    else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    }
    return { source: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, cleanup: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function startupImageUrlFromQuery() {
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get("img") || sp.get("image");
  if (!raw) return null;
  const s = raw.trim();
  try {
    const normalized =
      s.startsWith("http://") || s.startsWith("https://")
        ? s
        : s.startsWith("//")
          ? `https:${s}`
          : /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(s)
            ? `https://${s}`
            : s;

    const u = new URL(normalized, window.location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * @param {Blob} blob
 */
async function stampWorldFromBlob(blob) {
  if (!sim) return;
  if (activeLevel.id !== LEVEL_ID.SANDBOX) return;
  const { source, width: srcW, height: srcH, cleanup } = await decodeImageBlob(blob);

  const w = Math.max(1, sim.width - 2);
  const h = Math.max(1, sim.height - 1);
  const offscreen = rasterizeToOffscreen(source, srcW, srcH, w, h);
  if (cleanup) cleanup();

  // @ts-ignore - OffscreenCanvas is a valid CanvasImageSource at runtime.
  sim.stampImage(offscreen, w, h, 1, 1, { edgeStone: pasteEdgeStone.checked, addMode: false });
  startStartupStepRamp();
}

/**
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function tryStampWorldFromUrl(url) {
  if (!sim) return false;
  if (activeLevel.id !== LEVEL_ID.SANDBOX) return false;
  try {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = (r.headers.get("content-type") || "").toLowerCase().trim();
    if (ct && !ct.startsWith("image/")) throw new Error(`not an image (content-type: ${ct})`);
    if (!ct) {
      const u = new URL(url);
      const p = u.pathname.toLowerCase();
      const okExt =
        p.endsWith(".png") ||
        p.endsWith(".jpg") ||
        p.endsWith(".jpeg") ||
        p.endsWith(".webp") ||
        p.endsWith(".gif") ||
        p.endsWith(".bmp") ||
        p.endsWith(".avif");
      if (!okExt) throw new Error("not an image url");
    }
    await stampWorldFromBlob(await r.blob());
    return true;
  } catch (err) {
    return false;
  }
}

async function autoStampStartupOnce() {
  if (didAutoStartupStamp) return;
  didAutoStartupStamp = true;
  if (!sim) return;
  if (activeLevel.id !== LEVEL_ID.SANDBOX) return;

  const url = startupImageUrlFromQuery();
  if (url) {
    const ok = await tryStampWorldFromUrl(url);
    if (ok) return;
  }

  const urls = ["./assets/poster.jpg", "./assets/poster.png"];
  let res = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "force-cache" });
      if (r.ok) {
        res = r;
        break;
      }
    } catch {
      // ignore and try next
    }
  }
  if (!res) return;

  try {
    await stampWorldFromBlob(await res.blob());
  } catch {
    // silent: poster is optional
  }
}

/**
 * @param {Blob} blob
 * @param {{noScale?: boolean} | undefined} [opts]
 */
async function loadStampFromBlob(blob, opts) {
  if (!sim) return;
  if (activeLevel.id !== LEVEL_ID.SANDBOX) {
    notify("paste disabled in levels");
    return;
  }

  const noScale = opts?.noScale ?? false;
  const { source, width: srcW, height: srcH, cleanup } = await decodeImageBlob(blob);

  const maxW = Math.max(1, sim.width - 2);
  const maxH = Math.max(1, sim.height - 1);
  const initialScale = noScale ? 1 : Math.min(1, maxW / Math.max(1, srcW), maxH / Math.max(1, srcH));
  const baseW = clampInt(Math.max(1, Math.round(srcW * initialScale)), 1, maxW);
  const baseH = clampInt(Math.max(1, Math.round(srcH * initialScale)), 1, maxH);

  const base = rasterizeToOffscreen(source, srcW, srcH, baseW, baseH);

  if (cleanup) cleanup();

  stamp = { base, srcW: baseW, srcH: baseH, w: baseW, h: baseH };
  stampMode.checked = true;
  setTool("stamp");
  syncStampInputsFromState();
  pushRecentStamp(stamp);
}

/**
 * @param {number} x
 * @param {number} y
 */
function placeStampAt(x, y) {
  if (!sim || !stamp) return;
  if (activeLevel.id !== LEVEL_ID.SANDBOX) return;

  const w = stamp.w | 0;
  const h = stamp.h | 0;

  const maxW = Math.max(1, sim.width - 2);
  const maxH = Math.max(1, sim.height - 1);
  const clampedW = clampInt(w, 1, maxW);
  const clampedH = clampInt(h, 1, maxH);

  let ox = Math.round(x - clampedW / 2);
  let oy = Math.round(y - clampedH / 2);
  ox = clamp(ox, 1, sim.width - 1 - clampedW);
  oy = clamp(oy, 1, sim.height - clampedH);

  if (clampedW === stamp.srcW && clampedH === stamp.srcH) {
    // @ts-ignore - OffscreenCanvas is a valid CanvasImageSource at runtime.
    sim.stampImage(stamp.base, clampedW, clampedH, ox, oy, { edgeStone: pasteEdgeStone.checked, addMode: addMode.checked });
    return;
  }

  const out = rasterizeToOffscreen(stamp.base, stamp.srcW, stamp.srcH, clampedW, clampedH);
  // @ts-ignore - OffscreenCanvas is a valid CanvasImageSource at runtime.
  sim.stampImage(out, clampedW, clampedH, ox, oy, { edgeStone: pasteEdgeStone.checked, addMode: addMode.checked });
}

/**
 * @returns {Promise<Blob | null>}
 */
async function readClipboardImageBlob() {
  const cb = navigator.clipboard;
  if (!cb) return null;
  // @ts-ignore - clipboard.read isn't available in all TS libs.
  if (typeof cb.read !== "function") return null;

  /** @type {any[]} */
  // @ts-ignore - clipboard.read isn't available in all TS libs.
  const items = await cb.read();
  for (const item of items) {
    /** @type {string[]} */
    const types = item.types ?? [];
    for (const t of types) {
      if (typeof t === "string" && t.startsWith("image/")) {
        // @ts-ignore - ClipboardItem#getType exists at runtime.
        return await item.getType(t);
      }
    }
  }
  return null;
}

const pasteFileInput = document.createElement("input");
pasteFileInput.type = "file";
pasteFileInput.accept = "image/*";
pasteFileInput.tabIndex = -1;
pasteFileInput.style.position = "fixed";
pasteFileInput.style.left = "-10000px";
pasteFileInput.style.top = "0";
pasteFileInput.setAttribute("aria-hidden", "true");
document.body.appendChild(pasteFileInput);

pasteFileInput.addEventListener("change", async () => {
  const file = pasteFileInput.files && pasteFileInput.files[0] ? pasteFileInput.files[0] : null;
  pasteFileInput.value = "";
  if (!file) return;
  try {
    await loadStampFromBlob(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notify(`paste failed: ${msg}`);
  }
});

/**
 * @param {boolean} noScale
 */
async function startPasteFlow(noScale) {
  if (activeLevel.id !== LEVEL_ID.SANDBOX) {
    notify("paste disabled in levels");
    return;
  }

  setSettingsOpen(false);

  const isCoarse = window.matchMedia("(pointer: coarse)").matches;
  const cb = navigator.clipboard;
  // @ts-ignore - clipboard.read isn't available in all TS libs.
  const canRead = !!cb && typeof cb.read === "function";
  if (canRead) {
    try {
      const blob = await readClipboardImageBlob();
      if (!blob) {
        notify("clipboard has no image");
        pasteFileInput.click();
        return;
      }
      try {
        await loadStampFromBlob(blob, { noScale });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notify(`paste failed: ${msg}`);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`clipboard blocked: ${msg}`);
      if (isCoarse) {
        pasteFileInput.click();
        return;
      }
    }
  }

  pasteFileInput.click();
}

window.addEventListener("paste", async (e) => {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
  if (activeLevel.id !== LEVEL_ID.SANDBOX) {
    notify("paste disabled in levels");
    return;
  }

  const data = e.clipboardData;
  if (!data) return;

  /** @type {File | null} */
  let file = null;
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.type && item.type.startsWith("image/")) {
      file = item.getAsFile();
      if (file) break;
    }
  }
  if (!file) return;

  e.preventDefault();
  try {
    await loadStampFromBlob(file, { noScale: e.shiftKey });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notify(`paste failed: ${msg}`);
  }
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

  // Don't treat OS/browser shortcuts as simulation hotkeys (e.g. Cmd+V would
  // otherwise trigger the "v" particle hotkey).
  if (e.metaKey || e.ctrlKey) return;

  if (e.key === "Shift") keyShiftDown = true;

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    keyPan.left = true;
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    keyPan.right = true;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    keyPan.up = true;
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    keyPan.down = true;
    return;
  }

  if (!particlePicker.hidden && e.key === "Escape") {
    e.preventDefault();
    setParticlePickerOpen(false);
    return;
  }

  if (!settingsPanel.hidden && e.key === "Escape") {
    e.preventDefault();
    setSettingsOpen(false);
    settingsBtn.focus();
    return;
  }

  if (activeTool === "copy" && copySel.active && e.key === "Escape") {
    e.preventDefault();
    cancelCopySelection();
    return;
  }

  if (e.key === "x" || e.key === "X") {
    if (activeLevel.id !== LEVEL_ID.SANDBOX) return;
    e.preventDefault();
    setTool("copy");
    return;
  }

  if (e.key === "a" || e.key === "A") {
    e.preventDefault();
    addMode.checked = !addMode.checked;
    return;
  }

  if (e.code === "Space") {
    e.preventDefault();
    cancelStartupStepRamp();
    running = !running;
    playPauseBtn.textContent = running ? "Pause" : "Play";
    return;
  }

  if (e.key === "c" || e.key === "C") {
    if (activeLevel.id !== LEVEL_ID.SANDBOX) setActiveLevel(activeLevel.id);
    else sim.clear();
    return;
  }

  if (e.key === "[" || e.key === "]") {
    const delta = e.key === "[" ? -1 : 1;
    const v = clamp((Number(brushSize.value) | 0) + delta, Number(brushSize.min) | 0, Number(brushSize.max) | 0);
    brushSize.value = String(v);
    return;
  }

  if (e.key === "t" || e.key === "T") {
    viewSelect.value = viewSelect.value === "material" ? "temperature" : "material";
    sim.setViewMode(/** @type {ViewMode} */ (viewSelect.value));
    return;
  }

  /** @type {Record<string, number>} */
  const hotkeys = {
    "1": Particle.SAND,
    "2": Particle.WATER,
    "3": Particle.STONE,
    "4": Particle.DIRT,
    "5": Particle.MUD,
    "6": Particle.OIL,
    "7": Particle.PLANT,
    "8": Particle.FIRE,
    "9": Particle.SMOKE,
    "0": Particle.STEAM,
    "-": Particle.LAVA,
    "=": Particle.ACID,
    i: Particle.ICE,
    s: Particle.SALT,
    b: Particle.BRINE,
    w: Particle.WIRE,
    e: Particle.SPARK,
    v: Particle.BATTERY,
  };
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k in hotkeys) {
    if (activeLevel.id !== LEVEL_ID.SANDBOX) return;
    setSelectedParticle(hotkeys[k]);
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") keyShiftDown = false;
  else if (e.key === "ArrowLeft") keyPan.left = false;
  else if (e.key === "ArrowRight") keyPan.right = false;
  else if (e.key === "ArrowUp") keyPan.up = false;
  else if (e.key === "ArrowDown") keyPan.down = false;
});

window.addEventListener("blur", () => {
  keyPan.left = false;
  keyPan.right = false;
  keyPan.up = false;
  keyPan.down = false;
  keyShiftDown = false;
});

function loop(now) {
  const dtMsRaw = now - lastNow;
  let dtMs = dtMsRaw;
  if (dtMs > 1000) {
    if (startupStepRamp) startupStepRamp.startNow += dtMs;
    dtMs = 0;
  }
  lastNow = now;

  sim.resizeCanvasToDisplaySize();
  resizeCanvasToDisplaySize(cursorCanvas);

  // Brush gets applied in the animation loop so we don't thrash GPU from event handlers.
  if (brush.down) {
    if (cursor.has) {
      brush.x = cursor.x;
      brush.y = cursor.y;
    }
    const x0 = brush.lastX;
    const y0 = brush.lastY;
    const x1 = brush.x;
    const y1 = brush.y;
    const dx = x1 - x0;
    const dy = y1 - y0;
    /** @type {0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|null} */
    let agentDir = null;
    const selectedParticle = Number(particleSelect.value) | 0;
    if (selectedParticle === Particle.BOT || selectedParticle === Particle.GLIDER) {
      const picked = agentDirSelect.value;
      if (picked !== "auto") agentDir = /** @type {0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15} */ (clampInt(Number(picked) || 0, 0, 15));
      else if (dx !== 0 || dy !== 0) agentDir = dirIndex16FromDxDy(dx, dy);
    }
    forEachLinePoint(x0, y0, x1, y1, (x, y) => paintAt(x, y, brush.mode, agentDir));
    brush.lastX = x1;
    brush.lastY = y1;
    if (singlePaint.checked) brush.down = false;
  }

  const fpsDtMs = clamp(dtMsRaw, 1, 2000);
  const instFps = 1000 / fpsDtMs;
  // Exponential smoothing with a fixed time constant (so it converges quickly even at very low FPS)
  const fpsAlpha = 1 - Math.exp(-(fpsDtMs / 1000) / 0.5);
  fps += (instFps - fps) * fpsAlpha;
  const uiFps = Math.min(fps, instFps);

  const dtSeconds = dtMs / 1000;

  if (keyPan.left || keyPan.right || keyPan.up || keyPan.down) {
    let dx = (keyPan.right ? 1 : 0) - (keyPan.left ? 1 : 0);
    let dy = (keyPan.up ? 1 : 0) - (keyPan.down ? 1 : 0);
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
      const speed = keyShiftDown ? 1.2 : 0.45; // screens per second
      const k = (speed * dtSeconds) / camera.zoom;
      camera.centerX += dx * k;
      camera.centerY += dy * k;
      clampCamera();
    }
  }

  const mode = /** @type {'sps'|'spf'} */ (rateMode.value);
  simSlow = false;
  simTargetSpsForUi = 0;

  /** @type {number} */
  let targetSpsForFrame = 0;
  /** @type {number} */
  let maxBacklogSteps = MAX_STEPS_PER_FRAME;

  if (mode === "sps") {
    const targetSps = clamp(Number(simRate.value) || 0, MIN_STEPS_PER_SECOND, MAX_STEPS_PER_SECOND);
    targetSpsForFrame = targetSps;
    maxBacklogSteps = Math.max(MAX_STEPS_PER_FRAME, targetSps * 0.2);
    let currentSps = 0;
    if (startupStepRamp) {
      const t = clamp((now - startupStepRamp.startNow - startupStepRamp.holdMs) / Math.max(1, startupStepRamp.durationMs), 0, 1);
      currentSps = targetSps * t;
      if (t >= 1) {
        startupStepRamp = null;
        running = true;
        playPauseBtn.textContent = "Pause";
      }
    } else if (running) {
      currentSps = targetSps;
    } else if (stepOnce) {
      simStepAcc += 1;
      stepOnce = false;
    }
    simStepAcc += currentSps * dtSeconds;
  } else {
    const targetSpf = clampInt(Number(simRate.value) || 0, 0, MAX_STEPS_PER_FRAME);
    targetSpsForFrame = 0;
    maxBacklogSteps = MAX_STEPS_PER_FRAME * 2;
    if (startupStepRamp) {
      const t = clamp((now - startupStepRamp.startNow - startupStepRamp.holdMs) / Math.max(1, startupStepRamp.durationMs), 0, 1);
      simStepAcc += targetSpf * t;
      if (t >= 1) {
        startupStepRamp = null;
        running = true;
        playPauseBtn.textContent = "Pause";
      }
    } else if (running) {
      simStepAcc += targetSpf;
    } else if (stepOnce) {
      simStepAcc += 1;
      stepOnce = false;
    }
  }

  // Avoid building a long backlog when the GPU can't keep up. We already cap
  // steps-per-frame, so allowing the accumulator to grow just makes the UI feel
  // "stuck" trying to catch up.
  if (simStepAcc > maxBacklogSteps) simStepAcc = maxBacklogSteps;

  const rawSteps = simStepAcc | 0;
  const steps = clampInt(rawSteps, 0, MAX_STEPS_PER_FRAME);
  const overflowed = rawSteps > MAX_STEPS_PER_FRAME;
  if (overflowed) simStepAcc = 0;
  else simStepAcc -= steps;
  for (let i = 0; i < steps; i++) sim.step();

  if (dtSeconds > 0) {
    const effSps = steps / dtSeconds;
    const spsAlpha = 1 - Math.exp(-dtSeconds / 0.6);
    simEffectiveSpsEma += (effSps - simEffectiveSpsEma) * spsAlpha;
  }

  if (mode === "sps") {
    simTargetSpsForUi = targetSpsForFrame;
    const target = targetSpsForFrame;
    const eff = simEffectiveSpsEma;
    const gpuBound = running && !startupStepRamp && target > 0 && (overflowed || (steps === MAX_STEPS_PER_FRAME && eff + 5 < target));
    const fpsUiBad = running && !startupStepRamp && uiFps < 12 && steps > 0;
    simSlow = (gpuBound && eff < target * 0.92) || fpsUiBad;

    const userRecentlyChanged = now - lastUserRateChangeNow < 2000;
    const canAutoTune = running && !startupStepRamp && !userRecentlyChanged;
    const autoTuneIntervalMs = fpsUiBad ? 250 : 650;
    if (canAutoTune && (gpuBound || fpsUiBad) && now - lastAutoTuneNow > autoTuneIntervalMs) {
      // Reduce requested SPS toward what the machine can sustain (only decreases).
      const current = clamp(Number(simRate.value) || 0, MIN_STEPS_PER_SECOND, MAX_STEPS_PER_SECOND);
      const quantum = clampInt(Math.round(current * 0.05), 1, 50);
      const suggestedByThroughput = eff * 0.92;
      const suggestedByUi = fpsUiBad ? uiFps * 2 : target;
      const desiredFloat = Math.max(1, Math.min(suggestedByThroughput, suggestedByUi));
      const desired = clamp(Math.floor(desiredFloat / quantum) * quantum, 1, MAX_STEPS_PER_SECOND);

      // Apply a capped proportional reduction to avoid big SPS jumps.
      const maxDropRaw = fpsUiBad ? Math.max(quantum, Math.round(current * 0.45)) : Math.max(quantum, Math.round(current * 0.15));
      const maxDrop = Math.max(quantum, Math.round(maxDropRaw / quantum) * quantum);
      const next = clamp(Math.max(desired, current - maxDrop), 1, MAX_STEPS_PER_SECOND);

      if (next < current) {
        simRate.value = String(next);
        syncRangeReadouts();
        lastAutoTuneNow = now;
      }
    }
  } else {
    simTargetSpsForUi = 0;
  }

  if (activeLevel.goal && !levelComplete && now - lastGoalCheckNow > 250) {
    lastGoalCheckNow = now;
    const goal = activeLevel.goal;
    const cell = sim.readCell(goal.x, goal.y);
    if (cell.id === goal.wantId) goalStable++;
    else goalStable = 0;

    if (goalStable >= goal.stableChecks) {
      levelComplete = true;
      running = false;
      playPauseBtn.textContent = "Play";
      notify("level complete");
    }
  }

  sim.render();
  drawBrushCursor();

  if (now - lastStatusNow > 180) {
    lastStatusNow = now;
    syncSimRateReadout();
    const lvl = activeLevel.id === LEVEL_ID.SANDBOX ? "" : ` • ${activeLevel.name}`;
    const budget = remainingBudget === null ? "" : ` • stone ${remainingBudget}`;
    const done = levelComplete ? " • complete" : "";
    const simRateText =
      mode === "sps" && simTargetSpsForUi > 0
        ? (() => {
            const target = Math.round(simTargetSpsForUi);
            const eff = Math.round(simEffectiveSpsEma);
            const tol = Math.max(2, Math.round(target * 0.06));
            const match = Math.abs(eff - target) <= tol && !simSlow;
            return match ? ` • sim ${target} sps` : ` • sim ${eff}/${target} sps${simSlow ? " slow" : ""}`;
          })()
        : "";
    const statusText = `${sim.width}×${sim.height}${lvl}${budget}${done}${simRateText} • tick ${sim.tick} • ${fps.toFixed(0)} fps`;
    setText(statusEl, statusText);
    statusEl.title = statusText;
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

/**
 * @param {HTMLCanvasElement} c
 */
function resizeCanvasToDisplaySize(c) {
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

function drawBrushCursor() {
  if (!cursorCtx) return;
  const w = cursorCanvas.width;
  const h = cursorCanvas.height;
  cursorCtx.clearRect(0, 0, w, h);
  if (!cursor.has) return;

  const x = clamp(cursor.x, 0, sim.width - 1);
  const y = clamp(cursor.y, 0, sim.height - 1);

  const sx = (w * camera.zoom) / sim.width;
  const sy = (h * camera.zoom) / sim.height;
  const cellPx = Math.max(1, Math.min(3, Math.round(Math.min(sx, sy))));

  const u = (x + 0.5) / sim.width;
  const v = (y + 0.5) / sim.height;
  const su = (u - camera.centerX) * camera.zoom + 0.5;
  const sv = (v - camera.centerY) * camera.zoom + 0.5;
  const cx = su * w;
  const cy = (1 - sv) * h;

  if (activeTool === "copy") {
    const xA = copySel.active ? copySel.x0 : x;
    const yA = copySel.active ? copySel.y0 : y;
    const xB = copySel.active ? copySel.x1 : x;
    const yB = copySel.active ? copySel.y1 : y;
    const ox = clampInt(Math.min(xA, xB), 0, sim.width - 1);
    const oy = clampInt(Math.min(yA, yB), 0, sim.height - 1);
    const ex = clampInt(Math.max(xA, xB) + 1, 0, sim.width);
    const ey = clampInt(Math.max(yA, yB) + 1, 0, sim.height);

    const u0 = ox / sim.width;
    const v0 = oy / sim.height;
    const u1 = ex / sim.width;
    const v1 = ey / sim.height;
    const su0 = (u0 - camera.centerX) * camera.zoom + 0.5;
    const sv0 = (v0 - camera.centerY) * camera.zoom + 0.5;
    const su1 = (u1 - camera.centerX) * camera.zoom + 0.5;
    const sv1 = (v1 - camera.centerY) * camera.zoom + 0.5;

    const left = su0 * w;
    const right = su1 * w;
    const top = (1 - sv1) * h;
    const bottom = (1 - sv0) * h;
    const bw = right - left;
    const bh = bottom - top;

    cursorCtx.save();
    cursorCtx.beginPath();
    cursorCtx.rect(left, top, bw, bh);
    cursorCtx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    cursorCtx.lineWidth = cellPx + 2;
    cursorCtx.stroke();

    cursorCtx.setLineDash([6 * cellPx, 4 * cellPx]);
    cursorCtx.beginPath();
    cursorCtx.rect(left, top, bw, bh);
    cursorCtx.strokeStyle = "rgba(124, 196, 255, 0.4)";
    cursorCtx.lineWidth = cellPx;
    cursorCtx.stroke();
    cursorCtx.setLineDash([]);
    cursorCtx.restore();
    return;
  }

  if (stampMode.checked && stamp) {
    const maxW = Math.max(1, sim.width - 2);
    const maxH = Math.max(1, sim.height - 1);
    const stampW0 = clampInt(stamp.w, 1, maxW);
    const stampH0 = clampInt(stamp.h, 1, maxH);

    let ox = Math.round(x - stampW0 / 2);
    let oy = Math.round(y - stampH0 / 2);
    ox = clamp(ox, 1, sim.width - 1 - stampW0);
    oy = clamp(oy, 1, sim.height - stampH0);

    const u0 = ox / sim.width;
    const v0 = oy / sim.height;
    const u1 = (ox + stampW0) / sim.width;
    const v1 = (oy + stampH0) / sim.height;
    const su0 = (u0 - camera.centerX) * camera.zoom + 0.5;
    const sv0 = (v0 - camera.centerY) * camera.zoom + 0.5;
    const su1 = (u1 - camera.centerX) * camera.zoom + 0.5;
    const sv1 = (v1 - camera.centerY) * camera.zoom + 0.5;

    const left = su0 * w;
    const right = su1 * w;
    const top = (1 - sv1) * h;
    const bottom = (1 - sv0) * h;
    const bw = right - left;
    const bh = bottom - top;

    cursorCtx.save();
    cursorCtx.beginPath();
    cursorCtx.rect(left, top, bw, bh);
    cursorCtx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    cursorCtx.lineWidth = cellPx + 2;
    cursorCtx.stroke();

    cursorCtx.setLineDash([6 * cellPx, 4 * cellPx]);
    cursorCtx.beginPath();
    cursorCtx.rect(left, top, bw, bh);
    cursorCtx.strokeStyle = "rgba(124, 196, 255, 0.4)";
    cursorCtx.lineWidth = cellPx;
    cursorCtx.stroke();
    cursorCtx.setLineDash([]);
    cursorCtx.restore();
    return;
  }

  const radiusUi = Number(brushSize.value) | 0;
  const radius = Math.max(0, radiusUi - 1);

  const rx = (radius + 0.5) * sx;
  const ry = (radius + 0.5) * sy;

  const color = brush.down && brush.mode === "erase" ? "rgba(255, 96, 96, 0.45)" : "rgba(124, 196, 255, 0.4)";

  if (radius === 0) {
    const left = cx - sx * 0.5;
    const top = cy - sy * 0.5;
    cursorCtx.save();
    cursorCtx.beginPath();
    cursorCtx.rect(left, top, sx, sy);
    cursorCtx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    cursorCtx.lineWidth = cellPx + 2;
    cursorCtx.stroke();

    cursorCtx.setLineDash([6 * cellPx, 4 * cellPx]);
    cursorCtx.beginPath();
    cursorCtx.rect(left, top, sx, sy);
    cursorCtx.strokeStyle = color;
    cursorCtx.lineWidth = cellPx;
    cursorCtx.stroke();
    cursorCtx.setLineDash([]);
    cursorCtx.restore();
    return;
  }

  cursorCtx.save();
  cursorCtx.translate(cx, cy);

  cursorCtx.beginPath();
  cursorCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  cursorCtx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  cursorCtx.lineWidth = cellPx + 2;
  cursorCtx.stroke();

  cursorCtx.setLineDash([6 * cellPx, 4 * cellPx]);
  cursorCtx.beginPath();
  cursorCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  cursorCtx.strokeStyle = color;
  cursorCtx.lineWidth = cellPx;
  cursorCtx.stroke();
  cursorCtx.setLineDash([]);

  cursorCtx.restore();
}

}
