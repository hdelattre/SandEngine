// @ts-check

export const FULLSCREEN_VERT = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p;
  // Triangle strip: 0(-1,-1), 1(1,-1), 2(-1,1), 3(1,1)
  if (gl_VertexID == 0) p = vec2(-1.0, -1.0);
  else if (gl_VertexID == 1) p = vec2(1.0, -1.0);
  else if (gl_VertexID == 2) p = vec2(-1.0, 1.0);
  else p = vec2(1.0, 1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const HEAT_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform usampler2D u_props;
uniform ivec2 u_size;
uniform ivec2 u_dir;
uniform int u_parity;

layout(location = 0) out uvec4 outState;

const uint FLAG_IMMOVABLE = 1u << 0u;

bool inBounds(ivec2 c) {
  return c.x >= 0 && c.y >= 0 && c.x < u_size.x && c.y < u_size.y;
}

uvec4 loadState(ivec2 c) {
  return texelFetch(u_state, c, 0);
}

uvec4 loadProps(uint id) {
  return texelFetch(u_props, ivec2(int(id), 0), 0);
}

uint clampU8(int v) {
  return uint(v < 0 ? 0 : (v > 255 ? 255 : v));
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);

  int axis = (u_dir.x != 0) ? c.x : c.y;
  bool isA = ((axis + u_parity) & 1) == 0;

  ivec2 aC = isA ? c : (c - u_dir);
  ivec2 bC = isA ? (c + u_dir) : c;
  bool aIsHere = isA;

  if (!inBounds(aC) || !inBounds(bC)) {
    outState = loadState(c);
    return;
  }

  uvec4 a = loadState(aC);
  uvec4 b = loadState(bC);

  uint aId = a.r;
  uint bId = b.r;
  uint aTemp = a.g;
  uint bTemp = b.g;

  uvec4 aP = loadProps(aId);
  uvec4 bP = loadProps(bId);

  // Immovable solids still exchange heat.
  uint aCond = aP.g;
  uint bCond = bP.g;
  uint cond = (aCond + bCond) >> 1;

  int diff = int(aTemp) - int(bTemp);
  int transfer = (diff * int(cond)) / 2048;

  int newAT = int(aTemp) - transfer;
  int newBT = int(bTemp) + transfer;
  a.g = clampU8(newAT);
  b.g = clampU8(newBT);

  outState = aIsHere ? a : b;
}
`;

export const CLEAR_FRAG = `#version 300 es
precision highp int;

uniform ivec2 u_size;
uniform uint u_ambientTemp;

layout(location = 0) out uvec4 outState;

const uint P_EMPTY = 0u;
const uint P_STONE = 3u;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  // Bottom + side walls; top is open.
  bool wall = (c.y == 0) || (c.x == 0) || (c.x == (u_size.x - 1));
  uint id = wall ? P_STONE : P_EMPTY;
  outState = uvec4(id, u_ambientTemp, 0u, 0u);
}
`;

export const MATTER_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform usampler2D u_props;
uniform ivec2 u_size;
uniform ivec2 u_dir;
uniform int u_parity;
uniform uint u_tick;
uniform uint u_seed;
uniform int u_selfStep;
uniform int u_doMove;
uniform uint u_ambientTemp;
uniform uint u_passSalt;

layout(location = 0) out uvec4 outState;

const uint P_EMPTY = 0u;
const uint P_SAND = 1u;
const uint P_WATER = 2u;
const uint P_STONE = 3u;
const uint P_DIRT = 4u;
const uint P_MUD = 5u;
const uint P_OIL = 6u;
const uint P_PLANT = 7u;
const uint P_FIRE = 8u;
const uint P_SMOKE = 9u;
const uint P_STEAM = 10u;
const uint P_LAVA = 11u;
const uint P_ACID = 12u;
const uint P_ICE = 13u;
const uint P_SALT = 14u;
const uint P_BRINE = 15u;
const uint P_WIRE = 16u;
const uint P_SPARK = 17u;
const uint P_BATTERY = 18u;

const uint FLAG_IMMOVABLE = 1u << 0u;
const uint FLAG_POWDER = 1u << 1u;
const uint FLAG_LIQUID = 1u << 2u;
const uint FLAG_GAS = 1u << 3u;
const uint FLAG_ENERGY = 1u << 4u;
const uint FLAG_FLAMMABLE = 1u << 5u;
const uint FLAG_DISSOLVABLE = 1u << 6u;

const uint T_FIRE = 245u;
const uint T_BOIL = 210u;
const uint T_CONDENSE = 160u;
const uint T_LAVA_SOLIDIFY = 150u;
const uint T_MUD_DRY = 175u;
const uint T_FREEZE = 105u;
const uint T_ICE_MELT = 145u;
const uint T_BRINE_FREEZE = 85u;
const uint T_BRINE_EVAP = 175u;
const uint LAVA_HARDEN_THRESHOLD = 180u;
const uint T_LAVA_RESOFTEN = 170u;

bool inBounds(ivec2 c) {
  return c.x >= 0 && c.y >= 0 && c.x < u_size.x && c.y < u_size.y;
}

uvec4 loadState(ivec2 c) {
  return texelFetch(u_state, c, 0);
}

uvec4 loadProps(uint id) {
  return texelFetch(u_props, ivec2(int(id), 0), 0);
}

uint clampU8(int v) {
  return uint(v < 0 ? 0 : (v > 255 ? 255 : v));
}

uint hashU32(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

uint randByte(uvec2 p, uint salt) {
  uint h = p.x * 374761393u + p.y * 668265263u;
  h ^= u_seed * 2654435761u;
  h ^= u_tick * 2246822519u;
  h ^= salt * 3266489917u;
  h = hashU32(h);
  return h & 255u;
}

bool hasFlag(uint flags, uint f) {
  return (flags & f) != 0u;
}

bool isFluid(uint flags) {
  return (flags & (FLAG_LIQUID | FLAG_GAS | FLAG_ENERGY)) != 0u;
}

bool canFallDown(ivec2 c, uint id, uvec4 p, uint pf) {
  if (hasFlag(pf, FLAG_IMMOVABLE) || (p.a == 0u)) return false;
  ivec2 dC = c + ivec2(0, -1);
  if (!inBounds(dC)) return false;

  uvec4 dS = loadState(dC);
  uint dId = dS.r;
  uvec4 dP = loadProps(dId);
  uint dF = dP.b;
  if (hasFlag(dF, FLAG_IMMOVABLE) || (dP.a == 0u)) return false;
  return p.r > dP.r;
}

int dirIndexFromDelta(ivec2 d) {
  if (d.x == 0 && d.y == 1) return 0;
  if (d.x == 1 && d.y == 1) return 1;
  if (d.x == 1 && d.y == 0) return 2;
  if (d.x == 1 && d.y == -1) return 3;
  if (d.x == 0 && d.y == -1) return 4;
  if (d.x == -1 && d.y == -1) return 5;
  if (d.x == -1 && d.y == 0) return 6;
  return 7;
}

int cycDiff8(int a, int b) {
  int d = abs(a - b);
  return d > 4 ? 8 - d : d;
}

uint packPlantMeta(uint dir, uint gene, uint cd) {
  return (dir & 7u) | ((gene & 7u) << 3u) | ((cd & 3u) << 6u);
}

uint columnMass2(ivec2 c) {
  uint m = 0u;
  for (int i = 1; i <= 2; i++) {
    int y = c.y + i;
    if (y >= u_size.y) break;
    uvec4 s = loadState(ivec2(c.x, y));
    uint id = s.r;
    if (id == P_EMPTY) continue;
    uvec4 p = loadProps(id);
    uint f = p.b;
    if (hasFlag(f, FLAG_GAS) || hasFlag(f, FLAG_ENERGY)) continue;
    m += 1u;
  }
  return m;
}

void tryPlantGrow(
  ivec2 plantC,
  ivec2 delta,
  inout uint plantId,
  inout uint plantTemp,
  inout uint plantData,
  inout uint plantMeta,
  inout uint tgtId,
  inout uint tgtTemp,
  inout uint tgtData,
  inout uint tgtMeta,
  uint salt
) {
  if (plantId != P_PLANT || tgtId != P_EMPTY) return;

  uint dir = plantMeta & 7u;
  uint gene = (plantMeta >> 3u) & 7u;
  uint cd = (plantMeta >> 6u) & 3u;

  if (cd != 0u) return;
  if (plantData < 170u) return;
  if (plantTemp > 220u) return;
  if (tgtTemp > 220u) return;

  int dIdx = dirIndexFromDelta(delta);
  int diff = cycDiff8(dIdx, int(dir));

  uint chance = 4u + gene * 2u;
  if (diff == 0) chance += 28u;
  else if (diff == 1) chance += 18u;
  else if (diff == 2) chance += 8u;
  else if (diff == 3) chance += gene;

  // Bias upward, but allow some sideways branching.
  if (dIdx == 0 || dIdx == 1 || dIdx == 7) chance += 10u;
  if (dIdx == 2 || dIdx == 6) chance += (gene >> 1u);

  // Root growth is possible but rarer.
  if (dIdx == 4 || dIdx == 3 || dIdx == 5) chance = (chance * 3u) >> 2;

  chance += (plantData - 170u) >> 3; // 0..10
  chance = min(chance, 92u);

  uint r = randByte(uvec2(plantC), salt);
  if (r >= chance) return;

  uint give = 60u + gene * 6u;
  if (plantData <= give + 8u) return;

  plantData -= give;
  plantMeta = packPlantMeta(dir, gene, 3u);

  uint r2 = randByte(uvec2(plantC), salt + 13u);
  int rot = int(r2 % 3u) - 1;
  int childDir = (dIdx + rot + 8) % 8;

  uint childGene = gene;
  if (r2 < 18u && childGene < 7u) childGene += 1u;
  else if (r2 > 236u && childGene > 0u) childGene -= 1u;

  tgtId = P_PLANT;
  tgtTemp = plantTemp;
  tgtData = give;
  tgtMeta = packPlantMeta(uint(childDir), childGene, 2u);
}

uvec4 setId(uvec4 s, uint id) {
  s.r = id;
  return s;
}

uvec4 selfUpdate(ivec2 c, uvec4 s, uint salt) {
  uint id = s.r;
  uint temp = s.g;
  uint data = s.b;
  uint meta = s.a;

  uvec4 p = loadProps(id);
  uint pf = p.b;

  // Ambient cooling.
  int t = int(temp);
  int a = int(u_ambientTemp);
  int diff = a - t;
  int div = hasFlag(pf, FLAG_GAS) ? 14 : (hasFlag(pf, FLAG_LIQUID) ? 45 : 90);
  // Lava doesn't cool toward ambient unless exposed; heat loss is handled via
  // diffusion (and extra surface cooling in the lava-specific block).
  if (id == P_LAVA) div = 1024;
  else if (id == P_STONE) div = 140;
  t += diff / div;
  temp = clampU8(t);

  // Type-specific updates.
  if (id == P_FIRE) {
    if (temp < T_FIRE) temp = T_FIRE;

    // Fire persists longer near fuel so it can spread (including downward).
    bool nearFuel = false;
    bool fuelBelow = false;
    ivec2 n;

    n = c + ivec2(0, -1);
    if (inBounds(n)) {
      uint nid = loadState(n).r;
      if (hasFlag(loadProps(nid).b, FLAG_FLAMMABLE)) {
        nearFuel = true;
        fuelBelow = true;
      }
    }

    n = c + ivec2(1, 0);
    if (!nearFuel && inBounds(n)) {
      uint nid = loadState(n).r;
      if (hasFlag(loadProps(nid).b, FLAG_FLAMMABLE)) nearFuel = true;
    }
    n = c + ivec2(-1, 0);
    if (!nearFuel && inBounds(n)) {
      uint nid = loadState(n).r;
      if (hasFlag(loadProps(nid).b, FLAG_FLAMMABLE)) nearFuel = true;
    }
    n = c + ivec2(0, 1);
    if (!nearFuel && inBounds(n)) {
      uint nid = loadState(n).r;
      if (hasFlag(loadProps(nid).b, FLAG_FLAMMABLE)) nearFuel = true;
    }

    if (nearFuel) data = max(data, 120u);
    if (fuelBelow) meta = max(meta, 2u);
    else if (meta > 0u) meta -= 1u;

    if (data > 0u) {
      bool doDecay = true;
      if (nearFuel) doDecay = false;
      else if (meta > 0u) doDecay = false;
      else if ((u_tick & 1u) != 0u) doDecay = false; // slower burn rate
      if (doDecay) data -= 1u;
    }
    if (data == 0u) {
      id = P_SMOKE;
      temp = temp > 180u ? 180u : temp;
      data = 140u;
      meta = 0u;
    }
  } else if (id == P_SMOKE) {
    if (data > 0u) data -= 1u;
    if (data == 0u) {
      id = P_EMPTY;
      temp = u_ambientTemp;
    }
  } else if (id == P_STEAM) {
    if (data > 0u) data -= 1u;
    if (temp <= T_CONDENSE) {
      id = P_WATER;
      data = 0u;
      // Condensation releases heat a bit.
      temp = temp + 6u > 255u ? 255u : (temp + 6u);
    } else if (data == 0u) {
      id = P_EMPTY;
      temp = u_ambientTemp;
    }
  } else if (id == P_WATER) {
    if (temp >= T_BOIL) {
      id = P_STEAM;
      data = 170u;
      temp = temp > 235u ? 235u : temp;
    } else if (temp <= T_FREEZE) {
      id = P_ICE;
      data = 0u;
      meta = 0u;
    }
  } else if (id == P_BRINE) {
    if (temp >= (T_BOIL + 12u)) {
      id = P_STEAM;
      data = 170u;
      temp = temp > 235u ? 235u : temp;
      meta = 0u;
    } else if (temp <= T_BRINE_FREEZE) {
      id = P_ICE;
      data = 0u;
      meta = 0u;
    }
  } else if (id == P_ICE) {
    if (temp >= T_ICE_MELT) {
      id = P_WATER;
      data = 0u;
      meta = 0u;
    }
  } else if (id == P_LAVA) {
    // Lava only hardens after being exposed to air/gas and sufficiently cooled.
    bool exposed = false;
    ivec2 n;

    n = c + ivec2(1, 0);
    if (!exposed && inBounds(n)) {
      uint nid = loadState(n).r;
      exposed = (nid == P_EMPTY) || (nid == P_SMOKE) || (nid == P_STEAM);
    }
    n = c + ivec2(-1, 0);
    if (!exposed && inBounds(n)) {
      uint nid = loadState(n).r;
      exposed = (nid == P_EMPTY) || (nid == P_SMOKE) || (nid == P_STEAM);
    }
    n = c + ivec2(0, 1);
    if (!exposed && inBounds(n)) {
      uint nid = loadState(n).r;
      exposed = (nid == P_EMPTY) || (nid == P_SMOKE) || (nid == P_STEAM);
    }
    n = c + ivec2(0, -1);
    if (!exposed && inBounds(n)) {
      uint nid = loadState(n).r;
      exposed = (nid == P_EMPTY) || (nid == P_SMOKE) || (nid == P_STEAM);
    }

    if (exposed) {
      // Extra surface cooling to make lava spread before crusting.
      int t2 = int(temp);
      int a2 = int(u_ambientTemp);
      int d2 = t2 - a2;
      if (d2 > 0) t2 -= 1 + (d2 / 48); // 1..3
      temp = clampU8(t2);

      if (temp <= T_LAVA_SOLIDIFY) {
        uint under = T_LAVA_SOLIDIFY - temp;
        uint inc = 1u + (under >> 5u); // 1..4
        uint r = randByte(uvec2(c), salt);
        if (r < 48u) inc += 1u;
        data = min(255u, data + inc);
        if (data >= LAVA_HARDEN_THRESHOLD) {
          id = P_STONE;
          data = 0u;
          meta = 0u;
        }
      } else if (temp >= T_LAVA_RESOFTEN) {
        if (data > 0u) data -= 1u;
      }
    } else {
      // Not exposed: harden progress relaxes.
      if (data > 0u) data = data > 2u ? (data - 2u) : 0u;
    }
  } else if (id == P_MUD) {
    // Mud slowly dries when warm.
    if (temp >= T_MUD_DRY && data > 0u) {
      uint r = randByte(uvec2(c), salt);
      uint loss = 1u + (r < 64u ? 2u : 0u);
      data = data > loss ? (data - loss) : 0u;
    }
    if (data == 0u && temp >= T_MUD_DRY) {
      id = P_DIRT;
    }
  } else if (id == P_PLANT) {
    // Plant energy decays, and growth cooldown counts down.
    if (data > 0u) data -= 1u;
    uint cd = (meta >> 6u) & 3u;
    if (cd > 0u) cd -= 1u;
    meta = (meta & 63u) | (cd << 6u);
  } else if (id == P_ACID) {
    // Acid slowly loses strength.
    if (data > 0u && (randByte(uvec2(c), salt) < 6u)) data -= 1u;
    if (data == 0u) {
      id = P_EMPTY;
      temp = u_ambientTemp;
    }
  } else if (id == P_SPARK) {
    if (data > 0u) data -= 1u;
    if (data == 0u) {
      id = P_EMPTY;
      temp = u_ambientTemp;
      meta = 0u;
    }
  } else if (id == P_WIRE) {
    // Wire charge (data) decays, and arc cooldown (meta) counts down.
    if (data > 0u) data -= 1u;
    if (meta > 0u) meta -= 1u;
  }

  // Open top boundary: gases/energy vent out of the world.
  if (c.y == (u_size.y - 1) && id != P_EMPTY) {
    if (hasFlag(pf, FLAG_GAS) || hasFlag(pf, FLAG_ENERGY)) {
      id = P_EMPTY;
      temp = u_ambientTemp;
      data = 0u;
      meta = 0u;
    }
  }

  s.r = id;
  s.g = temp;
  s.b = data;
  s.a = meta;
  return s;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);

  int axis = (u_dir.x != 0) ? c.x : c.y;
  bool isA = ((axis + u_parity) & 1) == 0;

  ivec2 aC = isA ? c : (c - u_dir);
  ivec2 bC = isA ? (c + u_dir) : c;
  bool aIsHere = isA;

  if (!inBounds(aC) || !inBounds(bC)) {
    outState = loadState(c);
    return;
  }

  uvec4 a = loadState(aC);
  uvec4 b = loadState(bC);

  if (u_selfStep != 0) {
    a = selfUpdate(aC, a, 11u + u_passSalt);
    b = selfUpdate(bC, b, 29u + u_passSalt);
  }

  uint aId = a.r;
  uint bId = b.r;
  uint aTemp = a.g;
  uint bTemp = b.g;
  uint aData = a.b;
  uint bData = b.b;
  uint aMeta = a.a;
  uint bMeta = b.a;

  uvec4 aP = loadProps(aId);
  uvec4 bP = loadProps(bId);
  uint aF = aP.b;
  uint bF = bP.b;

  // --- Pair chemistry ---

  // Plant energy exchange + refuel near water/soil.
  if (aId == P_PLANT && bId == P_PLANT) {
    int diff = int(aData) - int(bData);
    int transfer = diff / 8;
    if (transfer != 0) {
      aData = clampU8(int(aData) - transfer);
      bData = clampU8(int(bData) + transfer);
    }
  }

  if (aId == P_PLANT && bId == P_WATER) {
    aData = min(255u, aData + 26u);
  } else if (bId == P_PLANT && aId == P_WATER) {
    bData = min(255u, bData + 26u);
  } else if (aId == P_PLANT && bId == P_MUD) {
    aData = min(255u, aData + 12u);
  } else if (bId == P_PLANT && aId == P_MUD) {
    bData = min(255u, bData + 12u);
  } else if (aId == P_PLANT && bId == P_DIRT) {
    aData = min(150u, aData + 2u);
  } else if (bId == P_PLANT && aId == P_DIRT) {
    bData = min(150u, bData + 2u);
  }

  // Plant stress from salinity.
  if (aId == P_PLANT && bId == P_BRINE) {
    aData = aData > 10u ? (aData - 10u) : 0u;
  } else if (bId == P_PLANT && aId == P_BRINE) {
    bData = bData > 10u ? (bData - 10u) : 0u;
  } else if (aId == P_PLANT && bId == P_SALT) {
    aData = aData > 18u ? (aData - 18u) : 0u;
  } else if (bId == P_PLANT && aId == P_SALT) {
    bData = bData > 18u ? (bData - 18u) : 0u;
  }

  // Dirt + water -> mud.
  if (aId == P_DIRT && bId == P_WATER) {
    aId = P_MUD;
    aData = 200u;
  } else if (bId == P_DIRT && aId == P_WATER) {
    bId = P_MUD;
    bData = 200u;
  } else if (aId == P_DIRT && bId == P_BRINE) {
    aId = P_MUD;
    aData = 200u;
  } else if (bId == P_DIRT && aId == P_BRINE) {
    bId = P_MUD;
    bData = 200u;
  }

  // Salt dissolves into water -> brine (brine.data is salinity).
  if (aId == P_SALT && bId == P_WATER) {
    aId = P_EMPTY;
    aTemp = u_ambientTemp;
    bId = P_BRINE;
    bData = bData > 120u ? bData : 120u;
  } else if (bId == P_SALT && aId == P_WATER) {
    bId = P_EMPTY;
    bTemp = u_ambientTemp;
    aId = P_BRINE;
    aData = aData > 120u ? aData : 120u;
  } else if (aId == P_SALT && bId == P_BRINE) {
    if (bData < 250u) {
      aId = P_EMPTY;
      aTemp = u_ambientTemp;
      bData = min(255u, bData + 40u);
    }
  } else if (bId == P_SALT && aId == P_BRINE) {
    if (aData < 250u) {
      bId = P_EMPTY;
      bTemp = u_ambientTemp;
      aData = min(255u, aData + 40u);
    }
  }

  // Lava + water -> stone + steam.
  if (aId == P_LAVA && (bId == P_WATER || bId == P_ICE || bId == P_BRINE)) {
    aId = P_STONE;
    aMeta = 0u;
    bId = P_STEAM;
    bTemp = bTemp > 230u ? bTemp : 230u;
    bData = 170u;
    bMeta = 0u;
  } else if (bId == P_LAVA && (aId == P_WATER || aId == P_ICE || aId == P_BRINE)) {
    bId = P_STONE;
    bMeta = 0u;
    aId = P_STEAM;
    aTemp = aTemp > 230u ? aTemp : 230u;
    aData = 170u;
    aMeta = 0u;
  }

  // Lava ignites flammables on contact.
  if (aId == P_LAVA && hasFlag(bF, FLAG_FLAMMABLE)) {
    uint r = randByte(uvec2(aC), 77u + u_passSalt);
    if (r < 64u) {
      bId = P_FIRE;
      bTemp = bTemp > T_FIRE ? bTemp : T_FIRE;
      bData = 70u;
      bMeta = 10u;
    }
  } else if (bId == P_LAVA && hasFlag(aF, FLAG_FLAMMABLE)) {
    uint r = randByte(uvec2(aC), 79u + u_passSalt);
    if (r < 64u) {
      aId = P_FIRE;
      aTemp = aTemp > T_FIRE ? aTemp : T_FIRE;
      aData = 70u;
      aMeta = 10u;
    }
  }

  // Fire interaction (ignition + quench).
  {
    uint r = randByte(uvec2(aC), 101u + u_passSalt);

    // Fire + water/brine: quench.
    if (aId == P_FIRE && (bId == P_WATER || bId == P_BRINE)) {
      aId = P_SMOKE;
      aTemp = aTemp > 185u ? 185u : aTemp;
      aData = 90u;
      bTemp = clampU8(int(bTemp) + 48);
    } else if (bId == P_FIRE && (aId == P_WATER || aId == P_BRINE)) {
      bId = P_SMOKE;
      bTemp = bTemp > 185u ? 185u : bTemp;
      bData = 90u;
      aTemp = clampU8(int(aTemp) + 48);
    }

    // Fire + ice: melt + quench.
    if (aId == P_FIRE && bId == P_ICE) {
      aId = P_SMOKE;
      aTemp = aTemp > 185u ? 185u : aTemp;
      aData = 90u;
      bId = P_WATER;
      bTemp = clampU8(int(bTemp) + 70);
    } else if (bId == P_FIRE && aId == P_ICE) {
      bId = P_SMOKE;
      bTemp = bTemp > 185u ? 185u : bTemp;
      bData = 90u;
      aId = P_WATER;
      aTemp = clampU8(int(aTemp) + 70);
    }

    // Fire + flammable: ignite with temperature-influenced chance.
    if (aId == P_FIRE && hasFlag(bF, FLAG_FLAMMABLE)) {
      uint chance = 18u + (bTemp > 170u ? 22u : 0u);
      if (bId == P_OIL) chance += 12u;
      else if (bId == P_PLANT) chance += 4u;
      if (u_dir.x == 0 && u_dir.y == -1) chance += 14u; // allow downward spread
      else if (u_dir.y != 0) chance += 6u;
      if (r < chance) {
        bId = P_FIRE;
        bTemp = bTemp > T_FIRE ? bTemp : T_FIRE;
        bData = 80u;
        bMeta = 10u;
        aData = max(aData, 120u); // keep fire alive near fuel
      }
    } else if (bId == P_FIRE && hasFlag(aF, FLAG_FLAMMABLE)) {
      uint chance = 18u + (aTemp > 170u ? 22u : 0u);
      if (aId == P_OIL) chance += 12u;
      else if (aId == P_PLANT) chance += 4u;
      if (u_dir.x == 0 && u_dir.y == -1) chance += 10u;
      else if (u_dir.y != 0) chance += 4u;
      if (r < chance) {
        aId = P_FIRE;
        aTemp = aTemp > T_FIRE ? aTemp : T_FIRE;
        aData = 80u;
        aMeta = 10u;
        bData = max(bData, 120u);
      }
    }
  }

  // Acid dissolves dissolvables (and slowly eats sand).
  {
    uint r = randByte(uvec2(aC), 151u + u_passSalt);
    if (aId == P_ACID) {
      bool canDissolve = hasFlag(bF, FLAG_DISSOLVABLE) || (bId == P_SAND);
      if (canDissolve) {
        uint chance = hasFlag(bF, FLAG_DISSOLVABLE) ? 36u : 10u;
        if (r < chance && aData > 0u && bId != P_STONE) {
          bId = P_EMPTY;
          bTemp = u_ambientTemp;
          uint cost = hasFlag(bF, FLAG_DISSOLVABLE) ? 10u : 5u;
          aData = aData > cost ? (aData - cost) : 0u;
        }
      }
    } else if (bId == P_ACID) {
      bool canDissolve = hasFlag(aF, FLAG_DISSOLVABLE) || (aId == P_SAND);
      if (canDissolve) {
        uint chance = hasFlag(aF, FLAG_DISSOLVABLE) ? 36u : 10u;
        if (r < chance && bData > 0u && aId != P_STONE) {
          aId = P_EMPTY;
          aTemp = u_ambientTemp;
          uint cost = hasFlag(aF, FLAG_DISSOLVABLE) ? 10u : 5u;
          bData = bData > cost ? (bData - cost) : 0u;
        }
      }
    }
  }

  // Brine evaporates into steam near air when warm, concentrating and sometimes crystallizing salt.
  if (u_dir.x == 0 && u_dir.y == -1) {
    uint r = randByte(uvec2(bC), 171u + u_passSalt);
    if (aId == P_EMPTY && bId == P_BRINE && bTemp >= T_BRINE_EVAP) {
      uint chance = 6u + ((bTemp - T_BRINE_EVAP) >> 3); // 6..~16
      chance = min(chance, 22u);
      if (r < chance) {
        uint r2 = randByte(uvec2(bC), 173u + u_passSalt);
        bool saturated = bData >= 240u;

        aId = P_STEAM;
        aTemp = (bTemp > 200u) ? bTemp : 200u;
        aData = saturated ? 120u : 90u;
        aMeta = 0u;

        if (saturated && r2 < 120u) {
          bId = P_SALT;
          bData = 0u;
          bMeta = 0u;
        } else {
          bData = min(255u, bData + 12u);
          bTemp = clampU8(int(bTemp) - 6); // latent heat
        }
      }
    }
  }

  // Electricity: wire charge + sparks.
  {
    uint rA = randByte(uvec2(aC), 181u + u_passSalt);
    uint rB = randByte(uvec2(bC), 183u + u_passSalt);
    bool orth = (u_dir.x == 0 || u_dir.y == 0);

    // Battery charges adjacent wire.
    if (orth && aId == P_BATTERY && bId == P_WIRE) {
      bData = max(bData, 220u);
    } else if (orth && bId == P_BATTERY && aId == P_WIRE) {
      aData = max(aData, 220u);
    }

    // Wire-wire charge propagation.
    if (orth && aId == P_WIRE && bId == P_WIRE) {
      int diff = int(aData) - int(bData);
      int transfer = diff / 4;
      if (transfer != 0) {
        aData = clampU8(int(aData) - transfer);
        bData = clampU8(int(bData) + transfer);
      }
    }

    // Spark charges wire.
    if (aId == P_WIRE && bId == P_SPARK) {
      aData = min(255u, aData + 120u);
      bId = P_EMPTY;
      bTemp = u_ambientTemp;
      bData = 0u;
      bMeta = 0u;
      aMeta = max(aMeta, 2u);
    } else if (bId == P_WIRE && aId == P_SPARK) {
      bData = min(255u, bData + 120u);
      aId = P_EMPTY;
      aTemp = u_ambientTemp;
      aData = 0u;
      aMeta = 0u;
      bMeta = max(bMeta, 2u);
    }

    // Charged wire arcs into air, spawning spark (wire.meta is a cooldown).
    if (orth && aId == P_WIRE && bId == P_EMPTY && aData >= 180u && aMeta == 0u) {
      uint chance = 6u + ((aData - 180u) >> 3); // 6..~15
      if (rA < chance) {
        bId = P_SPARK;
        bTemp = aTemp > T_FIRE ? aTemp : T_FIRE;
        bData = 18u;
        bMeta = 0u;
        aData = aData > 50u ? (aData - 50u) : 0u;
        aMeta = 10u;
      }
    } else if (orth && bId == P_WIRE && aId == P_EMPTY && bData >= 180u && bMeta == 0u) {
      uint chance = 6u + ((bData - 180u) >> 3); // 6..~15
      if (rB < chance) {
        aId = P_SPARK;
        aTemp = bTemp > T_FIRE ? bTemp : T_FIRE;
        aData = 18u;
        aMeta = 0u;
        bData = bData > 50u ? (bData - 50u) : 0u;
        bMeta = 10u;
      }
    }

    // Charged wire heats nearby water/brine (simple shock heating).
    if (orth && aId == P_WIRE && (bId == P_WATER || bId == P_BRINE) && aData >= 120u) {
      uint heat = 6u + (aData >> 5u); // 6..13
      bTemp = clampU8(int(bTemp) + int(heat));
      aData = aData > 8u ? (aData - 8u) : 0u;
    } else if (orth && bId == P_WIRE && (aId == P_WATER || aId == P_BRINE) && bData >= 120u) {
      uint heat = 6u + (bData >> 5u); // 6..13
      aTemp = clampU8(int(aTemp) + int(heat));
      bData = bData > 8u ? (bData - 8u) : 0u;
    }

    // Wire can ignite flammables when highly charged.
    if (aId == P_WIRE && hasFlag(bF, FLAG_FLAMMABLE) && aData >= 210u) {
      uint chance = 12u + ((aData - 210u) >> 2); // 12..23
      if (rA < chance) {
        bId = P_FIRE;
        bTemp = bTemp > T_FIRE ? bTemp : T_FIRE;
        bData = 70u;
        bMeta = 10u;
        aData = aData > 80u ? (aData - 80u) : 0u;
        aMeta = 12u;
      }
    } else if (bId == P_WIRE && hasFlag(aF, FLAG_FLAMMABLE) && bData >= 210u) {
      uint chance = 12u + ((bData - 210u) >> 2); // 12..23
      if (rB < chance) {
        aId = P_FIRE;
        aTemp = aTemp > T_FIRE ? aTemp : T_FIRE;
        aData = 70u;
        aMeta = 10u;
        bData = bData > 80u ? (bData - 80u) : 0u;
        bMeta = 12u;
      }
    }

    // Spark fizzles in liquids/ice and can ignite flammables.
    if (aId == P_SPARK && (bId == P_WATER || bId == P_BRINE)) {
      aId = P_EMPTY;
      aTemp = u_ambientTemp;
      aData = 0u;
      aMeta = 0u;
      bTemp = clampU8(int(bTemp) + 24);
    } else if (bId == P_SPARK && (aId == P_WATER || aId == P_BRINE)) {
      bId = P_EMPTY;
      bTemp = u_ambientTemp;
      bData = 0u;
      bMeta = 0u;
      aTemp = clampU8(int(aTemp) + 24);
    } else if (aId == P_SPARK && bId == P_ICE) {
      aId = P_EMPTY;
      aTemp = u_ambientTemp;
      aData = 0u;
      aMeta = 0u;
      bId = P_WATER;
      bTemp = clampU8(int(bTemp) + 32);
      bData = 0u;
      bMeta = 0u;
    } else if (bId == P_SPARK && aId == P_ICE) {
      bId = P_EMPTY;
      bTemp = u_ambientTemp;
      bData = 0u;
      bMeta = 0u;
      aId = P_WATER;
      aTemp = clampU8(int(aTemp) + 32);
      aData = 0u;
      aMeta = 0u;
    } else if (aId == P_SPARK && hasFlag(bF, FLAG_FLAMMABLE)) {
      if (rA < 90u) {
        bId = P_FIRE;
        bTemp = bTemp > T_FIRE ? bTemp : T_FIRE;
        bData = 70u;
        bMeta = 10u;
        aId = P_EMPTY;
        aTemp = u_ambientTemp;
        aData = 0u;
        aMeta = 0u;
      }
    } else if (bId == P_SPARK && hasFlag(aF, FLAG_FLAMMABLE)) {
      if (rB < 90u) {
        aId = P_FIRE;
        aTemp = aTemp > T_FIRE ? aTemp : T_FIRE;
        aData = 70u;
        aMeta = 10u;
        bId = P_EMPTY;
        bTemp = u_ambientTemp;
        bData = 0u;
        bMeta = 0u;
      }
    }
  }

  // Plant grows with directional branching (metadata-driven).
  if (aId == P_PLANT && bId == P_EMPTY) {
    tryPlantGrow(aC, u_dir, aId, aTemp, aData, aMeta, bId, bTemp, bData, bMeta, 201u + u_passSalt);
  } else if (bId == P_PLANT && aId == P_EMPTY) {
    tryPlantGrow(bC, -u_dir, bId, bTemp, bData, bMeta, aId, aTemp, aData, aMeta, 203u + u_passSalt);
  }

  // Apply the updated ids/data back.
  a.r = aId;
  b.r = bId;
  a.g = aTemp;
  b.g = bTemp;
  a.b = aData;
  b.b = bData;
  a.a = aMeta;
  b.a = bMeta;

  // Reload props after chemistry changes.
  aP = loadProps(aId);
  bP = loadProps(bId);
  aF = aP.b;
  bF = bP.b;

  // --- Movement ---
  if (u_doMove != 0) {
    bool gravityPass = (u_dir.y != 0);
    bool diagonalPass = gravityPass && (u_dir.x != 0);
    if (gravityPass) {
      bool aImmovable = hasFlag(aF, FLAG_IMMOVABLE) || (aP.a == 0u);
      bool bImmovable = hasFlag(bF, FLAG_IMMOVABLE) || (bP.a == 0u);
      if (!aImmovable && !bImmovable) {
        uint aD = aP.r;
        uint bD = bP.r;
        if (aD > bD) {
          bool bPinnedFire = (bId == P_FIRE) && (bMeta != 0u);
          bool aIsGasEnergy = hasFlag(aF, FLAG_GAS) || hasFlag(aF, FLAG_ENERGY);
          if (bPinnedFire && aIsGasEnergy) {
            // Keep newly-ignited flames anchored so they can spread into adjacent fuel.
          }
          // Prevent "falling sideways": only allow diagonal fall if straight-down is blocked.
          else if (diagonalPass && canFallDown(aC, aId, aP, aF)) {
            // no swap
          } else {
            uint r = randByte(uvec2(aC), 251u + u_passSalt);
            if (r < aP.a) {
              uvec4 tmp = a;
              a = b;
              b = tmp;
            }
          }
        }
      }
    } else {
      // Horizontal diffusion + liquid leveling (powders don't slide sideways).
      bool aPowder = hasFlag(aF, FLAG_POWDER);
      bool bPowder = hasFlag(bF, FLAG_POWDER);
      bool aStatic = hasFlag(aF, FLAG_IMMOVABLE) || (aP.a == 0u);
      bool bStatic = hasFlag(bF, FLAG_IMMOVABLE) || (bP.a == 0u);
      if (!aStatic && !bStatic) {
        bool aDisplaceable = (aId == P_EMPTY) || hasFlag(aF, FLAG_GAS) || hasFlag(aF, FLAG_ENERGY);
        bool bDisplaceable = (bId == P_EMPTY) || hasFlag(bF, FLAG_GAS) || hasFlag(bF, FLAG_ENERGY);

        // Liquids push sideways more aggressively under "head" (simple pressure proxy).
        // Only level sideways when the liquid can't fall straight down.
        if (!aPowder && hasFlag(bF, FLAG_LIQUID) && aDisplaceable) {
          if (canFallDown(bC, bId, bP, bF)) {
            // no sideways move while falling
          } else {
            uint headFrom = columnMass2(bC);
            uint headTo = columnMass2(aC);
            int hd = int(headFrom) - int(headTo);
            uint base = bP.a;
            uint prob = (hd > 0) ? base : ((hd == 0) ? ((base * 3u) >> 2) : (base >> 2));
            uint r = randByte(uvec2(aC), 93u + u_passSalt);
            if (r < prob) {
              uvec4 tmp = a;
              a = b;
              b = tmp;
            }
          }
        } else if (!bPowder && hasFlag(aF, FLAG_LIQUID) && bDisplaceable) {
          if (canFallDown(aC, aId, aP, aF)) {
            // no sideways move while falling
          } else {
            uint headFrom = columnMass2(aC);
            uint headTo = columnMass2(bC);
            int hd = int(headFrom) - int(headTo);
            uint base = aP.a;
            uint prob = (hd > 0) ? base : ((hd == 0) ? ((base * 3u) >> 2) : (base >> 2));
            uint r = randByte(uvec2(aC), 91u + u_passSalt);
            if (r < prob) {
              uvec4 tmp = a;
              a = b;
              b = tmp;
            }
          }
        } else {
          // Non-liquid fluids diffuse more gently (mainly into air).
          if (aId == P_EMPTY && !bPowder && isFluid(bF) && bId != P_EMPTY && !(bId == P_FIRE && bMeta != 0u)) {
            uint r = randByte(uvec2(aC), 91u + u_passSalt);
            if (r < (bP.a >> 1)) {
              uvec4 tmp = a;
              a = b;
              b = tmp;
            }
          } else if (bId == P_EMPTY && !aPowder && isFluid(aF) && aId != P_EMPTY && !(aId == P_FIRE && aMeta != 0u)) {
            uint r = randByte(uvec2(aC), 93u + u_passSalt);
            if (r < (aP.a >> 1)) {
              uvec4 tmp = a;
              a = b;
              b = tmp;
            }
          }
        }
      }
    }
  }

  outState = aIsHere ? a : b;
}
`;

export const PAINT_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform ivec2 u_size;
uniform ivec2 u_center;
uniform int u_radius;
uniform uvec4 u_paint;
uniform uint u_seed;
uniform uint u_tick;
uniform int u_addMode;

layout(location = 0) out uvec4 outState;

const uint P_EMPTY = 0u;
const uint P_WATER = 2u;
const uint P_DIRT = 4u;
const uint P_MUD = 5u;
const uint P_OIL = 6u;
const uint P_PLANT = 7u;
const uint P_FIRE = 8u;
const uint P_SMOKE = 9u;
const uint P_SALT = 14u;
const uint P_BRINE = 15u;
const uint P_WIRE = 16u;
const uint P_SPARK = 17u;

uint hashU32(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

uint randByte(uvec2 p, uint salt) {
  uint h = p.x * 374761393u + p.y * 668265263u;
  h ^= u_seed * 2654435761u;
  h ^= u_tick * 2246822519u;
  h ^= salt * 3266489917u;
  h = hashU32(h);
  return h & 255u;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (c.x < 0 || c.y < 0 || c.x >= u_size.x || c.y >= u_size.y) {
    outState = uvec4(0u);
    return;
  }
  uvec4 cur = texelFetch(u_state, c, 0);

  ivec2 d = c - u_center;
  int r2 = u_radius * u_radius;
  int dist2 = d.x * d.x + d.y * d.y;

  if (dist2 <= r2) {
    uvec4 s = u_paint;

    if (u_addMode != 0 && s.r != P_EMPTY) {
      uint curId = cur.r;
      if (curId != P_EMPTY) {
        bool changed = false;
        uvec4 nextCell = cur;

        // Meaningful single-cell interactions for "add" mode.
        if (s.r == P_FIRE && (curId == P_PLANT || curId == P_OIL)) {
          nextCell = uvec4(P_FIRE, max(cur.g, 245u), 80u, 10u);
          changed = true;
        } else if (s.r == P_WATER && curId == P_DIRT) {
          nextCell = uvec4(P_MUD, (cur.g + s.g) >> 1, 200u, 0u);
          changed = true;
        } else if (s.r == P_WATER && curId == P_FIRE) {
          nextCell = uvec4(P_SMOKE, min(cur.g, 185u), 90u, 0u);
          changed = true;
        } else if (s.r == P_SALT && curId == P_WATER) {
          nextCell = uvec4(P_BRINE, (cur.g + s.g) >> 1, 120u, 0u);
          changed = true;
        } else if (s.r == P_SPARK && curId == P_WIRE) {
          nextCell.b = min(255u, nextCell.b + 120u);
          nextCell.a = max(nextCell.a, 2u);
          changed = true;
        } else if (s.r == P_PLANT && (curId == P_DIRT || curId == P_MUD)) {
          nextCell = s;
          nextCell.g = (cur.g + s.g) >> 1;
          if (nextCell.b < 120u) nextCell.b = 120u;
          changed = true;
        }

        if (!changed) {
          outState = cur;
          return;
        }
        s = nextCell;
      }
    }

    // Plant gets per-cell randomized growth metadata so it grows in branching patterns.
    if (s.r == P_PLANT) {
      uint r0 = randByte(uvec2(c), 17u);
      uint r1 = randByte(uvec2(c), 19u);

      // Favor upward growth directions for nicer initial shapes.
      uint dir;
      if (r0 < 190u) {
        uint k = r1 % 3u;
        dir = (k == 0u) ? 0u : ((k == 1u) ? 1u : 7u);
      } else {
        dir = r1 & 7u;
      }

      uint gene = (r1 >> 3u) & 7u;
      gene = 3u + (gene >> 1u); // 3..6
      uint cooldown = 0u;

      s.a = (dir & 7u) | ((gene & 7u) << 3u) | (cooldown << 6u);
      if (s.b < 120u) s.b = 120u;
    }

    outState = s;
  }
  else outState = cur;
}
`;

export const STAMP_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform sampler2D u_image;
uniform sampler2D u_palette;
uniform ivec2 u_size;
uniform ivec2 u_imgSize;
uniform ivec2 u_origin;
uniform uint u_ambientTemp;
uniform int u_edgeStone;
uniform int u_addMode;

layout(location = 0) out uvec4 outState;

const uint P_EMPTY = 0u;
const uint P_SAND = 1u;
const uint P_WATER = 2u;
const uint P_STONE = 3u;
const uint P_DIRT = 4u;
const uint P_MUD = 5u;
const uint P_OIL = 6u;
const uint P_PLANT = 7u;
const uint P_FIRE = 8u;
const uint P_SMOKE = 9u;
const uint P_STEAM = 10u;
const uint P_LAVA = 11u;
const uint P_ACID = 12u;
const uint P_ICE = 13u;
const uint P_SALT = 14u;
const uint P_BRINE = 15u;
const uint P_WIRE = 16u;
const uint P_SPARK = 17u;
const uint P_BATTERY = 18u;

uvec4 loadState(ivec2 c) {
  return texelFetch(u_state, c, 0);
}

uvec4 makeCell(uint id) {
  uint temp = u_ambientTemp;
  uint data = 0u;
  uint meta = 0u;
  if (id == P_MUD) data = 200u;
  else if (id == P_ACID) data = 180u;
  else if (id == P_LAVA) temp = 250u;
  else if (id == P_FIRE) { temp = 245u; data = 80u; }
  else if (id == P_SMOKE) { temp = 170u; data = 140u; }
  else if (id == P_STEAM) { temp = 205u; data = 170u; }
  else if (id == P_PLANT) { data = 120u; meta = 32u; }
  else if (id == P_ICE) { temp = 90u; }
  else if (id == P_BRINE) { data = 120u; }
  else if (id == P_SPARK) { temp = 245u; data = 18u; }
  else if (id == P_BATTERY) { data = 255u; }
  return uvec4(id, temp, data, meta);
}

float colorDist(vec3 a, vec3 b) {
  vec3 d = a - b;
  return dot(d, d);
}

uint mapColor(vec3 rgb) {
  float best = 1e9;
  uint bestId = P_STONE;
  for (int id = 0; id < 256; id++) {
    vec3 pc = texelFetch(u_palette, ivec2(id, 0), 0).rgb;
    // Skip placeholder magenta entries (undefined particles).
    if (pc.r > 0.99 && pc.g < 0.01 && pc.b > 0.99) continue;
    float d = colorDist(rgb, pc);
    if (d < best) {
      best = d;
      bestId = uint(id);
    }
  }
  return bestId;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  uvec4 cur = loadState(c);

  // Preserve boundaries (bottom + side walls).
  if (c.x == 0 || c.x == (u_size.x - 1) || c.y == 0) {
    outState = cur;
    return;
  }

  ivec2 ic = c - u_origin;
  if (ic.x < 0 || ic.y < 0 || ic.x >= u_imgSize.x || ic.y >= u_imgSize.y) {
    outState = cur;
    return;
  }

  vec4 px = texelFetch(u_image, ic, 0);

  // Treat transparency as "no-op" so you can paste over an existing world.
  if (px.a < 0.05) {
    outState = cur;
    return;
  }

  float mx = max(max(px.r, px.g), px.b);
  float mn = min(min(px.r, px.g), px.b);
  float sat = (mx - mn) / max(mx, 1e-5);
  float lum = dot(px.rgb, vec3(0.2126, 0.7152, 0.0722));

  // Near-white backgrounds become air (common for pasted images).
  if (lum > 0.97 && sat < 0.08) {
    if (u_addMode != 0) outState = cur;
    else outState = makeCell(P_EMPTY);
    return;
  }

  // Very dark, low-saturation pixels become stone (useful for outlines).
  if (lum < 0.05 && sat < 0.25) {
    if (u_addMode != 0 && cur.r != P_EMPTY) outState = cur;
    else outState = makeCell(P_STONE);
    return;
  }

  // High-frequency edges become stone to preserve crisp shapes.
  if (u_edgeStone != 0) {
    ivec2 imMax = u_imgSize - ivec2(1);
    ivec2 lC = ivec2(max(ic.x - 1, 0), ic.y);
    ivec2 rC = ivec2(min(ic.x + 1, imMax.x), ic.y);
    ivec2 dC = ivec2(ic.x, max(ic.y - 1, 0));
    ivec2 uC = ivec2(ic.x, min(ic.y + 1, imMax.y));

    vec4 pxL = texelFetch(u_image, lC, 0);
    vec4 pxR = texelFetch(u_image, rC, 0);
    vec4 pxD = texelFetch(u_image, dC, 0);
    vec4 pxU = texelFetch(u_image, uC, 0);

    float lumL = dot(pxL.rgb, vec3(0.2126, 0.7152, 0.0722));
    float lumR = dot(pxR.rgb, vec3(0.2126, 0.7152, 0.0722));
    float lumD = dot(pxD.rgb, vec3(0.2126, 0.7152, 0.0722));
    float lumU = dot(pxU.rgb, vec3(0.2126, 0.7152, 0.0722));

    // Treat transparent neighbors as bright background.
    if (ic.x == 0) lumL = 1.0;
    if (ic.x == imMax.x) lumR = 1.0;
    if (ic.y == 0) lumD = 1.0;
    if (ic.y == imMax.y) lumU = 1.0;
    if (pxL.a < 0.05) lumL = 1.0;
    if (pxR.a < 0.05) lumR = 1.0;
    if (pxD.a < 0.05) lumD = 1.0;
    if (pxU.a < 0.05) lumU = 1.0;

    float e = max(max(abs(lum - lumL), abs(lum - lumR)), max(abs(lum - lumD), abs(lum - lumU)));
    float avg = (lumL + lumR + lumD + lumU) * 0.25;
    // Only stamp on the "darker" side of an edge so outlines stay ~1px thick.
    if (e > 0.22 && (lum + 0.025) < avg) {
      if (u_addMode != 0 && cur.r != P_EMPTY) outState = cur;
      else outState = makeCell(P_STONE);
      return;
    }
  }

  uint id = mapColor(px.rgb);
  if (u_addMode != 0) {
    if (id == P_EMPTY) outState = cur;
    else if (cur.r != P_EMPTY) outState = cur;
    else outState = makeCell(id);
  } else {
    outState = makeCell(id);
  }
}
`;

export const RENDER_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 v_uv;

uniform usampler2D u_state;
uniform sampler2D u_palette;
uniform ivec2 u_size;
uniform int u_viewMode; // 0 material, 1 temperature
uniform uint u_ambientTemp;

out vec4 outColor;

vec3 temperatureColor(float t) {
  // 0..1: cold->hot
  vec3 c0 = vec3(0.12, 0.22, 0.65);
  vec3 c1 = vec3(0.08, 0.70, 0.82);
  vec3 c2 = vec3(0.98, 0.84, 0.22);
  vec3 c3 = vec3(0.95, 0.18, 0.10);
  float a = smoothstep(0.0, 1.0, t);
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.33, a));
  c = mix(c, c2, smoothstep(0.33, 0.75, a));
  c = mix(c, c3, smoothstep(0.75, 1.0, a));
  return c;
}

void main() {
  vec2 uv = v_uv;
  ivec2 c = ivec2(floor(uv * vec2(u_size)));
  c = clamp(c, ivec2(0), u_size - ivec2(1));

  uvec4 s = texelFetch(u_state, c, 0);
  uint id = s.r;
  uint temp = s.g;

  if (u_viewMode == 1) {
    float t = float(temp) / 255.0;
    outColor = vec4(temperatureColor(t), 1.0);
    return;
  }

  vec4 base = texelFetch(u_palette, ivec2(int(id), 0), 0);
  float heat = (float(temp) - float(u_ambientTemp)) / 128.0; // ~[-1..1]
  vec3 warm = vec3(1.0, 0.45, 0.15);
  vec3 cool = vec3(0.25, 0.45, 1.0);
  vec3 shaded = base.rgb;
  shaded = mix(shaded, warm, clamp(heat, 0.0, 1.0) * 0.35);
  shaded = mix(shaded, cool, clamp(-heat, 0.0, 1.0) * 0.25);
  outColor = vec4(shaded, 1.0);
}
`;
