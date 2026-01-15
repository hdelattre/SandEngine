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
  if (!brush.down) return;
  const { x, y } = eventToGrid(e);
  brush.x = x;
  brush.y = y;
});

function endBrush() {
  brush.down = false;
}

canvas.addEventListener("pointerup", endBrush);
canvas.addEventListener("pointercancel", endBrush);

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

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

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
    setText(statusEl, `${sim.width}×${sim.height} • tick ${sim.tick} • ${fps.toFixed(0)} fps`);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
