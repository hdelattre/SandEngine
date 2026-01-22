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
  ICE: 13,
  SALT: 14,
  BRINE: 15,
  WIRE: 16,
  SPARK: 17,
  BATTERY: 18,
  BOT: 19,
  GLIDER: 20,
  CIRCUIT_WIRE: 21,
  CIRCUIT_POWER: 22,
  CIRCUIT_LAMP: 23,
  CIRCUIT_NOT_N: 24,
  CIRCUIT_NOT_E: 25,
  CIRCUIT_NOT_S: 26,
  CIRCUIT_NOT_W: 27,
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
  defs[Particle.ICE] = makeDef(Particle.ICE, {
    name: "Ice",
    color: [180, 230, 255],
    density: 170,
    conductivity: 200,
    mobility: 120,
    flags: 0,
  });
  defs[Particle.SALT] = makeDef(Particle.SALT, {
    name: "Salt",
    color: [242, 242, 242],
    density: 235,
    conductivity: 70,
    mobility: 255,
    flags: ParticleFlag.POWDER | ParticleFlag.DISSOLVABLE,
  });
  defs[Particle.BRINE] = makeDef(Particle.BRINE, {
    name: "Brine",
    color: [62, 134, 206],
    density: 205,
    conductivity: 165,
    mobility: 250,
    flags: ParticleFlag.LIQUID,
  });
  defs[Particle.WIRE] = makeDef(Particle.WIRE, {
    name: "Wire",
    color: [186, 156, 116],
    density: 255,
    conductivity: 255,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.SPARK] = makeDef(Particle.SPARK, {
    name: "Spark",
    color: [255, 245, 168],
    density: 40,
    conductivity: 20,
    mobility: 255,
    flags: ParticleFlag.GAS | ParticleFlag.ENERGY,
  });
  defs[Particle.BATTERY] = makeDef(Particle.BATTERY, {
    name: "Battery",
    color: [255, 96, 56],
    density: 255,
    conductivity: 220,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.BOT] = makeDef(Particle.BOT, {
    name: "Bot",
    color: [214, 214, 224],
    density: 250,
    conductivity: 200,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.GLIDER] = makeDef(Particle.GLIDER, {
    name: "Glider",
    color: [232, 226, 128],
    density: 250,
    conductivity: 200,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.CIRCUIT_WIRE] = makeDef(Particle.CIRCUIT_WIRE, {
    name: "Circuit Wire",
    color: [146, 62, 54],
    density: 255,
    conductivity: 255,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.CIRCUIT_POWER] = makeDef(Particle.CIRCUIT_POWER, {
    name: "Power Source",
    color: [220, 56, 48],
    density: 255,
    conductivity: 230,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.CIRCUIT_LAMP] = makeDef(Particle.CIRCUIT_LAMP, {
    name: "Lamp",
    color: [120, 110, 92],
    density: 255,
    conductivity: 200,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.CIRCUIT_NOT_N] = makeDef(Particle.CIRCUIT_NOT_N, {
    name: "Inverter (N)",
    color: [210, 176, 64],
    density: 255,
    conductivity: 220,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.CIRCUIT_NOT_E] = makeDef(Particle.CIRCUIT_NOT_E, {
    name: "Inverter (E)",
    color: [210, 156, 64],
    density: 255,
    conductivity: 220,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.CIRCUIT_NOT_S] = makeDef(Particle.CIRCUIT_NOT_S, {
    name: "Inverter (S)",
    color: [210, 136, 64],
    density: 255,
    conductivity: 220,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
  });
  defs[Particle.CIRCUIT_NOT_W] = makeDef(Particle.CIRCUIT_NOT_W, {
    name: "Inverter (W)",
    color: [210, 116, 64],
    density: 255,
    conductivity: 220,
    mobility: 0,
    flags: ParticleFlag.IMMOVABLE,
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
      return { temp: 245, data: 80, flags: 0 };
    case Particle.SMOKE:
      return { temp: 170, data: 140, flags: 0 };
    case Particle.STEAM:
      return { temp: 205, data: 170, flags: 0 };
    case Particle.LAVA:
      return { temp: 250, data: 0, flags: 0 };
    case Particle.ACID:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 180, flags: 0 };
    case Particle.ICE:
      return { temp: 90, data: 0, flags: 0 };
    case Particle.BRINE:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 120, flags: 0 };
    case Particle.SPARK:
      return { temp: 245, data: 18, flags: 0 };
    case Particle.BATTERY:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 255, flags: 0 };
    case Particle.BOT:
      // `flags` is per-cell metadata in state.a; for Bot it encodes:
      // bits 0..3 dir (0=up,2=up-right,4=right,6=down-right,8=down,10=down-left,12=left,14=up-left; odd values are in-between angles),
      // bit4 lastMoveTickParity, bit5 drill mode, bit6 cooldown, bit7 version marker.
      // bit7 is a version marker and should be 1.
      // `data` (state.b) is the agent's paint target particle id (0 means paint Air/Empty).
      // Default movedParity=1 so freshly-painted bots can move on tick 0.
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 148 };
    case Particle.GLIDER:
      // Shares the Bot meta layout (dir/movedParity/etc), but never turns.
      // `data` (state.b) is the agent's paint target particle id (0 means paint Air/Empty).
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 148 };
    case Particle.WIRE:
      // `flags` is per-cell metadata in state.a; for Wire it encodes an arc cooldown.
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
    case Particle.CIRCUIT_WIRE:
      // `data` stores circuit power (0..15).
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
    case Particle.CIRCUIT_POWER:
      // Constant power source (15).
      return { temp: DEFAULT_AMBIENT_TEMP, data: 15, flags: 0 };
    case Particle.CIRCUIT_LAMP:
      // `data` is driven by the circuit system (0 or 15 for now).
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
    case Particle.CIRCUIT_NOT_N:
    case Particle.CIRCUIT_NOT_E:
    case Particle.CIRCUIT_NOT_S:
    case Particle.CIRCUIT_NOT_W:
      // Defaults "on" (unpowered input).
      return { temp: DEFAULT_AMBIENT_TEMP, data: 15, flags: 0 };
    case Particle.MUD:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 200, flags: 0 };
    case Particle.WATER:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
    case Particle.OIL:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
    case Particle.PLANT:
      // `flags` is per-cell metadata in state.a; for Plant it encodes growth params:
      // bits 0..2 dir, 3..5 gene, 6..7 cooldown. Default gene=4, dir=up.
      return { temp: DEFAULT_AMBIENT_TEMP, data: 120, flags: 32 };
    default:
      return { temp: DEFAULT_AMBIENT_TEMP, data: 0, flags: 0 };
  }
}

/**
 * Thermal defs drive energy-based temperature + phase changes. The shader treats each
 * particle id as part of a (solid, liquid, gas) phase group with shared thresholds.
 *
 * Energy units are arbitrary but consistent:
 * - sensible heat: `E += heatCapacity * dTemp`
 * - latent heat: `E += latentFusion` / `latentVaporization`
 *
 * @typedef {object} ThermalDef
 * @property {number} heatCapacity 1..255
 * @property {number} meltTemp 0..255
 * @property {number} boilTemp 0..255
 * @property {ParticleId} solidId
 * @property {ParticleId} liquidId
 * @property {ParticleId} gasId
 * @property {number} latentFusion 0..65535
 * @property {number} latentVaporization 0..65535
 */

/**
 * @returns {ThermalDef[]}
 */
export function createThermalDefs() {
  /** @type {ThermalDef[]} */
  const defs = Array.from({ length: 256 }, (_, i) => ({
    heatCapacity: 16,
    meltTemp: 0,
    boilTemp: 255,
    solidId: /** @type {ParticleId} */ (i),
    liquidId: /** @type {ParticleId} */ (i),
    gasId: /** @type {ParticleId} */ (i),
    latentFusion: 0,
    latentVaporization: 0,
  }));

  // Air: low heat capacity so it changes temperature quickly.
  defs[Particle.EMPTY].heatCapacity = 8;

  // Water group: ICE <-> WATER <-> STEAM.
  const meltTemp = 125;
  const boilTemp = 210;
  const heatCapacity = 40;
  const latentFusion = 2600;
  const latentVaporization = 14000;
  for (const id of [Particle.ICE, Particle.WATER, Particle.STEAM]) {
    defs[id] = {
      heatCapacity,
      meltTemp,
      boilTemp,
      solidId: Particle.ICE,
      liquidId: Particle.WATER,
      gasId: Particle.STEAM,
      latentFusion,
      latentVaporization,
    };
  }

  // Lava: high heat capacity, but keep it single-phase for now (crusting remains special-cased).
  defs[Particle.LAVA].heatCapacity = 30;

  // Stone is a decent heat reservoir.
  defs[Particle.STONE].heatCapacity = 28;

  // Bot: moderate heat capacity so it doesn't flash hot/cold instantly.
  defs[Particle.BOT].heatCapacity = 20;
  defs[Particle.GLIDER].heatCapacity = 20;

  return defs;
}

/**
 * RGBA8UI thermal texture #0:
 * - R: heatCapacity
 * - G: meltTemp
 * - B: boilTemp
 * - A: unused
 *
 * @param {ThermalDef[]} defs
 * @returns {Uint8Array}
 */
export function buildThermal0Texels(defs) {
  const texels = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const def = defs[i];
    const idx = i * 4;
    texels[idx + 0] = clampByte(def.heatCapacity);
    texels[idx + 1] = clampByte(def.meltTemp);
    texels[idx + 2] = clampByte(def.boilTemp);
    texels[idx + 3] = 0;
  }
  return texels;
}

/**
 * RGBA8UI thermal texture #1:
 * - R: solidId
 * - G: liquidId
 * - B: gasId
 * - A: unused
 *
 * @param {ThermalDef[]} defs
 * @returns {Uint8Array}
 */
export function buildThermal1Texels(defs) {
  const texels = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const def = defs[i];
    const idx = i * 4;
    texels[idx + 0] = clampByte(def.solidId);
    texels[idx + 1] = clampByte(def.liquidId);
    texels[idx + 2] = clampByte(def.gasId);
    texels[idx + 3] = 0;
  }
  return texels;
}

/**
 * RGBA8UI latent heat texture:
 * - R,G: latentFusion (u16 little-endian)
 * - B,A: latentVaporization (u16 little-endian)
 *
 * @param {ThermalDef[]} defs
 * @returns {Uint8Array}
 */
export function buildLatentTexels(defs) {
  const texels = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const def = defs[i];
    const lf = def.latentFusion | 0;
    const lv = def.latentVaporization | 0;
    const idx = i * 4;
    texels[idx + 0] = lf & 255;
    texels[idx + 1] = (lf >> 8) & 255;
    texels[idx + 2] = lv & 255;
    texels[idx + 3] = (lv >> 8) & 255;
  }
  return texels;
}
