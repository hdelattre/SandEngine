// @ts-check

import { Particle } from "./particles.js";

/** @typedef {import('./types.js').ParticleDef} ParticleDef */
/** @typedef {import('./types.js').SimSize} SimSize */

export const LEVEL_ID = /** @type {const} */ ({
  SANDBOX: "sandbox",
  STEAM_ELEVATOR: "steam-elevator",
  CIRCUIT_LAB: "circuit-lab",
  CIRCUIT_COUNTER: "circuit-counter",
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
    createCircuitCounterLevel(particleDefs),
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
  const notE = rgbCss(particleDefs[Particle.CIRCUIT_NOT_E].color);
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
      Particle.CIRCUIT_NOT_E,
      Particle.STONE,
    ],
    budget: null,
    paintCost: () => 0,
    goal: null,
    hints: [
      "Circuit parts: R wire, P power, L lamp, N inverter (E).",
      "Toggle inputs by erasing/painting Power Sources in the sockets.",
      "Note: circuit power attenuates by 1 per wire cell (range ~15).",
      "Top row (L→R): Wire, NOT, OR, NOR.",
      "Bottom row (L→R): Range, Split, NAND, AND.",
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
      // 2x4 grid (8 small demo stations).
      const colX0 = [8, 70, 132, 194];
      const colX1 = [65, 127, 189, 251];
      const rowY0 = [72, 8]; // [top, bottom]
      const rowY1 = [129, 65];

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
          box(colX0[col], rowY0[row], colX1[col], rowY1[row]);
        }
      }

      /**
       * Draw a 1-cell input socket marker (stone bracket + empty socket).
       * The caller must draw wire starting at xSocket+1.
       * @param {number} xSocket
       * @param {number} ySocket
       */
      function socket(xSocket, ySocket) {
        vline(stone, xSocket - 1, ySocket - 1, ySocket + 1);
      }

      // --- Top row (L→R): Wire, NOT, OR, NOR ---
      // Wire: socket -> short wire -> lamp.
      {
        const x0 = colX0[0];
        const y0 = rowY0[0];
        const xSocket = x0 + 4;
        const y = y0 + 28;
        socket(xSocket, y);
        dot(power, xSocket, y);
        hline(wire, xSocket + 1, xSocket + 12, y);
        dot(lamp, xSocket + 13, y);
      }

      // NOT: socket -> wire -> inverter -> lamp (lamp reads inverter output directly).
      {
        const x0 = colX0[1];
        const y0 = rowY0[0];
        const xSocket = x0 + 4;
        const y = y0 + 28;
        socket(xSocket, y);
        dot(power, xSocket, y);
        hline(wire, xSocket + 1, xSocket + 7, y);
        dot(notE, xSocket + 8, y);
        dot(lamp, xSocket + 9, y);
      }

      // OR: two sockets -> wired junction -> lamp.
      {
        const x0 = colX0[2];
        const y0 = rowY0[0];
        const xSocket = x0 + 4;
        const yMid = y0 + 28;
        const yA = yMid + 6;
        const yB = yMid - 6;
        const xJoin = x0 + 12;
        socket(xSocket, yA);
        socket(xSocket, yB);
        dot(power, xSocket, yA);
        hline(wire, xSocket + 1, xJoin, yA);
        hline(wire, xSocket + 1, xJoin, yB);
        vline(wire, xJoin, yB, yA);
        dot(lamp, xJoin + 1, yMid);
      }

      // NOR: OR into inverter -> lamp.
      {
        const x0 = colX0[3];
        const y0 = rowY0[0];
        const xSocket = x0 + 4;
        const yMid = y0 + 28;
        const yA = yMid + 6;
        const yB = yMid - 6;
        const xIn = x0 + 12;
        socket(xSocket, yA);
        socket(xSocket, yB);
        hline(wire, xSocket + 1, xIn, yA);
        hline(wire, xSocket + 1, xIn, yB);
        vline(wire, xIn, yB, yA);
        dot(notE, xIn + 1, yMid);
        dot(lamp, xIn + 2, yMid);
      }

      // --- Bottom row (L→R): Range, Split, NAND, AND ---
      // Range: long wire shows cutoff (lamp near edge on, lamp past edge off).
      {
        const x0 = colX0[0];
        const y0 = rowY0[1];
        const xSocket = x0 + 4;
        const y = y0 + 28;
        const xWire0 = xSocket + 1;
        const xWire1 = x0 + 32;
        socket(xSocket, y);
        dot(power, xSocket, y);
        hline(wire, xWire0, xWire1, y);
        dot(lamp, xWire0 + 11, y + 1); // on
        dot(lamp, xWire0 + 14, y + 1); // on (edge)
        dot(lamp, xWire0 + 15, y + 1); // off (past range)
        dot(lamp, xWire1, y + 1); // off
      }

      // Split: one input powers multiple lamps (fan-out).
      {
        const x0 = colX0[1];
        const y0 = rowY0[1];
        const xSocket = x0 + 4;
        const y = y0 + 28;
        const xJ = xSocket + 8;
        socket(xSocket, y);
        dot(power, xSocket, y);
        hline(wire, xSocket + 1, xJ, y);
        dot(lamp, xJ + 1, y);
        dot(lamp, xJ, y + 1);
        dot(lamp, xJ, y - 1);
      }

      // NAND: invert inputs then OR them (NAND = !A || !B).
      {
        const x0 = colX0[2];
        const y0 = rowY0[1];
        const xSocket = x0 + 4;
        const yMid = y0 + 28;
        const yA = yMid + 10;
        const yB = yMid - 10;
        const xInv = x0 + 10;
        const xJoin = xInv + 1;
        socket(xSocket, yA);
        socket(xSocket, yB);
        dot(power, xSocket, yA);
        hline(wire, xSocket + 1, xInv - 1, yA);
        hline(wire, xSocket + 1, xInv - 1, yB);
        dot(notE, xInv, yA);
        dot(notE, xInv, yB);
        vline(wire, xJoin, yB, yA);
        dot(wire, xJoin + 1, yMid);
        dot(lamp, xJoin + 2, yMid);
      }

      // AND: NAND into inverter (AND = !( !A || !B )).
      {
        const x0 = colX0[3];
        const y0 = rowY0[1];
        const xSocket = x0 + 4;
        const yMid = y0 + 28;
        const yA = yMid + 10;
        const yB = yMid - 10;
        const xInv = x0 + 10;
        const xJoin = xInv + 1;
        const xFinal = x0 + 14;
        socket(xSocket, yA);
        socket(xSocket, yB);
        dot(power, xSocket, yA);
        dot(power, xSocket, yB);
        hline(wire, xSocket + 1, xInv - 1, yA);
        hline(wire, xSocket + 1, xInv - 1, yB);
        dot(notE, xInv, yA);
        dot(notE, xInv, yB);
        vline(wire, xJoin, yB, yA);
        hline(wire, xJoin, xFinal - 1, yMid);
        dot(notE, xFinal, yMid);
        dot(lamp, xFinal + 1, yMid);
      }

      return { source: canvas, width: w, height: h, originX: 0, originY: 0 };
    },
  };
}

/**
 * @param {ParticleDef[]} particleDefs
 * @returns {LevelDef}
 */
function createCircuitCounterLevel(particleDefs) {
  const stone = rgbCss(particleDefs[Particle.STONE].color);
  const wire = rgbCss(particleDefs[Particle.CIRCUIT_WIRE].color);
  const lamp = rgbCss(particleDefs[Particle.CIRCUIT_LAMP].color);
  const clock = rgbCss(particleDefs[Particle.CIRCUIT_CLOCK_E].color);
  const toggle = rgbCss(particleDefs[Particle.CIRCUIT_TOGGLE_E].color);
  const air = "rgb(255, 255, 255)";

  /** @type {SimSize} */
  const size = { width: 256, height: 144 };

  return {
    id: LEVEL_ID.CIRCUIT_COUNTER,
    name: "Circuit Counter",
    size,
    seed: 12345,
    allowedPaintIds: [
      Particle.CIRCUIT_WIRE,
      Particle.CIRCUIT_POWER,
      Particle.CIRCUIT_LAMP,
      Particle.CIRCUIT_NOT_E,
      Particle.CIRCUIT_CLOCK_E,
      Particle.CIRCUIT_TOGGLE_E,
      Particle.STONE,
    ],
    budget: null,
    paintCost: () => 0,
    goal: null,
    hints: [
      "An 8-bit ripple counter driven by a free-running clock.",
      "Watch the bits (lamps) toggle; use Play/Pause to inspect propagation.",
      "Tip: bump sim speed for faster high bits.",
      "Hotkeys: R wire, L lamp, K clock, Y toggle.",
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

      // Main panel.
      box(10, 12, 245, 120);

      // Counter chain: clock -> (wire,toggle)*8
      const y = 52;
      const x0 = 22;
      const bits = 8;

      // Clock drives the first wire cell.
      dot(clock, x0, y);
      dot(wire, x0 + 1, y);

      for (let i = 0; i < bits; i++) {
        const xt = x0 + 2 + i * 2;
        dot(toggle, xt, y);
        dot(wire, xt + 1, y);
        // Bit indicator lamp above the wire (so it doesn't break the chain).
        dot(lamp, xt + 1, y + 1);
        // Small tick mark for readability.
        dot(stone, xt + 1, y - 1);
      }

      // Clock indicator lamp.
      dot(lamp, x0 + 1, y + 1);

      // Visual separator between low/high nibble (placed off the chain).
      dot(stone, x0 + 10, y + 1);
      dot(stone, x0 + 10, y - 1);

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
