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
    goal: { x: 226, y: 83, wantId: Particle.WATER, stableChecks: 4 },
    hints: ["Goal: get water into the cup.", "Stone only (erase allowed).", "Tip: erase the intake plug; seal the leak vent."],
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
      // Reservoir.
      fill(stone, 8, 1, 80, 38);
      fill(air, 9, 2, 79, 38); // open top

      // Riser (elevator shaft).
      fill(stone, 150, 1, 156, 112);
      fill(air, 151, 2, 155, 111);

      // Heater pocket (lava behind a thin stone wall).
      fill(stone, 130, 12, 149, 34);
      fill(air, 131, 13, 149, 33);

      // Intake pipe from reservoir -> riser (starts blocked by a plug).
      fill(stone, 80, 6, 150, 10);
      fill(air, 80, 7, 150, 9);
      fill(stone, 115, 7, 117, 9); // plug: erase to open

      // Leak vent (must be sealed to reach the outlet).
      fill(air, 156, 96, 156, 98);

      // Outlet pipe to the goal cup.
      fill(stone, 156, 99, 210, 103);
      fill(air, 156, 100, 210, 102);

      // Goal cup.
      fill(stone, 210, 82, 242, 104);
      fill(air, 211, 83, 241, 104); // open top

      // --- Fluids ---
      // Reservoir water supply.
      fill(water, 9, 2, 79, 22);

      // Prime the riser with a little water.
      fill(water, 151, 2, 155, 8);

      // Lava heat source.
      fill(lava, 131, 13, 149, 24);

      return { source: canvas, width: w, height: h, originX: 0, originY: 0 };
    },
  };
}
