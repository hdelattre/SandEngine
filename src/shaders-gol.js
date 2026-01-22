// @ts-check

export const GOL_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform usampler2D u_energy;
uniform usampler2D u_thermal0;
uniform usampler2D u_thermal1;
uniform usampler2D u_latent;
uniform ivec2 u_size;
uniform uint u_seed;
uniform uint u_tick;

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

bool inBounds(ivec2 c) {
  return c.x >= 0 && c.y >= 0 && c.x < u_size.x && c.y < u_size.y;
}

uvec4 loadState(ivec2 c) {
  return texelFetch(u_state, c, 0);
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

uvec4 makeCell(uint id, uint temp) {
  uint data = 0u;
  uint meta = 0u;
  if (id == P_MUD) data = 200u;
  else if (id == P_ACID) data = 180u;
  else if (id == P_PLANT) { data = 120u; meta = 32u; }
  else if (id == P_BRINE) { data = 120u; }
  else if (id == P_BATTERY) { data = 255u; }
  else if (id == P_BOT) { meta = 148u; }
  else if (id == P_GLIDER) { meta = 148u; }
  // Temperature defaults are neighbor-driven for GoL; keep special-case temps only for lava/fire/smoke/steam/ice/spark.
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
  if (!inBounds(c)) {
    outState = uvec4(0u);
    outEnergy = uvec4(0u);
    return;
  }

  uvec4 cur = loadState(c);
  uvec4 curE = texelFetch(u_energy, c, 0);

  // Preserve hard boundaries (bottom + side walls).
  if (c.x == 0 || c.x == (u_size.x - 1) || c.y == 0) {
    outState = cur;
    outEnergy = curE;
    return;
  }

  bool alive = cur.r != P_EMPTY;

  // Fetch neighbor states (out-of-bounds count as empty).
  ivec2 c0 = c + ivec2(-1, -1);
  ivec2 c1 = c + ivec2(0, -1);
  ivec2 c2 = c + ivec2(1, -1);
  ivec2 c3 = c + ivec2(-1, 0);
  ivec2 c4 = c + ivec2(1, 0);
  ivec2 c5 = c + ivec2(-1, 1);
  ivec2 c6 = c + ivec2(0, 1);
  ivec2 c7 = c + ivec2(1, 1);

  uvec4 n0 = inBounds(c0) ? loadState(c0) : uvec4(P_EMPTY);
  uvec4 n1 = inBounds(c1) ? loadState(c1) : uvec4(P_EMPTY);
  uvec4 n2 = inBounds(c2) ? loadState(c2) : uvec4(P_EMPTY);
  uvec4 n3 = inBounds(c3) ? loadState(c3) : uvec4(P_EMPTY);
  uvec4 n4 = inBounds(c4) ? loadState(c4) : uvec4(P_EMPTY);
  uvec4 n5 = inBounds(c5) ? loadState(c5) : uvec4(P_EMPTY);
  uvec4 n6 = inBounds(c6) ? loadState(c6) : uvec4(P_EMPTY);
  uvec4 n7 = inBounds(c7) ? loadState(c7) : uvec4(P_EMPTY);

  uint cnt = 0u;
  cnt += (n0.r != P_EMPTY) ? 1u : 0u;
  cnt += (n1.r != P_EMPTY) ? 1u : 0u;
  cnt += (n2.r != P_EMPTY) ? 1u : 0u;
  cnt += (n3.r != P_EMPTY) ? 1u : 0u;
  cnt += (n4.r != P_EMPTY) ? 1u : 0u;
  cnt += (n5.r != P_EMPTY) ? 1u : 0u;
  cnt += (n6.r != P_EMPTY) ? 1u : 0u;
  cnt += (n7.r != P_EMPTY) ? 1u : 0u;

  if (alive) {
    if (cnt == 2u || cnt == 3u) {
      outState = cur;
      outEnergy = curE;
      return;
    }
    uvec4 s = uvec4(P_EMPTY, cur.g, 0u, 0u);
    outState = s;
    outEnergy = packEnergyKeepBA(energyForTemp(s.r, s.g), curE.ba);
    return;
  }

  if (cnt == 3u) {
    uint k = randByte(uvec2(c), 701u) % 3u;
    uvec4 born = uvec4(P_EMPTY);
    if (n0.r != P_EMPTY && born.r == P_EMPTY) { if (k == 0u) born = n0; else k -= 1u; }
    if (n1.r != P_EMPTY && born.r == P_EMPTY) { if (k == 0u) born = n1; else k -= 1u; }
    if (n2.r != P_EMPTY && born.r == P_EMPTY) { if (k == 0u) born = n2; else k -= 1u; }
    if (n3.r != P_EMPTY && born.r == P_EMPTY) { if (k == 0u) born = n3; else k -= 1u; }
    if (n4.r != P_EMPTY && born.r == P_EMPTY) { if (k == 0u) born = n4; else k -= 1u; }
    if (n5.r != P_EMPTY && born.r == P_EMPTY) { if (k == 0u) born = n5; else k -= 1u; }
    if (n6.r != P_EMPTY && born.r == P_EMPTY) { if (k == 0u) born = n6; else k -= 1u; }
    if (n7.r != P_EMPTY && born.r == P_EMPTY) { if (k == 0u) born = n7; else k -= 1u; }

    // Spawn the chosen neighbor's material, but with clean default metadata for that id.
    uvec4 s = makeCell(born.r, born.g);
    outState = s;
    outEnergy = packEnergyKeepBA(energyForTemp(s.r, s.g), curE.ba);
    return;
  }

  outState = cur;
  outEnergy = curE;
}
`;
