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

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
const cursorCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("cursorCanvas"));
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));
const hintStatusEl = /** @type {HTMLElement} */ (document.getElementById("hintStatus"));
const playPauseBtn = /** @type {HTMLButtonElement} */ (document.getElementById("playPauseBtn"));
const stepBtn = /** @type {HTMLButtonElement} */ (document.getElementById("stepBtn"));
const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById("clearBtn"));
const levelSelect = /** @type {HTMLSelectElement} */ (document.getElementById("levelSelect"));
const particleSelect = /** @type {HTMLSelectElement} */ (document.getElementById("particleSelect"));
const brushSize = /** @type {HTMLInputElement} */ (document.getElementById("brushSize"));
const stepsPerFrame = /** @type {HTMLInputElement} */ (document.getElementById("stepsPerFrame"));
const viewSelect = /** @type {HTMLSelectElement} */ (document.getElementById("viewSelect"));
const resSelect = /** @type {HTMLSelectElement} */ (document.getElementById("resSelect"));
const pasteEdgeStone = /** @type {HTMLInputElement} */ (document.getElementById("pasteEdgeStone"));
const pasteBtn = /** @type {HTMLButtonElement} */ (document.getElementById("pasteBtn"));
const addMode = /** @type {HTMLInputElement} */ (document.getElementById("addMode"));
const levelHintEl = /** @type {HTMLElement} */ (document.getElementById("levelHint"));
const settingsBtn = /** @type {HTMLButtonElement} */ (document.getElementById("settingsBtn"));
const settingsPanel = /** @type {HTMLDivElement} */ (document.getElementById("settingsPanel"));
const brushSizeValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("brushSizeValue"));
const stepsPerFrameValue = /** @type {HTMLOutputElement | null} */ (document.getElementById("stepsPerFrameValue"));
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

try {
  const { width, height } = parseRes(resSelect.value);
  sim = new GpuSim(canvas, particleDefs, paletteTexels, propTexels, thermal0Texels, thermal1Texels, latentTexels, {
    width,
    height,
    seed: (Math.random() * 2 ** 32) >>> 0,
  });
  setText(hintStatusEl, "WebGL2 ✓");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  setText(statusEl, `Error: ${msg}`);
  setText(hintStatusEl, "WebGL2 required");
}

if (!sim) throw new Error("WebGL2 required");

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

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const { x, y } = eventToGrid(e);

  const wantsPick = e.button === 1 || e.altKey;
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

function syncRangeReadouts() {
  if (brushSizeValue) brushSizeValue.textContent = brushSize.value;
  if (stepsPerFrameValue) stepsPerFrameValue.textContent = stepsPerFrame.value;
}

brushSize.addEventListener("input", syncRangeReadouts);
stepsPerFrame.addEventListener("input", syncRangeReadouts);
syncRangeReadouts();

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
  clearBtn.textContent = isSandbox ? "Clear" : "Restart";
  levelHintEl.textContent = isSandbox ? "" : next.hints.join(" ");

  if (isSandbox) {
    particleSelect.value = String(Particle.SAND);
    const { width, height } = parseRes(resSelect.value);
    if (sim.width !== width || sim.height !== height) sim.setWorldSize(width, height);
    else sim.clear();
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

/**
 * @param {Blob} blob
 * @param {{noScale?: boolean} | undefined} [opts]
 */
async function pasteImageBlob(blob, opts) {
  if (!sim) return;
  if (activeLevel.id !== LEVEL_ID.SANDBOX) {
    notify("paste disabled in levels");
    return;
  }

  const noScale = opts?.noScale ?? false;

  try {
    const { source, width: srcW, height: srcH, cleanup } = await decodeImageBlob(blob);
    const maxW = Math.max(1, sim.width - 2);
    const maxH = Math.max(1, sim.height - 1);
    const scale = noScale ? 1 : Math.min(1, maxW / Math.max(1, srcW), maxH / Math.max(1, srcH));
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
    sim.stampImage(offscreen, w, h, ox, oy, { edgeStone: pasteEdgeStone.checked, addMode: addMode.checked });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notify(`paste failed: ${msg}`);
  }
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
  await pasteImageBlob(file);
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
      await pasteImageBlob(blob, { noScale: e.shiftKey });
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
  await pasteImageBlob(file, { noScale: e.shiftKey });
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

  // Don't treat OS/browser shortcuts as simulation hotkeys (e.g. Cmd+V would
  // otherwise trigger the "v" particle hotkey).
  if (e.metaKey || e.ctrlKey) return;

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

function loop(now) {
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

  const spf = Number(stepsPerFrame.value) | 0;
  if (running) {
    for (let i = 0; i < spf; i++) sim.step();
  } else if (stepOnce) {
    sim.step();
    stepOnce = false;
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

  const dt = now - lastNow;
  lastNow = now;
  fps = fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;
  if (now - lastStatusNow > 180) {
    lastStatusNow = now;
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

  const radius = Number(brushSize.value) | 0;
  if (radius <= 0) return;

  const x = clamp(cursor.x, 0, sim.width - 1);
  const y = clamp(cursor.y, 0, sim.height - 1);

  const sx = w / sim.width;
  const sy = h / sim.height;
  const cx = (x + 0.5) * sx;
  const cy = h - (y + 0.5) * sy;

  const rx = (radius + 0.5) * sx;
  const ry = (radius + 0.5) * sy;

  const cellPx = Math.max(1, Math.min(3, Math.round(Math.min(sx, sy))));
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
