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
const levelSelect = /** @type {HTMLSelectElement} */ (document.getElementById("levelSelect"));
const particleSelect = /** @type {HTMLSelectElement} */ (document.getElementById("particleSelect"));
const brushSize = /** @type {HTMLInputElement} */ (document.getElementById("brushSize"));
const rateMode = /** @type {HTMLSelectElement} */ (document.getElementById("rateMode"));
const simRateLabel = /** @type {HTMLSpanElement} */ (document.getElementById("simRateLabel"));
const simRate = /** @type {HTMLInputElement} */ (document.getElementById("simRate"));
const zoomInput = /** @type {HTMLInputElement} */ (document.getElementById("zoom"));
const viewSelect = /** @type {HTMLSelectElement} */ (document.getElementById("viewSelect"));
const resSelect = /** @type {HTMLSelectElement} */ (document.getElementById("resSelect"));
const pasteEdgeStone = /** @type {HTMLInputElement} */ (document.getElementById("pasteEdgeStone"));
const pasteBtn = /** @type {HTMLButtonElement} */ (document.getElementById("pasteBtn"));
const stampMode = /** @type {HTMLInputElement} */ (document.getElementById("stampMode"));
const stampW = /** @type {HTMLInputElement} */ (document.getElementById("stampW"));
const stampH = /** @type {HTMLInputElement} */ (document.getElementById("stampH"));
const stampLock = /** @type {HTMLInputElement} */ (document.getElementById("stampLock"));
const stampClearBtn = /** @type {HTMLButtonElement} */ (document.getElementById("stampClearBtn"));
const addMode = /** @type {HTMLInputElement} */ (document.getElementById("addMode"));
const levelHintEl = /** @type {HTMLElement} */ (document.getElementById("levelHint"));
const settingsBtn = /** @type {HTMLButtonElement} */ (document.getElementById("settingsBtn"));
const settingsPanel = /** @type {HTMLDivElement} */ (document.getElementById("settingsPanel"));
const brushSizeValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("brushSizeValue"));
const simRateValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("simRateValue"));
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
}
particleSelect.value = String(Particle.SAND);

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

/**
 * Let the browser paint (e.g. show a loading overlay) before starting expensive
 * WebGL compilation on cold startup.
 * @returns {Promise<void>}
 */
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function boot() {
  setText(hintStatusEl, "Initializing GPU…");
  setLoading(true, "Compiling shaders…");
  await nextFrame();

  try {
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
 */
function paintAt(x, y, mode) {
  const radius = Number(brushSize.value) | 0;
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
  sim.paintCircle(x, y, { id, temp: base.temp, data: base.data, flags: base.flags }, radius, { addMode: doAdd });
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

function syncStampInputsFromState() {
  if (!stamp) {
    stampMode.checked = false;
    stampW.value = "";
    stampH.value = "";
    stampW.disabled = true;
    stampH.disabled = true;
    stampLock.disabled = true;
    stampClearBtn.disabled = true;
    stampMode.disabled = true;
    return;
  }

  stampW.disabled = false;
  stampH.disabled = false;
  stampLock.disabled = false;
  stampClearBtn.disabled = false;
  stampMode.disabled = false;
  stampW.value = String(stamp.w);
  stampH.value = String(stamp.h);
}

function clearStamp() {
  stamp = null;
  syncStampInputsFromState();
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
stampMode.addEventListener("change", () => {
  if (!stamp) stampMode.checked = false;
});
stampClearBtn.addEventListener("click", () => {
  clearStamp();
});
syncStampInputsFromState();

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
    if (cell.id in particleDefs) particleSelect.value = String(cell.id);
    return;
  }

  brush.down = true;
  brush.mode = e.button === 2 || e.shiftKey ? "erase" : "paint";
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
});
canvas.addEventListener("pointercancel", (e) => {
  if (pan.down && e.pointerId === pan.pointerId) pan.down = false;
  if (e.pointerType === "touch") {
    touchPoints.delete(e.pointerId);
    if (touchPoints.size < 2) pinch = null;
    pointerScreen.has = false;
    cursor.has = false;
  }
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    pointerScreen.has = true;
    pointerScreen.clientX = e.clientX;
    pointerScreen.clientY = e.clientY;
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

function syncRangeReadouts() {
  if (brushSizeValue) brushSizeValue.textContent = brushSize.value;
  if (zoomValue) zoomValue.textContent = `${Number(camera.zoom).toFixed(1)}×`;
  syncSimRateReadout();
}

brushSize.addEventListener("input", syncRangeReadouts);
simRate.addEventListener("input", syncRangeReadouts);
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
  resSelect.disabled = !isSandbox;
  pasteEdgeStone.disabled = !isSandbox;
  pasteBtn.disabled = !isSandbox;
  if (!isSandbox) clearStamp();
  else syncStampInputsFromState();
  clearBtn.textContent = isSandbox ? "Clear" : "Restart";
  levelHintEl.textContent = isSandbox ? "" : next.hints.join(" ");

  if (isSandbox) {
    particleSelect.value = String(Particle.SAND);
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
  syncStampInputsFromState();
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

pasteBtn.addEventListener("click", async (e) => {
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
        if (isCoarse) pasteFileInput.click();
        return;
      }
      try {
        await loadStampFromBlob(blob, { noScale: e.shiftKey });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notify(`paste failed: ${msg}`);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`clipboard blocked: ${msg}`);
      if (isCoarse) pasteFileInput.click();
      return;
    }
  }

  pasteFileInput.click();
});

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

  if (!settingsPanel.hidden && e.key === "Escape") {
    e.preventDefault();
    setSettingsOpen(false);
    settingsBtn.focus();
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
    particleSelect.value = String(hotkeys[k]);
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
  let dtMs = now - lastNow;
  if (dtMs > 1000) {
    if (startupStepRamp) startupStepRamp.startNow += dtMs;
    dtMs = 0;
  }
  lastNow = now;

  sim.resizeCanvasToDisplaySize();
  resizeCanvasToDisplaySize(cursorCanvas);

  // Brush gets applied in the animation loop so we don't thrash GPU from event handlers.
  if (brush.down) {
    const x0 = brush.lastX;
    const y0 = brush.lastY;
    const x1 = brush.x;
    const y1 = brush.y;
    forEachLinePoint(x0, y0, x1, y1, (x, y) => paintAt(x, y, brush.mode));
    brush.lastX = x1;
    brush.lastY = y1;
  }

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

  if (mode === "sps") {
    const targetSps = clamp(Number(simRate.value) || 0, MIN_STEPS_PER_SECOND, MAX_STEPS_PER_SECOND);
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

  const rawSteps = simStepAcc | 0;
  const steps = clampInt(rawSteps, 0, MAX_STEPS_PER_FRAME);
  if (rawSteps > MAX_STEPS_PER_FRAME) simStepAcc = 0;
  else simStepAcc -= steps;
  for (let i = 0; i < steps; i++) sim.step();

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

  if (dtMs > 0 && dtMs <= 250) fps = fps * 0.9 + (1000 / Math.max(1, dtMs)) * 0.1;
  if (now - lastStatusNow > 180) {
    lastStatusNow = now;
    syncSimRateReadout();
    const lvl = activeLevel.id === LEVEL_ID.SANDBOX ? "" : ` • ${activeLevel.name}`;
    const budget = remainingBudget === null ? "" : ` • stone ${remainingBudget}`;
    const done = levelComplete ? " • complete" : "";
    const statusText = `${sim.width}×${sim.height}${lvl}${budget}${done} • tick ${sim.tick} • ${fps.toFixed(0)} fps`;
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
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
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

  const radius = Number(brushSize.value) | 0;
  if (radius <= 0) return;

  const rx = (radius + 0.5) * sx;
  const ry = (radius + 0.5) * sy;

  const color = brush.down && brush.mode === "erase" ? "rgba(255, 96, 96, 0.45)" : "rgba(124, 196, 255, 0.4)";

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
