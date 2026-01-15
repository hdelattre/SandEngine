// @ts-check

/** @typedef {import('./types.js').ParticleDef} ParticleDef */
/** @typedef {import('./types.js').ParticleId} ParticleId */

export const Particle = /** @type {const} */ ({
  EMPTY: 0,
  SAND: 1,
  WATER: 2,
  STONE: 3,
  DIRT: 4,
  MUD: 5,
  OIL: 6,
  PLANT: 7,
  FIRE: 8,
  SMOKE: 9,
  STEAM: 10,
  LAVA: 11,
  ACID: 12,
});

export const ParticleFlag = /** @type {const} */ ({
  IMMOVABLE: 1 << 0,
  POWDER: 1 << 1,
  LIQUID: 1 << 2,
  GAS: 1 << 3,
  ENERGY: 1 << 4,
  FLAMMABLE: 1 << 5,
  DISSOLVABLE: 1 << 6,
});

/**
 * @param {number} n
 * @returns {number}
 */
function clampByte(n) {
  return n < 0 ? 0 : n > 255 ? 255 : n | 0;
}

/**
 * @param {ParticleId} id
 * @param {Partial<ParticleDef>} def
 * @returns {ParticleDef}
 */
function makeDef(id, def) {
  const name = def.name ?? `Particle ${id}`;
  const color = def.color ?? /** @type {[number, number, number]} */ ([255, 0, 255]);
  const density = clampByte(def.density ?? 0);
  const conductivity = clampByte(def.conductivity ?? 0);
  const mobility = clampByte(def.mobility ?? 0);
  const flags = clampByte(def.flags ?? 0);
  return { id, name, color, density, conductivity, mobility, flags };
}

/**
 * Particle defs are the single source of truth for user-visible names/colors and
 * shader-consumed physical parameters (density/conductivity/mobility/flags).
 *
 * @returns {ParticleDef[]}
 */
export function createParticleDefs() {
  /** @type {ParticleDef[]} */
  const defs = Array.from({ length: 256 }, (_, i) => makeDef(/** @type {ParticleId} */ (i), {}));

  defs[Particle.EMPTY] = makeDef(Particle.EMPTY, {
    name: "Air",
    color: [18, 24, 34],
    density: 128,
    conductivity: 170,
    mobility: 255,
    flags: ParticleFlag.GAS,
  });
  defs[Particle.SAND] = makeDef(Particle.SAND, {
    name: "Sand",
    color: [194, 168, 104],
    density: 225,
    conductivity: 35,
    mobility: 255,
    flags: ParticleFlag.POWDER,
  });
  defs[Particle.WATER] = makeDef(Particle.WATER, {
    name: "Water",
    color: [76, 121, 217],
    density: 180,
    conductivity: 140,
    mobility: 255,
    flags: ParticleFlag.LIQUID,
  });
  defs[Particle.STONE] = makeDef(Particle.STONE, {
    name: "Stone",
    color: [92, 97, 107],
    density: 255,
    conductivity: 230,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.DIRT] = makeDef(Particle.DIRT, {
    name: "Dirt",
    color: [122, 87, 56],
    density: 215,
    conductivity: 55,
    mobility: 245,
    flags: ParticleFlag.POWDER | ParticleFlag.DISSOLVABLE,
  });
  defs[Particle.MUD] = makeDef(Particle.MUD, {
    name: "Mud",
    color: [93, 68, 48],
    density: 205,
    conductivity: 95,
    mobility: 120,
    flags: ParticleFlag.LIQUID | ParticleFlag.DISSOLVABLE,
  });
  defs[Particle.OIL] = makeDef(Particle.OIL, {
    name: "Oil",
    color: [77, 66, 44],
    density: 160,
    conductivity: 80,
    mobility: 220,
    flags: ParticleFlag.LIQUID | ParticleFlag.FLAMMABLE,
  });
  defs[Particle.PLANT] = makeDef(Particle.PLANT, {
    name: "Plant",
    color: [77, 160, 76],
    density: 230,
    conductivity: 60,
    mobility: 0,
    flags: ParticleFlag.FLAMMABLE | ParticleFlag.DISSOLVABLE,
  });
  defs[Particle.FIRE] = makeDef(Particle.FIRE, {
    name: "Fire",
    color: [255, 144, 64],
    density: 55,
    conductivity: 10,
    mobility: 255,
    flags: ParticleFlag.GAS | ParticleFlag.ENERGY,
  });
  defs[Particle.SMOKE] = makeDef(Particle.SMOKE, {
    name: "Smoke",
    color: [87, 93, 104],
    density: 78,
    conductivity: 70,
    mobility: 220,
    flags: ParticleFlag.GAS,
  });
  defs[Particle.STEAM] = makeDef(Particle.STEAM, {
    name: "Steam",
    color: [182, 200, 214],
    density: 92,
    conductivity: 160,
    mobility: 235,
    flags: ParticleFlag.GAS,
  });
  defs[Particle.LAVA] = makeDef(Particle.LAVA, {
    name: "Lava",
    color: [255, 92, 22],
    density: 245,
    conductivity: 240,
    mobility: 90,
    flags: ParticleFlag.LIQUID,
  });
  defs[Particle.ACID] = makeDef(Particle.ACID, {
    name: "Acid",
    color: [124, 255, 70],
    density: 170,
    conductivity: 150,
    mobility: 210,
    flags: ParticleFlag.LIQUID,
  });

  return defs;
}

/**
 * @param {ParticleDef[]} defs
 * @returns {Uint8Array}
 */
export function buildPaletteTexels(defs) {
  const texels = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const def = defs[i];
    const idx = i * 4;
    texels[idx + 0] = clampByte(def.color[0]);
    texels[idx + 1] = clampByte(def.color[1]);
    texels[idx + 2] = clampByte(def.color[2]);
    texels[idx + 3] = 255;
  }
  return texels;
}

/**
 * Property texture packs the GPU-consumed particle properties into RGBA8UI:
 * - R: density (0..255) (Air=128 baseline)
 * - G: conductivity (0..255)
 * - B: flags (bitfield)
 * - A: mobility (0..255) (per-pass swap probability)
 *
 * @param {ParticleDef[]} defs
 * @returns {Uint8Array}
 */
export function buildPropTexels(defs) {
  const texels = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const def = defs[i];
    const idx = i * 4;
    texels[idx + 0] = clampByte(def.density);
    texels[idx + 1] = clampByte(def.conductivity);
    texels[idx + 2] = clampByte(def.flags);
    texels[idx + 3] = clampByte(def.mobility);
  }
  return texels;
}

export const DEFAULT_AMBIENT_TEMP = 128;

/**
 * Defaults when painting/creating particles.
 * @param {ParticleId} id
 * @returns {{temp: number, data: number, flags: number}}
 */
export function defaultCellForParticle(id) {
  switch (id) {
    case Particle.FIRE:
      return { temp: 245, data: 50, flags: 0 };
    case Particle.SMOKE:
      return { temp: 170, data: 140, flags: 0 };
    case Particle.STEAM:
      return { temp: 205, data: 170, flags: 0 };
    case Particle.LAVA:
      return { temp: 250, data: 0, flags: 0 };
    case Particle.ACID:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 180, flags: 0 };
    case Particle.MUD:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 200, flags: 0 };
    case Particle.WATER:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
    case Particle.OIL:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
    case Particle.PLANT:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
    default:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
  }
}
