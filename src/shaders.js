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
uniform usampler2D u_energy;
uniform usampler2D u_props;
uniform usampler2D u_thermal0;
uniform usampler2D u_latent;
uniform ivec2 u_size;
uniform ivec2 u_dir;
uniform int u_parity;

layout(location = 0) out uvec4 outState;
layout(location = 1) out uvec4 outEnergy;

const uint FLAG_IMMOVABLE = 1u << 0u;

bool inBounds(ivec2 c) {
  return c.x >= 0 && c.y >= 0 && c.x < u_size.x && c.y < u_size.y;
}

uvec4 loadState(ivec2 c) {
  return texelFetch(u_state, c, 0);
}

uvec4 loadEnergy(ivec2 c) {
  return texelFetch(u_energy, c, 0);
}

uvec4 loadProps(uint id) {
  return texelFetch(u_props, ivec2(int(id), 0), 0);
}

uvec4 loadThermal0(uint id) {
  return texelFetch(u_thermal0, ivec2(int(id), 0), 0);
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

uint unpackEnergy(uvec4 e) {
  return unpackU16(e.rg);
}

uvec4 packEnergy(uint e) {
  return uvec4(e & 255u, (e >> 8u) & 255u, 0u, 0u);
}

uint clampU8(int v) {
  return uint(v < 0 ? 0 : (v > 255 ? 255 : v));
}

uint tempFromEnergy(uint id, uint e) {
  uvec4 th0 = loadThermal0(id);
  uint c = max(1u, th0.r);
  uint tm = th0.g;
  uint tb = th0.b;
  uint lf = latentFusion(id);
  uint lv = latentVapor(id);

  uint eSolidMax = c * tm;
  if (e < eSolidMax) return min(255u, e / c);
  if (lf > 0u && e < (eSolidMax + lf)) return tm;

  uint eLiquidMax = c * tb + lf;
  if (e < eLiquidMax) return min(255u, (e - lf) / c);
  if (lv > 0u && e < (eLiquidMax + lv)) return tb;

  uint base = lf + lv;
  if (e <= base) return 0u;
  return min(255u, (e - base) / c);
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
    outEnergy = loadEnergy(c);
    return;
  }

  uvec4 a = loadState(aC);
  uvec4 b = loadState(bC);
  uvec4 aE4 = loadEnergy(aC);
  uvec4 bE4 = loadEnergy(bC);

  uint aId = a.r;
  uint bId = b.r;
  uint aE = unpackEnergy(aE4);
  uint bE = unpackEnergy(bE4);

  uvec4 aP = loadProps(aId);
  uvec4 bP = loadProps(bId);

  // Immovable solids still exchange heat.
  uint aCond = aP.g;
  uint bCond = bP.g;
  uint cond = (aCond + bCond) >> 1;

  uint aCapa = max(1u, loadThermal0(aId).r);
  uint bCapa = max(1u, loadThermal0(bId).r);
  uint cAvg = (aCapa + bCapa) >> 1;

  uint aTemp = tempFromEnergy(aId, aE);
  uint bTemp = tempFromEnergy(bId, bE);
  int diffT = int(aTemp) - int(bTemp);

  // Heat transfer strength. Higher divisor = slower diffusion.
  int transfer = (diffT * int(cond) * int(cAvg)) / 8192;
  // Avoid "stuck" gradients from integer truncation at low diffs.
  if (transfer == 0 && diffT != 0 && cond > 40u) transfer = (diffT > 0) ? 1 : -1;

  if (transfer > 0) {
    uint dE = uint(transfer);
    if (dE > aE) dE = aE;
    aE -= dE;
    bE = min(65535u, bE + dE);
  } else if (transfer < 0) {
    uint dE = uint(-transfer);
    if (dE > bE) dE = bE;
    bE -= dE;
    aE = min(65535u, aE + dE);
  }

  a.g = clampU8(int(tempFromEnergy(aId, aE)));
  b.g = clampU8(int(tempFromEnergy(bId, bE)));

  outState = aIsHere ? a : b;
  outEnergy = aIsHere ? packEnergy(aE) : packEnergy(bE);
}
`;

export const CLEAR_FRAG = `#version 300 es
precision highp int;
precision highp usampler2D;

uniform ivec2 u_size;
uniform uint u_ambientTemp;
uniform usampler2D u_thermal0;
uniform usampler2D u_thermal1;
uniform usampler2D u_latent;

layout(location = 0) out uvec4 outState;
layout(location = 1) out uvec4 outEnergy;

const uint P_EMPTY = 0u;
const uint P_STONE = 3u;

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

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  // Bottom + side walls; top is open.
  bool wall = (c.y == 0) || (c.x == 0) || (c.x == (u_size.x - 1));
  uint id = wall ? P_STONE : P_EMPTY;
  outState = uvec4(id, u_ambientTemp, 0u, 0u);
  outEnergy = packEnergy(energyForTemp(id, u_ambientTemp));
}
`;

export const MATTER_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform usampler2D u_energy;
uniform usampler2D u_props;
uniform usampler2D u_thermal0;
uniform usampler2D u_thermal1;
uniform usampler2D u_latent;
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

uvec4 loadEnergy(ivec2 c) {
  return texelFetch(u_energy, c, 0);
}

uvec4 loadProps(uint id) {
  return texelFetch(u_props, ivec2(int(id), 0), 0);
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

uint unpackEnergy(uvec4 e) {
  return unpackU16(e.rg);
}

uvec4 packEnergy(uint e) {
  return uvec4(e & 255u, (e >> 8u) & 255u, 0u, 0u);
}

uint latentFusion(uint id) {
  uvec4 t = texelFetch(u_latent, ivec2(int(id), 0), 0);
  return unpackU16(t.rg);
}

uint latentVapor(uint id) {
  uvec4 t = texelFetch(u_latent, ivec2(int(id), 0), 0);
  return unpackU16(t.ba);
}

uint heatCapacity(uint id) {
  return max(1u, loadThermal0(id).r);
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

uint tempFromEnergy(uint id, uint e) {
  uvec4 th0 = loadThermal0(id);
  uint c = max(1u, th0.r);
  uint tm = th0.g;
  uint tb = th0.b;
  uint lf = latentFusion(id);
  uint lv = latentVapor(id);

  uint eSolidMax = c * tm;
  if (e < eSolidMax) return min(255u, e / c);
  if (lf > 0u && e < (eSolidMax + lf)) return tm;

  uint eLiquidMax = c * tb + lf;
  if (e < eLiquidMax) return min(255u, (e - lf) / c);
  if (lv > 0u && e < (eLiquidMax + lv)) return tb;

  uint base = lf + lv;
  if (e <= base) return 0u;
  return min(255u, (e - base) / c);
}

void applyPhase(inout uvec4 s, inout uint e) {
  uint id = s.r;
  uvec4 th0 = loadThermal0(id);
  uint c = max(1u, th0.r);
  uint tm = th0.g;
  uint tb = th0.b;
  uint lf = latentFusion(id);
  uint lv = latentVapor(id);
  uvec4 ph = loadThermal1(id);
  uint solidId = ph.r;
  uint liquidId = ph.g;
  uint gasId = ph.b;

  uint eSolidMax = c * tm;
  uint eFusionEnd = eSolidMax + lf;
  uint eLiquidMax = c * tb + lf;
  uint eVaporEnd = eLiquidMax + lv;

  uint temp;
  if (e < eSolidMax) {
    id = solidId;
    temp = e / c;
  } else if (lf > 0u && e < eFusionEnd) {
    id = solidId;
    temp = tm;
  } else if (e < eLiquidMax) {
    id = liquidId;
    temp = (e - lf) / c;
  } else if (lv > 0u && e < eVaporEnd) {
    id = liquidId;
    temp = tb;
  } else {
    id = gasId;
    uint base = lf + lv;
    temp = (e > base) ? ((e - base) / c) : 0u;
  }

  s.r = id;
  s.g = temp > 255u ? 255u : temp;
}

void ensureTempMin(inout uint e, uint id, uint tMin) {
  uint eMin = energyForTemp(id, tMin);
  if (e < eMin) e = eMin;
}

void clampTempMax(inout uint e, uint id, uint tMax) {
  uint eMax = energyForTemp(id, tMax);
  if (e > eMax) e = eMax;
}

void addHeat(inout uint e, uint id, uint dT) {
  uint dE = dT * heatCapacity(id);
  e = min(65535u, e + dE);
}

void removeHeat(inout uint e, uint id, uint dT) {
  uint dE = dT * heatCapacity(id);
  e = e > dE ? (e - dE) : 0u;
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

// Agent meta layout (state.a):
// - bits 0..1: dir (0=right,1=up,2=left,3=down)
// - bit 2: drill (0=normal, 1=drill through anything)
// - bit 3: movedParity (u_tick&1 of last move)
// - bit 4: hand (0=prefer clockwise turns, 1=prefer counter-clockwise turns)
// - bits 5..6: cooldown (0..3)
// - bit 7: version marker (always 1 for the current layout)
uint packBotMeta(uint dir, uint drill, uint movedParity, uint hand, uint cd) {
  return 128u | (dir & 3u) | ((drill & 1u) << 2u) | ((movedParity & 1u) << 3u) | ((hand & 1u) << 4u) | ((cd & 3u) << 5u);
}

uint botDir(uint meta) { return meta & 3u; }
uint botDrill(uint meta) { return (meta >> 2u) & 1u; }
uint botMovedParity(uint meta) { return (meta >> 3u) & 1u; }
uint botHand(uint meta) { return (meta >> 4u) & 1u; }
uint botCd(uint meta) { return (meta >> 5u) & 3u; }

ivec2 botDirVec(uint dir) {
  if (dir == 0u) return ivec2(1, 0);
  if (dir == 1u) return ivec2(0, 1);
  if (dir == 2u) return ivec2(-1, 0);
  return ivec2(0, -1);
}

bool botPassable(uint id) {
  if (id == P_EMPTY) return true;
  uint f = loadProps(id).b;
  return hasFlag(f, FLAG_GAS) || hasFlag(f, FLAG_ENERGY);
}

bool botCanMove(ivec2 c, uint dir) {
  ivec2 n = c + botDirVec(dir);
  if (!inBounds(n)) return false;
  return botPassable(loadState(n).r);
}

void agentPaintCell(uint paintId, out uint id, out uint temp, out uint data, out uint meta, out uint e) {
  id = paintId;
  temp = u_ambientTemp;
  data = 0u;
  meta = 0u;

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
  else if (id == P_BOT) { meta = 136u; }
  else if (id == P_GLIDER) { meta = 136u; }

  e = energyForTemp(id, temp);
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
  if (plantId != P_PLANT) return;

  bool tgtIsAir = (tgtId == P_EMPTY);
  bool tgtIsSoil = (tgtId == P_DIRT) || (tgtId == P_MUD);
  if (!(tgtIsAir || tgtIsSoil)) return;

  uint dir = plantMeta & 7u;
  uint gene = (plantMeta >> 3u) & 7u;
  uint cd = (plantMeta >> 6u) & 3u;

  if (cd != 0u) return;
  uint minEnergy = tgtIsSoil ? 160u : 130u;
  if (plantData < minEnergy) return;
  if (plantTemp > 220u) return;
  if (tgtTemp > 220u) return;

  ivec2 tgtC = plantC + delta;
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

  // Don't grow upward into soil.
  if (tgtIsSoil && (dIdx == 0 || dIdx == 1 || dIdx == 7)) return;

  // Nearby context makes growth feel more organic.
  uint plantNeighbors = 0u;
  bool exposed = false;
  bool nearWater = false;

  ivec2 n;

  n = plantC + ivec2(1, 0);
  if (inBounds(n)) {
    uint nid = loadState(n).r;
    uint nf = loadProps(nid).b;
    if (nid == P_PLANT) plantNeighbors += 1u;
    if (nid == P_EMPTY || hasFlag(nf, FLAG_GAS) || hasFlag(nf, FLAG_ENERGY)) exposed = true;
    if (nid == P_WATER || nid == P_BRINE || nid == P_MUD) nearWater = true;
  }
  n = plantC + ivec2(-1, 0);
  if (inBounds(n)) {
    uint nid = loadState(n).r;
    uint nf = loadProps(nid).b;
    if (nid == P_PLANT) plantNeighbors += 1u;
    if (nid == P_EMPTY || hasFlag(nf, FLAG_GAS) || hasFlag(nf, FLAG_ENERGY)) exposed = true;
    if (nid == P_WATER || nid == P_BRINE || nid == P_MUD) nearWater = true;
  }
  n = plantC + ivec2(0, 1);
  if (inBounds(n)) {
    uint nid = loadState(n).r;
    uint nf = loadProps(nid).b;
    if (nid == P_PLANT) plantNeighbors += 1u;
    if (nid == P_EMPTY || hasFlag(nf, FLAG_GAS) || hasFlag(nf, FLAG_ENERGY)) exposed = true;
    if (nid == P_WATER || nid == P_BRINE || nid == P_MUD) nearWater = true;
  }
  n = plantC + ivec2(0, -1);
  if (inBounds(n)) {
    uint nid = loadState(n).r;
    uint nf = loadProps(nid).b;
    if (nid == P_PLANT) plantNeighbors += 1u;
    if (nid == P_EMPTY || hasFlag(nf, FLAG_GAS) || hasFlag(nf, FLAG_ENERGY)) exposed = true;
    if (nid == P_WATER || nid == P_BRINE || nid == P_MUD) nearWater = true;
  }

  // Diagonals only influence the "tip" metric.
  n = plantC + ivec2(1, 1); if (inBounds(n) && loadState(n).r == P_PLANT) plantNeighbors += 1u;
  n = plantC + ivec2(-1, 1); if (inBounds(n) && loadState(n).r == P_PLANT) plantNeighbors += 1u;
  n = plantC + ivec2(1, -1); if (inBounds(n) && loadState(n).r == P_PLANT) plantNeighbors += 1u;
  n = plantC + ivec2(-1, -1); if (inBounds(n) && loadState(n).r == P_PLANT) plantNeighbors += 1u;

  // Tips branch more aggressively; dense clusters slow down.
  if (plantNeighbors <= 1u) chance += 18u;
  else if (plantNeighbors == 2u) chance += 8u;
  else if (plantNeighbors >= 5u) chance = chance > 10u ? (chance - 10u) : 0u;

  // Light/exposure biases shoots up; buried plant biases roots.
  if (exposed) {
    if (delta.y > 0) chance += 14u;
    else if (delta.y == 0) chance += 4u;
  } else {
    if (tgtIsSoil || delta.y < 0) chance += 10u;
    else chance = (chance * 3u) >> 2;
  }

  // Water nearby makes all growth more likely; without it, shoots are timid.
  if (nearWater) chance += 6u;
  else if (delta.y > 0 && plantData < (minEnergy + 64u)) chance = (chance * 3u) >> 2;

  // Air growth is where most "branching" is visible, so bias toward it a bit.
  if (tgtIsAir) {
    chance += 8u;
    if (delta.y > 0) chance += (delta.x == 0 ? 8u : 14u);
    else if (delta.y == 0) chance += 14u;
  }

  // Air growth prefers to attach to something instead of floating.
  if (tgtIsAir) {
    bool supported = false;
    ivec2 below = tgtC + ivec2(0, -1);
    if (inBounds(below)) {
      uint bid = loadState(below).r;
      uint bf = loadProps(bid).b;
      supported = (bid != P_EMPTY) && !hasFlag(bf, FLAG_GAS) && !hasFlag(bf, FLAG_ENERGY);
    }
    if (!supported && delta.y == 0) chance = (chance * 7u) >> 3;
  }

  // Soil colonization is rarer unless it's wet.
  if (tgtIsSoil) {
    chance = (chance * 3u) >> 2;
    if (tgtId == P_MUD) chance += 10u;
    bool waterAdj = false;
    n = tgtC + ivec2(1, 0); if (!waterAdj && inBounds(n)) { uint nid = loadState(n).r; waterAdj = (nid == P_WATER) || (nid == P_BRINE) || (nid == P_MUD); }
    n = tgtC + ivec2(-1, 0); if (!waterAdj && inBounds(n)) { uint nid = loadState(n).r; waterAdj = (nid == P_WATER) || (nid == P_BRINE) || (nid == P_MUD); }
    n = tgtC + ivec2(0, 1); if (!waterAdj && inBounds(n)) { uint nid = loadState(n).r; waterAdj = (nid == P_WATER) || (nid == P_BRINE) || (nid == P_MUD); }
    n = tgtC + ivec2(0, -1); if (!waterAdj && inBounds(n)) { uint nid = loadState(n).r; waterAdj = (nid == P_WATER) || (nid == P_BRINE) || (nid == P_MUD); }
    if (waterAdj) chance += 10u;
  }

  chance += (plantData - minEnergy) >> 4; // 0..~7
  chance = min(chance, 140u);

  uint r = randByte(uvec2(plantC), salt);
  if (r >= chance) return;

  uint give = 36u + gene * 7u;
  if (tgtIsSoil) give += 18u;
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
  tgtData = tgtIsSoil ? ((give * 3u) >> 2) : give;
  tgtMeta = packPlantMeta(uint(childDir), childGene, 2u);
}

uvec4 setId(uvec4 s, uint id) {
  s.r = id;
  return s;
}

void selfUpdate(ivec2 c, inout uvec4 s, inout uint e, uint salt) {
  uint id = s.r;
  uint data = s.b;
  uint meta = s.a;

  uvec4 p = loadProps(id);
  uint pf = p.b;

  // Type-specific updates (temperature is derived from energy).
  if (id == P_FIRE) {
    uint eMin = energyForTemp(P_FIRE, T_FIRE);
    if (e < eMin) e = eMin;

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
      uint eMax = energyForTemp(P_SMOKE, 180u);
      if (e > eMax) e = eMax;
      data = 140u;
      meta = 0u;
    }
  } else if (id == P_SMOKE) {
    if (data > 0u) data -= 1u;
    if (data == 0u) {
      id = P_EMPTY;
      e = energyForTemp(P_EMPTY, u_ambientTemp);
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

    uint temp = tempFromEnergy(P_LAVA, e);
    if (exposed) {
      // Extra surface cooling to make lava spread before crusting.
      int d2 = int(temp) - int(u_ambientTemp);
      if (d2 > 0) {
        uint lossT = uint(1 + (d2 / 48)); // 1..3
        uint lossE = lossT * heatCapacity(P_LAVA);
        e = e > lossE ? (e - lossE) : 0u;
        temp = tempFromEnergy(P_LAVA, e);
      }

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
    uint temp = tempFromEnergy(P_MUD, e);
    if (temp >= T_MUD_DRY && data > 0u) {
      uint r = randByte(uvec2(c), salt);
      uint loss = 1u + (r < 64u ? 2u : 0u);
      data = data > loss ? (data - loss) : 0u;
    }
    if (data == 0u && temp >= T_MUD_DRY) {
      id = P_DIRT;
    }
  } else if (id == P_PLANT) {
    // Plant has a tiny lifecycle: consumes energy when stressed, gains a bit when exposed,
    // and can die back into dirt/air when starved.
    uint dir = meta & 7u;
    uint gene = (meta >> 3u) & 7u;
    uint cd = (meta >> 6u) & 3u;
    if (cd > 0u) cd -= 1u;

    uint temp = tempFromEnergy(P_PLANT, e);

    bool exposed = false;
    bool nearWater = false;
    bool nearSoil = false;
    ivec2 n;

    n = c + ivec2(1, 0);
    if (inBounds(n)) {
      uint nid = loadState(n).r;
      uint nf = loadProps(nid).b;
      if (nid == P_EMPTY || hasFlag(nf, FLAG_GAS) || hasFlag(nf, FLAG_ENERGY)) exposed = true;
      if (nid == P_WATER || nid == P_BRINE || nid == P_MUD) nearWater = true;
      if (nid == P_DIRT || nid == P_MUD) nearSoil = true;
    }
    n = c + ivec2(-1, 0);
    if (inBounds(n)) {
      uint nid = loadState(n).r;
      uint nf = loadProps(nid).b;
      if (nid == P_EMPTY || hasFlag(nf, FLAG_GAS) || hasFlag(nf, FLAG_ENERGY)) exposed = true;
      if (nid == P_WATER || nid == P_BRINE || nid == P_MUD) nearWater = true;
      if (nid == P_DIRT || nid == P_MUD) nearSoil = true;
    }
    n = c + ivec2(0, 1);
    if (inBounds(n)) {
      uint nid = loadState(n).r;
      uint nf = loadProps(nid).b;
      if (nid == P_EMPTY || hasFlag(nf, FLAG_GAS) || hasFlag(nf, FLAG_ENERGY)) exposed = true;
      if (nid == P_WATER || nid == P_BRINE || nid == P_MUD) nearWater = true;
      if (nid == P_DIRT || nid == P_MUD) nearSoil = true;
    }
    n = c + ivec2(0, -1);
    if (inBounds(n)) {
      uint nid = loadState(n).r;
      uint nf = loadProps(nid).b;
      if (nid == P_EMPTY || hasFlag(nf, FLAG_GAS) || hasFlag(nf, FLAG_ENERGY)) exposed = true;
      if (nid == P_WATER || nid == P_BRINE || nid == P_MUD) nearWater = true;
      if (nid == P_DIRT || nid == P_MUD) nearSoil = true;
    }

    // Baseline metabolism: costs more when cold/hot or dehydrated.
    uint cost = 1u;
    if (temp < 100u || temp > 205u) cost += 1u;
    if (!nearWater) cost += 1u;
    if (data > 0u) data = data > cost ? (data - cost) : 0u;

    // Photosynthesis: small steady gain when exposed and in a comfortable temp range.
    if (exposed && temp > 110u && temp < 190u) {
      uint gain = 1u + (gene >> 2u);
      if (nearWater) gain += 1u;
      if (data < 240u) data = min(255u, data + gain);
    }

    // Slowly re-orient growth direction based on environment.
    if (cd == 0u) {
      uint r = randByte(uvec2(c), salt + 41u);
      if (exposed) {
        if (r < 28u) dir = (r < 16u) ? 0u : ((r < 22u) ? 1u : 7u); // up-biased
      } else if (nearSoil || nearWater) {
        if (r < 28u) dir = (r < 16u) ? 4u : ((r < 22u) ? 3u : 5u); // down-biased
      } else {
        if (r < 8u) dir = r & 7u;
      }
    }

    bool alive = true;
    if (data == 0u && !nearWater) {
      uint r = randByte(uvec2(c), salt + 77u);
      uint chance = exposed ? 10u : 4u;
      if (temp < 90u || temp > 210u) chance += 10u;
      if (r < chance) {
        ivec2 below = c + ivec2(0, -1);
        bool supported = false;
        if (inBounds(below)) {
          uint bid = loadState(below).r;
          uint bf = loadProps(bid).b;
          supported = (bid != P_EMPTY) && !hasFlag(bf, FLAG_GAS) && !hasFlag(bf, FLAG_ENERGY);
        }
        if (supported) {
          id = P_DIRT;
          e = energyForTemp(P_DIRT, temp);
        } else {
          id = P_EMPTY;
          e = energyForTemp(P_EMPTY, u_ambientTemp);
        }
        meta = 0u;
        alive = false;
      }
    }

    if (alive) meta = packPlantMeta(dir, gene, cd);
  } else if (id == P_BOT) {
    uint dir = 0u;
    uint drill = 0u;
    uint movedParity = 0u;
    uint hand = 0u;
    uint cd = 0u;

    if ((meta & 128u) == 0u) {
      // Legacy bot meta:
      // bit0 dir (0=right,1=left), bit2 lastMoveTickParity, bits3..4 cooldown.
      uint oldDir = meta & 1u;
      movedParity = (meta >> 2u) & 1u;
      cd = (meta >> 3u) & 3u;
      dir = (oldDir == 0u) ? 0u : 2u;
      hand = 0u;
      drill = 0u;
    } else {
      dir = botDir(meta);
      drill = botDrill(meta);
      movedParity = botMovedParity(meta);
      hand = botHand(meta);
      cd = botCd(meta);
    }
    if (cd > 0u) cd -= 1u;

    bool blocked = (drill == 0u) && !botCanMove(c, dir);
    if (blocked && cd == 0u) {
      uint cw = (dir + 3u) & 3u;
      uint ccw = (dir + 1u) & 3u;
      uint pref = (hand == 0u) ? cw : ccw;
      uint alt = (hand == 0u) ? ccw : cw;
      uint back = dir ^ 2u;

      if (botCanMove(c, pref)) dir = pref;
      else if (botCanMove(c, alt)) dir = alt;
      else dir = back;

      cd = 2u;
    }

    meta = packBotMeta(dir, drill, movedParity, hand, cd);
  } else if (id == P_ACID) {
    // Acid slowly loses strength.
    if (data > 0u && (randByte(uvec2(c), salt) < 6u)) data -= 1u;
    if (data == 0u) {
      id = P_EMPTY;
      e = energyForTemp(P_EMPTY, u_ambientTemp);
    }
  } else if (id == P_SPARK) {
    if (data > 0u) data -= 1u;
    if (data == 0u) {
      id = P_EMPTY;
      e = energyForTemp(P_EMPTY, u_ambientTemp);
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
      data = 0u;
      meta = 0u;
      e = energyForTemp(P_EMPTY, u_ambientTemp);
    }
  }

  s.r = id;
  s.b = data;
  s.a = meta;
  s.g = tempFromEnergy(id, e);
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
    outEnergy = loadEnergy(c);
    return;
  }

  uvec4 a = loadState(aC);
  uvec4 b = loadState(bC);
  uint aE = unpackEnergy(loadEnergy(aC));
  uint bE = unpackEnergy(loadEnergy(bC));

  if (u_selfStep != 0) {
    selfUpdate(aC, a, aE, 11u + u_passSalt);
    selfUpdate(bC, b, bE, 29u + u_passSalt);
  }

  uint aId = a.r;
  uint bId = b.r;
  uint aTemp = tempFromEnergy(aId, aE);
  uint bTemp = tempFromEnergy(bId, bE);
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
    int transfer = diff / 10;
    if (transfer != 0) {
      aData = clampU8(int(aData) - transfer);
      bData = clampU8(int(bData) + transfer);
    }
  }

  if (aId == P_PLANT && bId == P_WATER) {
    aData = min(255u, aData + 14u);
  } else if (bId == P_PLANT && aId == P_WATER) {
    bData = min(255u, bData + 14u);
  } else if (aId == P_PLANT && bId == P_MUD) {
    aData = min(255u, aData + 8u);
  } else if (bId == P_PLANT && aId == P_MUD) {
    bData = min(255u, bData + 8u);
  } else if (aId == P_PLANT && bId == P_DIRT) {
    aData = min(160u, aData + 1u);
  } else if (bId == P_PLANT && aId == P_DIRT) {
    bData = min(160u, bData + 1u);
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
    aE = energyForTemp(P_EMPTY, u_ambientTemp);
    aTemp = u_ambientTemp;
    bId = P_BRINE;
    bData = bData > 120u ? bData : 120u;
  } else if (bId == P_SALT && aId == P_WATER) {
    bId = P_EMPTY;
    bE = energyForTemp(P_EMPTY, u_ambientTemp);
    bTemp = u_ambientTemp;
    aId = P_BRINE;
    aData = aData > 120u ? aData : 120u;
  } else if (aId == P_SALT && bId == P_BRINE) {
    if (bData < 250u) {
      aId = P_EMPTY;
      aE = energyForTemp(P_EMPTY, u_ambientTemp);
      aTemp = u_ambientTemp;
      bData = min(255u, bData + 40u);
    }
  } else if (bId == P_SALT && aId == P_BRINE) {
    if (aData < 250u) {
      bId = P_EMPTY;
      bE = energyForTemp(P_EMPTY, u_ambientTemp);
      bTemp = u_ambientTemp;
      aData = min(255u, aData + 40u);
    }
  }

  // Lava ignites flammables on contact.
  if (aId == P_LAVA && hasFlag(bF, FLAG_FLAMMABLE)) {
    uint r = randByte(uvec2(aC), 77u + u_passSalt);
    if (r < 64u) {
      bId = P_FIRE;
      ensureTempMin(bE, P_FIRE, T_FIRE);
      bTemp = tempFromEnergy(P_FIRE, bE);
      bData = 70u;
      bMeta = 10u;
    }
  } else if (bId == P_LAVA && hasFlag(aF, FLAG_FLAMMABLE)) {
    uint r = randByte(uvec2(aC), 79u + u_passSalt);
    if (r < 64u) {
      aId = P_FIRE;
      ensureTempMin(aE, P_FIRE, T_FIRE);
      aTemp = tempFromEnergy(P_FIRE, aE);
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
      clampTempMax(aE, P_SMOKE, 185u);
      aTemp = tempFromEnergy(P_SMOKE, aE);
      aData = 90u;
      addHeat(bE, bId, 48u);
      bTemp = tempFromEnergy(bId, bE);
    } else if (bId == P_FIRE && (aId == P_WATER || aId == P_BRINE)) {
      bId = P_SMOKE;
      clampTempMax(bE, P_SMOKE, 185u);
      bTemp = tempFromEnergy(P_SMOKE, bE);
      bData = 90u;
      addHeat(aE, aId, 48u);
      aTemp = tempFromEnergy(aId, aE);
    }

    // Fire + ice: melt + quench.
    if (aId == P_FIRE && bId == P_ICE) {
      aId = P_SMOKE;
      clampTempMax(aE, P_SMOKE, 185u);
      aTemp = tempFromEnergy(P_SMOKE, aE);
      aData = 90u;
      addHeat(bE, bId, 70u);
      bTemp = tempFromEnergy(bId, bE);
    } else if (bId == P_FIRE && aId == P_ICE) {
      bId = P_SMOKE;
      clampTempMax(bE, P_SMOKE, 185u);
      bTemp = tempFromEnergy(P_SMOKE, bE);
      bData = 90u;
      addHeat(aE, aId, 70u);
      aTemp = tempFromEnergy(aId, aE);
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
        ensureTempMin(bE, P_FIRE, T_FIRE);
        bTemp = tempFromEnergy(P_FIRE, bE);
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
        ensureTempMin(aE, P_FIRE, T_FIRE);
        aTemp = tempFromEnergy(P_FIRE, aE);
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
          bE = energyForTemp(P_EMPTY, u_ambientTemp);
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
          aE = energyForTemp(P_EMPTY, u_ambientTemp);
          aTemp = u_ambientTemp;
          uint cost = hasFlag(aF, FLAG_DISSOLVABLE) ? 10u : 5u;
          bData = bData > cost ? (bData - cost) : 0u;
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
      bE = energyForTemp(P_EMPTY, u_ambientTemp);
      bTemp = u_ambientTemp;
      bData = 0u;
      bMeta = 0u;
      aMeta = max(aMeta, 2u);
    } else if (bId == P_WIRE && aId == P_SPARK) {
      bData = min(255u, bData + 120u);
      aId = P_EMPTY;
      aE = energyForTemp(P_EMPTY, u_ambientTemp);
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
        uint t = aTemp > T_FIRE ? aTemp : T_FIRE;
        bE = energyForTemp(P_SPARK, t);
        bTemp = tempFromEnergy(P_SPARK, bE);
        bData = 18u;
        bMeta = 0u;
        aData = aData > 50u ? (aData - 50u) : 0u;
        aMeta = 10u;
      }
    } else if (orth && bId == P_WIRE && aId == P_EMPTY && bData >= 180u && bMeta == 0u) {
      uint chance = 6u + ((bData - 180u) >> 3); // 6..~15
      if (rB < chance) {
        aId = P_SPARK;
        uint t = bTemp > T_FIRE ? bTemp : T_FIRE;
        aE = energyForTemp(P_SPARK, t);
        aTemp = tempFromEnergy(P_SPARK, aE);
        aData = 18u;
        aMeta = 0u;
        bData = bData > 50u ? (bData - 50u) : 0u;
        bMeta = 10u;
      }
    }

    // Charged wire heats nearby water/brine (simple shock heating).
    if (orth && aId == P_WIRE && (bId == P_WATER || bId == P_BRINE) && aData >= 120u) {
      uint heat = 6u + (aData >> 5u); // 6..13
      addHeat(bE, bId, heat);
      bTemp = tempFromEnergy(bId, bE);
      aData = aData > 8u ? (aData - 8u) : 0u;
    } else if (orth && bId == P_WIRE && (aId == P_WATER || aId == P_BRINE) && bData >= 120u) {
      uint heat = 6u + (bData >> 5u); // 6..13
      addHeat(aE, aId, heat);
      aTemp = tempFromEnergy(aId, aE);
      bData = bData > 8u ? (bData - 8u) : 0u;
    }

    // Wire can ignite flammables when highly charged.
    if (aId == P_WIRE && hasFlag(bF, FLAG_FLAMMABLE) && aData >= 210u) {
      uint chance = 12u + ((aData - 210u) >> 2); // 12..23
      if (rA < chance) {
        bId = P_FIRE;
        ensureTempMin(bE, P_FIRE, T_FIRE);
        bTemp = tempFromEnergy(P_FIRE, bE);
        bData = 70u;
        bMeta = 10u;
        aData = aData > 80u ? (aData - 80u) : 0u;
        aMeta = 12u;
      }
    } else if (bId == P_WIRE && hasFlag(aF, FLAG_FLAMMABLE) && bData >= 210u) {
      uint chance = 12u + ((bData - 210u) >> 2); // 12..23
      if (rB < chance) {
        aId = P_FIRE;
        ensureTempMin(aE, P_FIRE, T_FIRE);
        aTemp = tempFromEnergy(P_FIRE, aE);
        aData = 70u;
        aMeta = 10u;
        bData = bData > 80u ? (bData - 80u) : 0u;
        bMeta = 12u;
      }
    }

    // Spark fizzles in liquids/ice and can ignite flammables.
    if (aId == P_SPARK && (bId == P_WATER || bId == P_BRINE)) {
      aId = P_EMPTY;
      aE = energyForTemp(P_EMPTY, u_ambientTemp);
      aTemp = u_ambientTemp;
      aData = 0u;
      aMeta = 0u;
      addHeat(bE, bId, 24u);
      bTemp = tempFromEnergy(bId, bE);
    } else if (bId == P_SPARK && (aId == P_WATER || aId == P_BRINE)) {
      bId = P_EMPTY;
      bE = energyForTemp(P_EMPTY, u_ambientTemp);
      bTemp = u_ambientTemp;
      bData = 0u;
      bMeta = 0u;
      addHeat(aE, aId, 24u);
      aTemp = tempFromEnergy(aId, aE);
    } else if (aId == P_SPARK && bId == P_ICE) {
      aId = P_EMPTY;
      aE = energyForTemp(P_EMPTY, u_ambientTemp);
      aTemp = u_ambientTemp;
      aData = 0u;
      aMeta = 0u;
      addHeat(bE, bId, 32u);
      bTemp = tempFromEnergy(bId, bE);
    } else if (bId == P_SPARK && aId == P_ICE) {
      bId = P_EMPTY;
      bE = energyForTemp(P_EMPTY, u_ambientTemp);
      bTemp = u_ambientTemp;
      bData = 0u;
      bMeta = 0u;
      addHeat(aE, aId, 32u);
      aTemp = tempFromEnergy(aId, aE);
    } else if (aId == P_SPARK && hasFlag(bF, FLAG_FLAMMABLE)) {
      if (rA < 90u) {
        bId = P_FIRE;
        ensureTempMin(bE, P_FIRE, T_FIRE);
        bTemp = tempFromEnergy(P_FIRE, bE);
        bData = 70u;
        bMeta = 10u;
        aId = P_EMPTY;
        aE = energyForTemp(P_EMPTY, u_ambientTemp);
        aTemp = u_ambientTemp;
        aData = 0u;
        aMeta = 0u;
      }
    } else if (bId == P_SPARK && hasFlag(aF, FLAG_FLAMMABLE)) {
      if (rB < 90u) {
        aId = P_FIRE;
        ensureTempMin(aE, P_FIRE, T_FIRE);
        aTemp = tempFromEnergy(P_FIRE, aE);
        aData = 70u;
        aMeta = 10u;
        bId = P_EMPTY;
        bE = energyForTemp(P_EMPTY, u_ambientTemp);
        bTemp = u_ambientTemp;
        bData = 0u;
        bMeta = 0u;
      }
    }
  }

  // Plant grows with directional branching (metadata-driven).
  if (aId == P_PLANT && (bId == P_EMPTY || bId == P_DIRT || bId == P_MUD)) {
    uint prev = bId;
    tryPlantGrow(aC, u_dir, aId, aTemp, aData, aMeta, bId, bTemp, bData, bMeta, 201u + u_passSalt);
    if (prev != bId) bE = energyForTemp(bId, bTemp);
  } else if (bId == P_PLANT && (aId == P_EMPTY || aId == P_DIRT || aId == P_MUD)) {
    uint prev = aId;
    tryPlantGrow(bC, -u_dir, bId, bTemp, bData, bMeta, aId, aTemp, aData, aMeta, 203u + u_passSalt);
    if (prev != aId) aE = energyForTemp(aId, aTemp);
  }

  // Bot: a single-cell agent that moves along its heading and paints a trail via state.b (paint id).
  // Moves at most once per tick using movedParity.
  uint tickParity = u_tick & 1u;
  if (u_dir.y == 0 && u_dir.x != 0) {
    // Horizontal pass: aC is left of bC.
    if (aId == P_BOT && botDir(aMeta) == 0u && botMovedParity(aMeta) != tickParity && (botPassable(bId) || (botDrill(aMeta) != 0u))) {
      uint paintId = aData;
      uint hand = botHand(aMeta);
      uint cd = botCd(aMeta);
      bId = P_BOT;
      bData = aData;
      bMeta = packBotMeta(0u, botDrill(aMeta), tickParity, hand, cd);
      bE = aE;
      bTemp = aTemp;
      agentPaintCell(paintId, aId, aTemp, aData, aMeta, aE);
    } else if (bId == P_BOT && botDir(bMeta) == 2u && botMovedParity(bMeta) != tickParity && (botPassable(aId) || (botDrill(bMeta) != 0u))) {
      uint paintId = bData;
      uint hand = botHand(bMeta);
      uint cd = botCd(bMeta);
      aId = P_BOT;
      aData = bData;
      aMeta = packBotMeta(2u, botDrill(bMeta), tickParity, hand, cd);
      aE = bE;
      aTemp = bTemp;
      agentPaintCell(paintId, bId, bTemp, bData, bMeta, bE);
    }
  } else if (u_dir.x == 0 && u_dir.y != 0) {
    // Vertical pass (down pairs): aC is above bC (u_dir = (0,-1)).
    if (aId == P_BOT && botDir(aMeta) == 3u && botMovedParity(aMeta) != tickParity && (botPassable(bId) || (botDrill(aMeta) != 0u))) {
      uint paintId = aData;
      uint hand = botHand(aMeta);
      uint cd = botCd(aMeta);
      bId = P_BOT;
      bData = aData;
      bMeta = packBotMeta(3u, botDrill(aMeta), tickParity, hand, cd);
      bE = aE;
      bTemp = aTemp;
      agentPaintCell(paintId, aId, aTemp, aData, aMeta, aE);
    } else if (bId == P_BOT && botDir(bMeta) == 1u && botMovedParity(bMeta) != tickParity && (botPassable(aId) || (botDrill(bMeta) != 0u))) {
      uint paintId = bData;
      uint hand = botHand(bMeta);
      uint cd = botCd(bMeta);
      aId = P_BOT;
      aData = bData;
      aMeta = packBotMeta(1u, botDrill(bMeta), tickParity, hand, cd);
      aE = bE;
      aTemp = bTemp;
      agentPaintCell(paintId, bId, bTemp, bData, bMeta, bE);
    }
  }

  // Glider: a straight-line single-cell agent that can paint a trail via state.b (paint id).
  if (u_dir.y == 0 && u_dir.x != 0) {
    // Horizontal pass: aC is left of bC.
    if (aId == P_GLIDER && botDir(aMeta) == 0u && botMovedParity(aMeta) != tickParity && (botPassable(bId) || (botDrill(aMeta) != 0u))) {
      uint paintId = aData;
      uint hand = botHand(aMeta);
      uint cd = botCd(aMeta);
      bId = P_GLIDER;
      bData = aData;
      bMeta = packBotMeta(0u, botDrill(aMeta), tickParity, hand, cd);
      bE = aE;
      bTemp = aTemp;
      agentPaintCell(paintId, aId, aTemp, aData, aMeta, aE);
    } else if (bId == P_GLIDER && botDir(bMeta) == 2u && botMovedParity(bMeta) != tickParity && (botPassable(aId) || (botDrill(bMeta) != 0u))) {
      uint paintId = bData;
      uint hand = botHand(bMeta);
      uint cd = botCd(bMeta);
      aId = P_GLIDER;
      aData = bData;
      aMeta = packBotMeta(2u, botDrill(bMeta), tickParity, hand, cd);
      aE = bE;
      aTemp = bTemp;
      agentPaintCell(paintId, bId, bTemp, bData, bMeta, bE);
    }
  } else if (u_dir.x == 0 && u_dir.y != 0) {
    // Vertical pass (down pairs): aC is above bC (u_dir = (0,-1)).
    if (aId == P_GLIDER && botDir(aMeta) == 3u && botMovedParity(aMeta) != tickParity && (botPassable(bId) || (botDrill(aMeta) != 0u))) {
      uint paintId = aData;
      uint hand = botHand(aMeta);
      uint cd = botCd(aMeta);
      bId = P_GLIDER;
      bData = aData;
      bMeta = packBotMeta(3u, botDrill(aMeta), tickParity, hand, cd);
      bE = aE;
      bTemp = aTemp;
      agentPaintCell(paintId, aId, aTemp, aData, aMeta, aE);
    } else if (bId == P_GLIDER && botDir(bMeta) == 1u && botMovedParity(bMeta) != tickParity && (botPassable(aId) || (botDrill(bMeta) != 0u))) {
      uint paintId = bData;
      uint hand = botHand(bMeta);
      uint cd = botCd(bMeta);
      aId = P_GLIDER;
      aData = bData;
      aMeta = packBotMeta(1u, botDrill(bMeta), tickParity, hand, cd);
      aE = bE;
      aTemp = bTemp;
      agentPaintCell(paintId, bId, bTemp, bData, bMeta, bE);
    }
  }

  // Apply the updated ids/data back.
  a.r = aId;
  b.r = bId;
  a.b = aData;
  b.b = bData;
  a.a = aMeta;
  b.a = bMeta;
  a.g = tempFromEnergy(aId, aE);
  b.g = tempFromEnergy(bId, bE);

  // Phase changes are energy-driven and happen after chemistry edits.
  applyPhase(a, aE);
  applyPhase(b, bE);
  aId = a.r;
  bId = b.r;
  aTemp = a.g;
  bTemp = b.g;

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
              uint tmpE = aE;
              aE = bE;
              bE = tmpE;
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
              uint tmpE = aE;
              aE = bE;
              bE = tmpE;
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
              uint tmpE = aE;
              aE = bE;
              bE = tmpE;
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
              uint tmpE = aE;
              aE = bE;
              bE = tmpE;
            }
          } else if (bId == P_EMPTY && !aPowder && isFluid(aF) && aId != P_EMPTY && !(aId == P_FIRE && aMeta != 0u)) {
            uint r = randByte(uvec2(aC), 93u + u_passSalt);
            if (r < (aP.a >> 1)) {
              uvec4 tmp = a;
              a = b;
              b = tmp;
              uint tmpE = aE;
              aE = bE;
              bE = tmpE;
            }
          }
        }
      }
    }
  }

  outState = aIsHere ? a : b;
  outEnergy = aIsHere ? packEnergy(aE) : packEnergy(bE);
}
`;

export const PAINT_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform usampler2D u_energy;
uniform usampler2D u_thermal0;
uniform usampler2D u_thermal1;
uniform usampler2D u_latent;
uniform ivec2 u_size;
uniform ivec2 u_center;
uniform int u_radius;
uniform uvec4 u_paint;
uniform uint u_seed;
uniform uint u_tick;
uniform int u_addMode;

layout(location = 0) out uvec4 outState;
layout(location = 1) out uvec4 outEnergy;

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
    outEnergy = uvec4(0u);
    return;
  }
  uvec4 cur = texelFetch(u_state, c, 0);
  uvec4 curE = texelFetch(u_energy, c, 0);

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
        } else if ((curId == P_BOT || curId == P_GLIDER) && (s.r != P_BOT && s.r != P_GLIDER)) {
          // Configure an agent:
          // - Add-mode + Spark toggles drill mode.
          // - Add-mode + any other particle sets the paint target id (state.b).
          uint m = cur.a;
          uint dir = 0u;
          uint drill = 0u;
          uint movedParity = 0u;
          uint hand = 0u;
          uint cd = 0u;
          uint paintId = cur.b;

          if ((m & 128u) == 0u) {
            // Legacy meta:
            // bit0 dir (0=right,1=left), bit2 lastMoveTickParity, bits3..4 cooldown.
            uint oldDir = m & 1u;
            movedParity = (m >> 2u) & 1u;
            cd = (m >> 3u) & 3u;
            dir = (oldDir == 0u) ? 0u : 2u;
            hand = 0u;
            drill = 0u;
          } else {
            dir = m & 3u;
            drill = (m >> 2u) & 1u;
            movedParity = (m >> 3u) & 1u;
            hand = (m >> 4u) & 1u;
            cd = (m >> 5u) & 3u;
            paintId = cur.b;
          }

          if (s.r == P_SPARK) {
            drill ^= 1u;
          } else {
            paintId = s.r;
          }

          nextCell = cur;
          nextCell.a = 128u | (dir & 3u) | ((drill & 1u) << 2u) | ((movedParity & 1u) << 3u) | ((hand & 1u) << 4u) | ((cd & 3u) << 5u);
          nextCell.b = paintId;
          changed = true;
        }

        if (!changed) {
          outState = cur;
          outEnergy = curE;
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
    outEnergy = packEnergy(energyForTemp(s.r, s.g));
  }
  else {
    outState = cur;
    outEnergy = curE;
  }
}
`;

export const STAMP_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_state;
uniform usampler2D u_energy;
uniform sampler2D u_image;
uniform sampler2D u_palette;
uniform usampler2D u_thermal0;
uniform usampler2D u_thermal1;
uniform usampler2D u_latent;
uniform ivec2 u_size;
uniform ivec2 u_imgSize;
uniform ivec2 u_origin;
uniform uint u_ambientTemp;
uniform int u_edgeStone;
uniform int u_addMode;

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

uvec4 loadState(ivec2 c) {
  return texelFetch(u_state, c, 0);
}

uvec4 loadEnergy(ivec2 c) {
  return texelFetch(u_energy, c, 0);
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
  else if (id == P_BOT) { data = 0u; meta = 136u; }
  else if (id == P_GLIDER) { data = 0u; meta = 136u; }
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
  uvec4 curE = loadEnergy(c);

  // Preserve boundaries (bottom + side walls).
  if (c.x == 0 || c.x == (u_size.x - 1) || c.y == 0) {
    outState = cur;
    outEnergy = curE;
    return;
  }

  ivec2 ic = c - u_origin;
  if (ic.x < 0 || ic.y < 0 || ic.x >= u_imgSize.x || ic.y >= u_imgSize.y) {
    outState = cur;
    outEnergy = curE;
    return;
  }

  vec4 px = texelFetch(u_image, ic, 0);

  // Treat transparency as "no-op" so you can paste over an existing world.
  if (px.a < 0.05) {
    outState = cur;
    outEnergy = curE;
    return;
  }

  float mx = max(max(px.r, px.g), px.b);
  float mn = min(min(px.r, px.g), px.b);
  float sat = (mx - mn) / max(mx, 1e-5);
  float lum = dot(px.rgb, vec3(0.2126, 0.7152, 0.0722));

  // Near-white backgrounds become air (common for pasted images).
  if (lum > 0.97 && sat < 0.08) {
    if (u_addMode != 0) {
      outState = cur;
      outEnergy = curE;
    } else {
      uvec4 s = makeCell(P_EMPTY);
      outState = s;
      outEnergy = packEnergy(energyForTemp(s.r, s.g));
    }
    return;
  }

  // Very dark, low-saturation pixels become stone (useful for outlines).
  if (lum < 0.05 && sat < 0.25) {
    if (u_addMode != 0 && cur.r != P_EMPTY) {
      outState = cur;
      outEnergy = curE;
    } else {
      uvec4 s = makeCell(P_STONE);
      outState = s;
      outEnergy = packEnergy(energyForTemp(s.r, s.g));
    }
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
      if (u_addMode != 0 && cur.r != P_EMPTY) {
        outState = cur;
        outEnergy = curE;
      } else {
        uvec4 s = makeCell(P_STONE);
        outState = s;
        outEnergy = packEnergy(energyForTemp(s.r, s.g));
      }
      return;
    }
  }

  uint id = mapColor(px.rgb);
  if (u_addMode != 0) {
    if (id == P_EMPTY) {
      outState = cur;
      outEnergy = curE;
    } else if (cur.r != P_EMPTY) {
      outState = cur;
      outEnergy = curE;
    } else {
      uvec4 s = makeCell(id);
      outState = s;
      outEnergy = packEnergy(energyForTemp(s.r, s.g));
    }
  } else {
    uvec4 s = makeCell(id);
    outState = s;
    outEnergy = packEnergy(energyForTemp(s.r, s.g));
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
uniform vec2 u_camCenter;
uniform float u_camZoom;

out vec4 outColor;

const uint P_EMPTY = 0u;

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

vec3 shadeMaterial(uint id, uint temp) {
  vec3 base = texelFetch(u_palette, ivec2(int(id), 0), 0).rgb;
  float heat = (float(temp) - float(u_ambientTemp)) / 128.0; // ~[-1..1]
  vec3 warm = vec3(1.0, 0.45, 0.15);
  vec3 cool = vec3(0.25, 0.45, 1.0);
  vec3 shaded = base;
  shaded = mix(shaded, warm, clamp(heat, 0.0, 1.0) * 0.35);
  shaded = mix(shaded, cool, clamp(-heat, 0.0, 1.0) * 0.25);
  return shaded;
}

void main() {
  vec2 uv = (v_uv - vec2(0.5)) / max(u_camZoom, 1e-3) + u_camCenter;
  vec2 p = uv * vec2(u_size);
  vec2 fw = fwidth(p);
  bool minified = max(fw.x, fw.y) > 1.0;

  if (!minified) {
    ivec2 c = ivec2(floor(p));
    c = clamp(c, ivec2(0), u_size - ivec2(1));
    uvec4 s = texelFetch(u_state, c, 0);
    uint id = s.r;
    uint temp = s.g;
    if (u_viewMode == 1) {
      outColor = vec4(temperatureColor(float(temp) / 255.0), 1.0);
    } else {
      outColor = vec4(shadeMaterial(id, temp), 1.0);
    }
    return;
  }

  ivec2 c0 = ivec2(floor(p));
  ivec2 s00 = clamp(c0, ivec2(0), u_size - ivec2(1));
  ivec2 s10 = clamp(c0 + ivec2(1, 0), ivec2(0), u_size - ivec2(1));
  ivec2 s01 = clamp(c0 + ivec2(0, 1), ivec2(0), u_size - ivec2(1));
  ivec2 s11 = clamp(c0 + ivec2(1, 1), ivec2(0), u_size - ivec2(1));

  uvec4 a = texelFetch(u_state, s00, 0);
  uvec4 b = texelFetch(u_state, s10, 0);
  uvec4 c = texelFetch(u_state, s01, 0);
  uvec4 d = texelFetch(u_state, s11, 0);

  if (u_viewMode == 1) {
    float t = (float(a.g) + float(b.g) + float(c.g) + float(d.g)) * 0.25 / 255.0;
    outColor = vec4(temperatureColor(t), 1.0);
    return;
  }

  vec3 sum = vec3(0.0);
  float wsum = 0.0;

  if (a.r != P_EMPTY) {
    sum += shadeMaterial(a.r, a.g);
    wsum += 1.0;
  }
  if (b.r != P_EMPTY) {
    sum += shadeMaterial(b.r, b.g);
    wsum += 1.0;
  }
  if (c.r != P_EMPTY) {
    sum += shadeMaterial(c.r, c.g);
    wsum += 1.0;
  }
  if (d.r != P_EMPTY) {
    sum += shadeMaterial(d.r, d.g);
    wsum += 1.0;
  }

  if (wsum <= 0.0) {
    outColor = vec4(shadeMaterial(P_EMPTY, a.g), 1.0);
  } else {
    outColor = vec4(sum / wsum, 1.0);
  }
}
`;
