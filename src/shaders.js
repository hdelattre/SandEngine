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

uvec4 setId(uvec4 s, uint id) {
  s.r = id;
  return s;
}

uvec4 selfUpdate(ivec2 c, uvec4 s, uint salt) {
  uint id = s.r;
  uint temp = s.g;
  uint data = s.b;

  uvec4 p = loadProps(id);
  uint pf = p.b;

  // Ambient cooling.
  int t = int(temp);
  int a = int(u_ambientTemp);
  int diff = a - t;
  int div = hasFlag(pf, FLAG_GAS) ? 14 : (hasFlag(pf, FLAG_LIQUID) ? 45 : 90);
  if (id == P_LAVA) div = 180;
  else if (id == P_STONE) div = 140;
  t += diff / div;
  temp = clampU8(t);

  // Type-specific updates.
  if (id == P_FIRE) {
    if (temp < T_FIRE) temp = T_FIRE;
    if (data > 0u) data -= 1u;
    if (data == 0u) {
      id = P_SMOKE;
      temp = temp > 180u ? 180u : temp;
      data = 140u;
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
    }
  } else if (id == P_LAVA) {
    if (temp <= T_LAVA_SOLIDIFY) {
      id = P_STONE;
      data = 0u;
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
    // Plant hydration decays (data = hydration).
    if (data > 0u) data -= 1u;
  } else if (id == P_ACID) {
    // Acid slowly loses strength.
    if (data > 0u && (randByte(uvec2(c), salt) < 6u)) data -= 1u;
    if (data == 0u) {
      id = P_EMPTY;
      temp = u_ambientTemp;
    }
  }

  s.r = id;
  s.g = temp;
  s.b = data;
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

  uvec4 aP = loadProps(aId);
  uvec4 bP = loadProps(bId);
  uint aF = aP.b;
  uint bF = bP.b;

  // --- Pair chemistry ---

  // Plant hydration: touching water recharges hydration.
  if (aId == P_PLANT && bId == P_WATER) {
    aData = aData > 210u ? aData : 210u;
  } else if (bId == P_PLANT && aId == P_WATER) {
    bData = bData > 210u ? bData : 210u;
  }

  // Dirt + water -> mud.
  if (aId == P_DIRT && bId == P_WATER) {
    aId = P_MUD;
    aData = 200u;
  } else if (bId == P_DIRT && aId == P_WATER) {
    bId = P_MUD;
    bData = 200u;
  }

  // Lava + water -> stone + steam.
  if (aId == P_LAVA && bId == P_WATER) {
    aId = P_STONE;
    bId = P_STEAM;
    bTemp = bTemp > 230u ? bTemp : 230u;
    bData = 170u;
  } else if (bId == P_LAVA && aId == P_WATER) {
    bId = P_STONE;
    aId = P_STEAM;
    aTemp = aTemp > 230u ? aTemp : 230u;
    aData = 170u;
  }

  // Lava ignites flammables on contact.
  if (aId == P_LAVA && hasFlag(bF, FLAG_FLAMMABLE)) {
    uint r = randByte(uvec2(aC), 77u + u_passSalt);
    if (r < 64u) {
      bId = P_FIRE;
      bTemp = bTemp > T_FIRE ? bTemp : T_FIRE;
      bData = 45u;
    }
  } else if (bId == P_LAVA && hasFlag(aF, FLAG_FLAMMABLE)) {
    uint r = randByte(uvec2(aC), 79u + u_passSalt);
    if (r < 64u) {
      aId = P_FIRE;
      aTemp = aTemp > T_FIRE ? aTemp : T_FIRE;
      aData = 45u;
    }
  }

  // Fire interaction (ignition + quench).
  {
    uint r = randByte(uvec2(aC), 101u + u_passSalt);

    // Fire + water: quench.
    if (aId == P_FIRE && bId == P_WATER) {
      aId = P_SMOKE;
      aTemp = aTemp > 185u ? 185u : aTemp;
      aData = 90u;
      bTemp = clampU8(int(bTemp) + 48);
    } else if (bId == P_FIRE && aId == P_WATER) {
      bId = P_SMOKE;
      bTemp = bTemp > 185u ? 185u : bTemp;
      bData = 90u;
      aTemp = clampU8(int(aTemp) + 48);
    }

    // Fire + flammable: ignite with temperature-influenced chance.
    if (aId == P_FIRE && hasFlag(bF, FLAG_FLAMMABLE)) {
      uint chance = 18u + (bTemp > 170u ? 22u : 0u);
      if (bId == P_OIL) chance += 12u;
      else if (bId == P_PLANT) chance += 4u;
      if (r < chance) {
        bId = P_FIRE;
        bTemp = bTemp > T_FIRE ? bTemp : T_FIRE;
        bData = 55u;
        aData = aData < 80u ? 80u : aData; // keep fire alive near fuel
      }
    } else if (bId == P_FIRE && hasFlag(aF, FLAG_FLAMMABLE)) {
      uint chance = 18u + (aTemp > 170u ? 22u : 0u);
      if (aId == P_OIL) chance += 12u;
      else if (aId == P_PLANT) chance += 4u;
      if (r < chance) {
        aId = P_FIRE;
        aTemp = aTemp > T_FIRE ? aTemp : T_FIRE;
        aData = 55u;
        bData = bData < 80u ? 80u : bData;
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

  // Plant spreads into air when hydrated.
  {
    uint r = randByte(uvec2(aC), 201u + u_passSalt);
    if (aId == P_PLANT && bId == P_EMPTY && aData > 20u) {
      if (r < 10u) {
        bId = P_PLANT;
        bTemp = aTemp;
        bData = aData - 20u;
        aData = aData - 20u;
      }
    } else if (bId == P_PLANT && aId == P_EMPTY && bData > 20u) {
      if (r < 10u) {
        aId = P_PLANT;
        aTemp = bTemp;
        aData = bData - 20u;
        bData = bData - 20u;
      }
    }
  }

  // Apply the updated ids/data back.
  a.r = aId;
  b.r = bId;
  a.g = aTemp;
  b.g = bTemp;
  a.b = aData;
  b.b = bData;

  // Reload props after chemistry changes.
  aP = loadProps(aId);
  bP = loadProps(bId);
  aF = aP.b;
  bF = bP.b;

  // --- Movement ---
  bool gravityPass = (u_dir.y != 0);
  if (gravityPass) {
    bool aImmovable = hasFlag(aF, FLAG_IMMOVABLE) || (aP.a == 0u);
    bool bImmovable = hasFlag(bF, FLAG_IMMOVABLE) || (bP.a == 0u);
    if (!aImmovable && !bImmovable) {
      uint aD = aP.r;
      uint bD = bP.r;
      if (aD > bD) {
        uint r = randByte(uvec2(aC), 251u + u_passSalt);
        if (r < aP.a) {
          uvec4 tmp = a;
          a = b;
          b = tmp;
        }
      }
    }
  } else {
    // Horizontal diffusion for liquids/gases/energy into air (powders don't slide sideways).
    bool aPowder = hasFlag(aF, FLAG_POWDER);
    bool bPowder = hasFlag(bF, FLAG_POWDER);
    bool aStatic = hasFlag(aF, FLAG_IMMOVABLE) || (aP.a == 0u);
    bool bStatic = hasFlag(bF, FLAG_IMMOVABLE) || (bP.a == 0u);
    if (!aStatic && !bStatic) {
      if (aId == P_EMPTY && !bPowder && isFluid(bF) && bId != P_EMPTY) {
        uint r = randByte(uvec2(aC), 91u + u_passSalt);
        if (r < (bP.a >> 1)) {
          uvec4 tmp = a;
          a = b;
          b = tmp;
        }
      } else if (bId == P_EMPTY && !aPowder && isFluid(aF) && aId != P_EMPTY) {
        uint r = randByte(uvec2(aC), 93u + u_passSalt);
        if (r < (aP.a >> 1)) {
          uvec4 tmp = a;
          a = b;
          b = tmp;
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

layout(location = 0) out uvec4 outState;

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

  if (dist2 <= r2) outState = u_paint;
  else outState = cur;
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
