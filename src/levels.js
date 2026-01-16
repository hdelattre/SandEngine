// @ts-check

import { Particle } from "./particles.js";

/** @typedef {import('./types.js').ParticleDef} ParticleDef */
/** @typedef {import('./types.js').SimSize} SimSize */

export const LEVEL_ID = /** @type {const} */ ({
  SANDBOX: "sandbox",
  STEAM_ELEVATOR: "steam-elevator",
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
    createSteamElevatorLevel(particleDefs),
  ];

  return levels;
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
