// @ts-check

import { Particle } from "./particles.js";

/** @typedef {import('./types.js').ParticleDef} ParticleDef */
/** @typedef {import('./types.js').SimSize} SimSize */

export const LEVEL_ID = /** @type {const} */ ({
  SANDBOX: "sandbox",
  STEAM_ELEVATOR: "steam-elevator",
  CIRCUIT_LAB: "circuit-lab",
});

/**
 * @typedef {object} LevelGoal
 * @property {number} x
 * @property {number} y
 * @property {number} wantId
 * @property {number} stableChecks
 */

/**
 * @typedef {object} LevelDef
 * @property {string} id
 * @property {string} name
 * @property {SimSize} size
 * @property {number} seed
 * @property {number[]} allowedPaintIds
 * @property {number | null} budget
 * @property {(radius: number) => number} paintCost
 * @property {LevelGoal | null} goal
 * @property {string[]} hints
 * @property {() => {source: CanvasImageSource, width: number, height: number, originX: number, originY: number}} buildStamp
 */

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
 * @param {[number, number, number]} rgb
 * @returns {string}
 */
function rgbCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * @param {ParticleDef[]} particleDefs
 * @returns {LevelDef[]}
 */
export function createLevels(particleDefs) {
  /** @type {LevelDef[]} */
  const levels = [
    {
      id: LEVEL_ID.SANDBOX,
      name: "Sandbox",
      size: { width: 256, height: 144 },
      seed: 0,
      allowedPaintIds: Object.values(Particle),
      budget: null,
      paintCost: () => 0,
      goal: null,
      hints: [],
      buildStamp: () => ({ source: makeOffscreenCanvas(1, 1), width: 1, height: 1, originX: 0, originY: 0 }),
    },
    createCircuitLabLevel(particleDefs),
    createSteamElevatorLevel(particleDefs),
  ];

  return levels;
}

/**
 * @param {ParticleDef[]} particleDefs
 * @returns {LevelDef}
 */
function createCircuitLabLevel(particleDefs) {
  const stone = rgbCss(particleDefs[Particle.STONE].color);
  const wire = rgbCss(particleDefs[Particle.CIRCUIT_WIRE].color);
  const power = rgbCss(particleDefs[Particle.CIRCUIT_POWER].color);
  const lamp = rgbCss(particleDefs[Particle.CIRCUIT_LAMP].color);
  const notN = rgbCss(particleDefs[Particle.CIRCUIT_NOT_N].color);
  const notE = rgbCss(particleDefs[Particle.CIRCUIT_NOT_E].color);
  const notS = rgbCss(particleDefs[Particle.CIRCUIT_NOT_S].color);
  const notW = rgbCss(particleDefs[Particle.CIRCUIT_NOT_W].color);
  const air = "rgb(255, 255, 255)";

  /** @type {SimSize} */
  const size = { width: 256, height: 144 };

  return {
    id: LEVEL_ID.CIRCUIT_LAB,
    name: "Circuit Lab",
    size,
    seed: 424242,
    allowedPaintIds: [
      Particle.CIRCUIT_WIRE,
      Particle.CIRCUIT_POWER,
      Particle.CIRCUIT_LAMP,
      Particle.CIRCUIT_NOT_N,
      Particle.CIRCUIT_NOT_E,
      Particle.CIRCUIT_NOT_S,
      Particle.CIRCUIT_NOT_W,
      Particle.STONE,
    ],
    budget: null,
    paintCost: () => 0,
    goal: null,
    hints: [
      "Circuit parts: R wire, P power, L lamp, N inverter (E).",
      "Place/remove Power Sources in the empty input sockets to toggle A/B.",
      "Stations: top-left OR, top-right NOT, bottom-right AND (DeMorgan), bottom-left range/attenuation.",
    ],
    buildStamp: () => {
      const w = size.width;
      const h = size.height;
      const canvas = makeOffscreenCanvas(w, h);
      // @ts-ignore - OffscreenCanvas/HTMLCanvasElement share getContext at runtime.
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas unavailable");

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = air;
      ctx.fillRect(0, 0, w, h);

      /**
       * @param {string} color
       * @param {number} x0
       * @param {number} y0
       * @param {number} x1
       * @param {number} y1
       */
      function fill(color, x0, y0, x1, y1) {
        ctx.fillStyle = color;
        const rw = x1 - x0 + 1;
        const rh = y1 - y0 + 1;
        const cy = h - 1 - y1;
        ctx.fillRect(x0, cy, rw, rh);
      }

      /**
       * @param {string} color
       * @param {number} x
       * @param {number} y
       */
      function dot(color, x, y) {
        fill(color, x, y, x, y);
      }

      /**
       * @param {string} color
       * @param {number} x0
       * @param {number} x1
       * @param {number} y
       */
      function hline(color, x0, x1, y) {
        fill(color, x0, y, x1, y);
      }

      /**
       * @param {string} color
       * @param {number} x
       * @param {number} y0
       * @param {number} y1
       */
      function vline(color, x, y0, y1) {
        fill(color, x, y0, x, y1);
      }

      /**
       * @param {number} x0
       * @param {number} y0
       * @param {number} x1
       * @param {number} y1
       */
      function box(x0, y0, x1, y1) {
        hline(stone, x0, x1, y0);
        hline(stone, x0, x1, y1);
        vline(stone, x0, y0, y1);
        vline(stone, x1, y0, y1);
      }

      // --- Station boxes ---
      // Bottom-left: attenuation/range.
      box(10, 10, 120, 70);
      // Top-left: OR.
      box(10, 80, 120, 130);
      // Top-right: NOT.
      box(136, 80, 246, 130);
      // Bottom-right: AND.
      box(136, 10, 246, 70);

      // --- Bottom-left: attenuation/range demo ---
      // Socket at (20, 25) (leave empty) -> wire at (21..60,25)
      vline(stone, 19, 24, 26);
      hline(wire, 21, 60, 25);
      // Lamps show the cutoff around distance 15 (wire glow shows gradient).
      dot(lamp, 30, 26);
      dot(lamp, 35, 26);
      dot(lamp, 36, 26);
      dot(lamp, 60, 26);

      // --- Top-left: OR gate ---
      // A socket at (20,120), B socket at (20,95).
      vline(stone, 19, 119, 121);
      vline(stone, 19, 94, 96);
      // A path: (21..60,120), down to (60,108)
      hline(wire, 21, 60, 120);
      vline(wire, 60, 108, 120);
      // B path: (21..60,95), up to (60,108)
      hline(wire, 21, 60, 95);
      vline(wire, 60, 95, 108);
      // Output to lamp
      hline(wire, 61, 94, 108);
      dot(lamp, 95, 108);

      // --- Top-right: NOT gate ---
      // Socket at (146,105) -> wire to inverter -> wire -> lamp
      vline(stone, 145, 104, 106);
      hline(wire, 147, 159, 105);
      dot(notE, 160, 105);
      hline(wire, 161, 180, 105);
      dot(lamp, 181, 105);

      // --- Bottom-right: AND gate (NOT(OR(NOT A, NOT B))) ---
      // A socket at (146,60) -> wire -> NOT_E
      vline(stone, 145, 59, 61);
      hline(wire, 147, 159, 60);
      dot(notE, 160, 60);
      // B socket at (146,25) -> wire -> NOT_E
      vline(stone, 145, 24, 26);
      hline(wire, 147, 159, 25);
      dot(notE, 160, 25);

      // Route inverted outputs to OR junction at (190,42)
      hline(wire, 161, 190, 60);
      vline(wire, 190, 42, 60);
      hline(wire, 161, 190, 25);
      vline(wire, 190, 25, 42);

      // Final NOT_E takes OR output and produces AND
      hline(wire, 191, 199, 42);
      dot(notE, 200, 42);
      hline(wire, 201, 220, 42);
      dot(lamp, 221, 42);

      // --- A few "spares" for quick edits (pre-placed parts) ---
      // (One of each, tucked near bottom-left box)
      dot(power, 18, 60);
      dot(lamp, 22, 60);
      dot(notN, 26, 60);
      dot(notE, 28, 60);
      dot(notS, 30, 60);
      dot(notW, 32, 60);

      return { source: canvas, width: w, height: h, originX: 0, originY: 0 };
    },
  };
}

/**
 * @param {ParticleDef[]} particleDefs
 * @returns {LevelDef}
 */
function createSteamElevatorLevel(particleDefs) {
  const stone = rgbCss(particleDefs[Particle.STONE].color);
  const water = rgbCss(particleDefs[Particle.WATER].color);
  const lava = rgbCss(particleDefs[Particle.LAVA].color);
  const air = "rgb(255, 255, 255)";

  /** @type {SimSize} */
  const size = { width: 256, height: 144 };

  return {
    id: LEVEL_ID.STEAM_ELEVATOR,
    name: "Steam Elevator",
    size,
    seed: 1337,
    allowedPaintIds: [Particle.STONE],
    budget: 4200,
    paintCost: (radius) => Math.max(1, Math.round((radius * radius) / 8)),
    goal: { x: 228, y: 91, wantId: Particle.WATER, stableChecks: 3 },
    hints: ["Goal: condense water in the condenser.", "Stone only (erase allowed).", "Tip: patch the riser vent + pipe roof leak (T shows heat)."],
    buildStamp: () => {
      const w = size.width;
      const h = size.height;
      const canvas = makeOffscreenCanvas(w, h);
      // @ts-ignore - OffscreenCanvas/HTMLCanvasElement share getContext at runtime.
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas unavailable");

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = air;
      ctx.fillRect(0, 0, w, h);

      /**
       * @param {string} color
       * @param {number} x0
       * @param {number} y0
       * @param {number} x1
       * @param {number} y1
       */
      function fill(color, x0, y0, x1, y1) {
        ctx.fillStyle = color;
        const rw = x1 - x0 + 1;
        const rh = y1 - y0 + 1;
        const cy = h - 1 - y1;
        ctx.fillRect(x0, cy, rw, rh);
      }

      // --- Stone structure (draw solid, then carve) ---
      // Boiler (water) + heater (lava) separated by a 1-tile stone wall.
      fill(stone, 10, 1, 95, 30);
      fill(air, 11, 2, 94, 29);

      fill(stone, 95, 1, 120, 30);
      fill(air, 96, 2, 119, 29);

      // Riser (steam elevator).
      fill(stone, 40, 30, 60, 120);
      fill(air, 41, 31, 59, 119);
      fill(air, 44, 30, 56, 30); // boiler -> riser opening

      // Horizontal pipe to the condenser.
      fill(stone, 60, 115, 200, 119);
      fill(air, 61, 116, 199, 118);
      fill(air, 60, 116, 60, 118); // riser -> pipe opening

      // Condenser: connected high so condensed water can't fall back.
      fill(stone, 200, 90, 246, 119);
      fill(air, 201, 91, 245, 118);
      fill(air, 200, 116, 200, 118); // pipe -> condenser opening

      // Riser vent (seal it).
      fill(air, 40, 86, 40, 92);

      // Pipe roof leak (seal it).
      fill(air, 120, 119, 140, 119);

      // --- Fluids ---
      // Boiler water.
      fill(water, 11, 2, 94, 10);

      // Lava heat source.
      fill(lava, 96, 2, 119, 28);

      return { source: canvas, width: w, height: h, originX: 0, originY: 0 };
    },
  };
}
