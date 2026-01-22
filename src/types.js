// @ts-check

/**
 * JSDoc-only type spec for sandengine.
 * This project is plain JS; these typedefs are for editor tooling and clarity.
 */

/**
 * @typedef {number} ParticleId
 * A byte-sized particle id in the range 0..255.
 */

/**
 * @typedef {0|1} Bit
 */

/**
 * @typedef {{x: number, y: number}} Vec2
 */

/**
 * @typedef {{x: number, y: number}} Vec2i
 * An integer grid coordinate.
 */

/**
 * @typedef {object} CellState
 * @property {ParticleId} id
 * @property {number} temp
 * @property {number} data
 * @property {number} flags
 *
 * `temp`, `data`, `flags` are bytes in the range 0..255.
 *
 * Note: `flags` here is *per-cell metadata* stored in the world texture's A channel.
 * It's distinct from `ParticleDef.flags` (per-particle physical category flags).
 * V1 uses `flags` for per-cell state like Plant growth (direction/gene/cooldown bitpacking)
 * and Wire cooldowns/charge helpers.
 */

/**
 * @typedef {object} ParticleDef
 * @property {ParticleId} id
 * @property {string} name
 * @property {[number, number, number]} color
 * @property {number} density
 * @property {number} conductivity
 * @property {number} mobility
 * @property {number} flags
 */

/**
 * @typedef {'material'|'temperature'|'wind'} ViewMode
 */

/**
 * @typedef {object} SimSize
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} Brush
 * @property {ParticleId} id
 * @property {number} radius
 * @property {number} temp
 * @property {number} strength
 */

/**
 * @typedef {object} SimStats
 * @property {number} tick
 * @property {number} fps
 * @property {number} ms
 */

/**
 * @typedef {object} GpuSimOptions
 * @property {number} width
 * @property {number} height
 * @property {number} seed
 */

/**
 * @typedef {object} StampState
 * @property {HTMLCanvasElement | OffscreenCanvas} base
 * @property {number} srcW
 * @property {number} srcH
 * @property {number} w
 * @property {number} h
 */

export {};
