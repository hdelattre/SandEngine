// @ts-check

import { GpuSim } from "./gpu-sim.js";
import { buildPaletteTexels, buildPropTexels, createParticleDefs, defaultCellForParticle, Particle } from "./particles.js";

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

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));
const hintStatusEl = /** @type {HTMLElement} */ (document.getElementById("hintStatus"));
const playPauseBtn = /** @type {HTMLButtonElement} */ (document.getElementById("playPauseBtn"));
const stepBtn = /** @type {HTMLButtonElement} */ (document.getElementById("stepBtn"));
const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById("clearBtn"));
const particleSelect = /** @type {HTMLSelectElement} */ (document.getElementById("particleSelect"));
const brushSize = /** @type {HTMLInputElement} */ (document.getElementById("brushSize"));
const stepsPerFrame = /** @type {HTMLInputElement} */ (document.getElementById("stepsPerFrame"));
const viewSelect = /** @type {HTMLSelectElement} */ (document.getElementById("viewSelect"));
const resSelect = /** @type {HTMLSelectElement} */ (document.getElementById("resSelect"));

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

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

/** @type {GpuSim | null} */
let sim = null;

try {
  const { width, height } = parseRes(resSelect.value);
  sim = new GpuSim(canvas, particleDefs, paletteTexels, propTexels, { width, height, seed: (Math.random() * 2 ** 32) >>> 0 });
  setText(hintStatusEl, "WebGL2 ✓");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  setText(statusEl, `Error: ${msg}`);
  setText(hintStatusEl, "WebGL2 required");
}

if (!sim) throw new Error("WebGL2 required");

/** @type {{down: boolean, x: number, y: number, lastX: number, lastY: number, mode: 'paint'|'erase'}} */
const brush = { down: false, x: 0, y: 0, lastX: 0, lastY: 0, mode: "paint" };
/** @type {{x: number, y: number, has: boolean}} */
const cursor = { x: Math.floor(sim.width / 2), y: Math.floor(sim.height / 2), has: false };

/**
 * @param {PointerEvent} e
 * @returns {{x: number, y: number}}
 */
function eventToGrid(e) {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  const x = Math.floor(nx * sim.width);
  const yTop = Math.floor(ny * sim.height);
  const y = sim.height - 1 - yTop;
  return { x, y };
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
  const id = mode === "erase" ? Particle.EMPTY : Number(particleSelect.value) | 0;
  const base = defaultCellForParticle(/** @type {any} */ (id));
  sim.paintCircle(x, y, { id, temp: base.temp, data: base.data, flags: base.flags }, radius);
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const { x, y } = eventToGrid(e);

  const wantsPick = e.button === 1 || e.altKey;
  if (wantsPick) {
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
});

let running = true;
let stepOnce = false;

playPauseBtn.addEventListener("click", () => {
  running = !running;
  playPauseBtn.textContent = running ? "Pause" : "Play";
});

stepBtn.addEventListener("click", () => {
  stepOnce = true;
});

clearBtn.addEventListener("click", () => {
  sim.clear();
});

viewSelect.addEventListener("change", () => {
  sim.setViewMode(/** @type {ViewMode} */ (viewSelect.value));
});

resSelect.addEventListener("change", () => {
  const { width, height } = parseRes(resSelect.value);
  sim.setWorldSize(width, height);
});

let lastNow = performance.now();
let fps = 60;
let lastStatusNow = 0;
let toastMsg = "";
let toastUntil = 0;

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * @param {string} msg
 * @param {number} ms
 */
function toast(msg, ms = 2200) {
  toastMsg = msg;
  toastUntil = performance.now() + ms;
}

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

window.addEventListener("paste", async (e) => {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;

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
  toast("pasting image…", 1200);

  try {
    const { source, width: srcW, height: srcH, cleanup } = await decodeImageBlob(file);
    const maxW = Math.max(1, sim.width - 2);
    const maxH = Math.max(1, sim.height - 1);
    const scale = e.shiftKey ? 1 : Math.min(1, maxW / Math.max(1, srcW), maxH / Math.max(1, srcH));
    const w = clamp(Math.max(1, Math.round(srcW * scale)), 1, maxW);
    const h = clamp(Math.max(1, Math.round(srcH * scale)), 1, maxH);

    const offscreen = makeOffscreenCanvas(w, h);
    // @ts-ignore - OffscreenCanvas/HTMLCanvasElement share getContext at runtime.
    const ctx = offscreen.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.imageSmoothingEnabled = true;
    // @ts-ignore - imageSmoothingQuality isn't in all TS libs.
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, w, h);
    // @ts-ignore - CanvasImageSource is valid for drawImage.
    ctx.drawImage(source, 0, 0, w, h);

    if (cleanup) cleanup();

    const cx = cursor.has ? cursor.x : Math.floor(sim.width / 2);
    const cy = cursor.has ? cursor.y : Math.floor(sim.height / 2);
    let ox = Math.round(cx - w / 2);
    let oy = Math.round(cy - h / 2);
    ox = clamp(ox, 1, sim.width - 1 - w);
    oy = clamp(oy, 1, sim.height - h);

    // @ts-ignore - OffscreenCanvas is a valid CanvasImageSource at runtime.
    sim.stampImage(offscreen, w, h, ox, oy);
    toast(`pasted ${srcW}×${srcH} → ${w}×${h}`, 2600);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast(`paste failed: ${msg}`, 3000);
  }
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

  if (e.code === "Space") {
    e.preventDefault();
    running = !running;
    playPauseBtn.textContent = running ? "Pause" : "Play";
    return;
  }

  if (e.key === "c" || e.key === "C") {
    sim.clear();
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
  };
  if (e.key in hotkeys) {
    particleSelect.value = String(hotkeys[e.key]);
  }
});

function loop(now) {
  sim.resizeCanvasToDisplaySize();

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

  const spf = Number(stepsPerFrame.value) | 0;
  if (running) {
    for (let i = 0; i < spf; i++) sim.step();
  } else if (stepOnce) {
    sim.step();
    stepOnce = false;
  }

  sim.render();

  const dt = now - lastNow;
  lastNow = now;
  fps = fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;
  if (now - lastStatusNow > 180) {
    lastStatusNow = now;
    const msg = now < toastUntil && toastMsg ? ` • ${toastMsg}` : "";
    setText(statusEl, `${sim.width}×${sim.height} • tick ${sim.tick} • ${fps.toFixed(0)} fps${msg}`);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
