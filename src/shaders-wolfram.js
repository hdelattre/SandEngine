// @ts-check

export const WOLFRAM_UPDATE_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_ca;
uniform int u_width;
uniform uint u_rule;

layout(location = 0) out uvec4 outCa;

uint bitAt(int x) {
  if (x < 0 || x >= u_width) return 0u;
  return texelFetch(u_ca, ivec2(x, 0), 0).r & 1u;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int x = c.x;
  if (x < 0 || x >= u_width) {
    outCa = uvec4(0u);
    return;
  }

  uint l = bitAt(x - 1);
  uint m = bitAt(x);
  uint r = bitAt(x + 1);
  uint idx = (l << 2u) | (m << 1u) | r; // 0..7 (000..111)
  uint next = (u_rule >> idx) & 1u;
  outCa = uvec4(next, 0u, 0u, 0u);
}
`;

export const WOLFRAM_APPLY_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform usampler2D u_energy;
uniform usampler2D u_ca;
uniform usampler2D u_thermal0;
uniform usampler2D u_thermal1;
uniform usampler2D u_latent;
uniform ivec2 u_size;
uniform uint u_ambientTemp;
uniform uint u_paintId;
uniform int u_emitAxis; // 0=row (emitY), 1=column (emitX)
uniform int u_emitPos;

layout(location = 0) out uvec4 outState;
layout(location = 1) out uvec4 outEnergy;

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
const uint P_BOT = 19u;
const uint P_GLIDER = 20u;

uvec4 loadThermal0(uint id) {
  return texelFetch(u_thermal0, ivec2(int(id), 0), 0);
}

uvec4 loadThermal1(uint id) {
  return texelFetch(u_thermal1, ivec2(int(id), 0), 0);
}

uint unpackU16(uvec2 lohi) {
  return lohi.x | (lohi.y << 8u);
}

uint latentFusion(uint id) {
  uvec4 t = texelFetch(u_latent, ivec2(int(id), 0), 0);
  return unpackU16(t.rg);
}

uint latentVapor(uint id) {
  uvec4 t = texelFetch(u_latent, ivec2(int(id), 0), 0);
  return unpackU16(t.ba);
}

uint energyForTemp(uint id, uint temp) {
  uvec4 th0 = loadThermal0(id);
  uint c = max(1u, th0.r);
  uint lf = latentFusion(id);
  uint lv = latentVapor(id);
  uvec4 ph = loadThermal1(id);
  uint solidId = ph.r;
  uint liquidId = ph.g;
  uint gasId = ph.b;
  uint e = c * temp;
  if (id == liquidId && liquidId != solidId) e += lf;
  else if (id == gasId && gasId != liquidId) e += (lf + lv);
  return min(65535u, e);
}

uvec4 packEnergy(uint e) {
  return uvec4(e & 255u, (e >> 8u) & 255u, 0u, 0u);
}

uvec4 packEnergyKeepBA(uint e, uvec2 ba) {
  return uvec4(e & 255u, (e >> 8u) & 255u, ba.x, ba.y);
}

uvec4 makeCell(uint id) {
  uint temp = u_ambientTemp;
  uint data = 0u;
  uint meta = 0u;
  if (id == P_MUD) data = 200u;
  else if (id == P_ACID) data = 180u;
  else if (id == P_PLANT) { data = 120u; meta = 32u; }
  else if (id == P_BRINE) { data = 120u; }
  else if (id == P_BATTERY) { data = 255u; }
  else if (id == P_BOT) { meta = 136u; }
  else if (id == P_GLIDER) { meta = 136u; }
  if (id == P_LAVA) temp = 250u;
  else if (id == P_FIRE) { temp = max(temp, 245u); data = max(data, 80u); meta = max(meta, 10u); }
  else if (id == P_SMOKE) { temp = max(temp, 170u); data = max(data, 140u); }
  else if (id == P_STEAM) { temp = max(temp, 205u); data = max(data, 170u); }
  else if (id == P_ICE) { temp = min(temp, 90u); }
  else if (id == P_SPARK) { temp = max(temp, 245u); data = max(data, 18u); }
  return uvec4(id, temp, data, meta);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (c.x < 0 || c.y < 0 || c.x >= u_size.x || c.y >= u_size.y) {
    outState = uvec4(0u);
    outEnergy = uvec4(0u);
    return;
  }

  uvec4 cur = texelFetch(u_state, c, 0);
  uvec4 curE = texelFetch(u_energy, c, 0);

  if (u_paintId == P_EMPTY) {
    outState = cur;
    outEnergy = curE;
    return;
  }

  int axis = u_emitAxis;
  if (axis == 0) {
    if (c.y != u_emitPos) {
      outState = cur;
      outEnergy = curE;
      return;
    }
  } else {
    if (c.x != u_emitPos) {
      outState = cur;
      outEnergy = curE;
      return;
    }
  }

  int idx = (axis == 0) ? c.x : c.y;
  uint bit = texelFetch(u_ca, ivec2(idx, 0), 0).r & 1u;
  if (bit == 0u || cur.r != P_EMPTY) {
    outState = cur;
    outEnergy = curE;
    return;
  }

  uvec4 s = makeCell(u_paintId);
  outState = s;
  outEnergy = packEnergyKeepBA(energyForTemp(s.r, s.g), curE.ba);
}
`;
