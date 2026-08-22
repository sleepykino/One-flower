/**
 * 瓦片地形随机生成（本地算法，无 AI 依赖）
 * - 分形值噪声（fractal value noise）：海拔 + 湿度双通道
 * - 生物群系分类：海拔/湿度/海平面 -> 深海/浅海/沙滩/草原/森林/丘陵/山地/雪原/沙漠
 * - 岛屿模式：距中心径向衰减，让陆地呈大陆/岛屿形态
 * - 聚居点撒点：在适合居住的瓦片上随机放置地点图标（配合 MapNode）
 */

import { TILE_SIZE, iconLabel, type MapTiles } from './types';

/** mulberry32：种子 -> [0,1) 确定性随机 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数格点哈希 -> [0,1)（值噪声插值源，无需预生成梯度表） */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 值噪声：四角双线性插值 + smoothstep 过渡 */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** 分形噪声：多倍频叠加（persistence 越大高频细节越多） */
function fractal(x: number, y: number, seed: number, octaves: number, persistence: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= persistence;
    freq *= 2;
  }
  return sum / norm;
}

/** 生物群系分类：海拔 e / 湿度 m / 海平面 sea -> 地形 id */
function classify(e: number, m: number, sea: number): string {
  if (e < sea - 0.1) return 'deepwater';
  if (e < sea) return 'water';
  if (e < sea + 0.02) return 'sand';
  if (e < sea + 0.16) {
    if (m < 0.3) return 'desert';
    if (m > 0.68) return e > sea + 0.08 ? 'forest' : 'jungle';
    return m > 0.52 ? 'grass' : 'plain';
  }
  if (e < sea + 0.26) return m > 0.55 ? 'pine' : 'hill';
  if (e < sea + 0.36) return 'mountain';
  return 'snow';
}

export interface TerrainGenOptions {
  cols: number;
  rows: number;
  /** 随机种子，缺省随机取 */
  seed?: number;
  /** 海平面 0.25~0.6，越高水域越多（默认 0.42） */
  seaLevel?: number;
  /** 起伏度 0.5~1.5，越大地形越破碎（默认 1） */
  roughness?: number;
  /** 岛屿模式：边缘径向衰减（默认 true） */
  island?: boolean;
  /** 瓦片像素边长（默认 32） */
  tileSize?: number;
}

/** 生成一整层瓦片地形 */
export function generateTerrain(opts: TerrainGenOptions): MapTiles {
  const { cols, rows } = opts;
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const sea = opts.seaLevel ?? 0.42;
  const persistence = 0.45 * (opts.roughness ?? 1);
  const island = opts.island !== false;
  // 基础频率：最长边约 8 个大噪声格，保证一张图内有完整地理结构
  const freq = 8 / Math.max(cols, rows);
  const tiles: MapTiles = { cols, rows, size: opts.tileSize ?? TILE_SIZE, data: new Array<string>(cols * rows).fill('') };
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const maxD = Math.hypot(cx, cy) || 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let e = fractal(x * freq, y * freq, seed, 5, persistence);
      const m = fractal((x + 331) * freq * 0.8, (y + 173) * freq * 0.8, seed + 7777, 3, 0.5);
      if (island) {
        const d = Math.hypot(x - cx, y - cy) / maxD;
        e -= Math.pow(d, 2.6) * 0.35;
      }
      tiles.data[y * cols + x] = classify(e, m, sea);
    }
  }
  return tiles;
}

// ============ 预设生成（P4.1-M3） ============

import { TERRAIN_PRESETS, type TerrainPreset } from './terrainPresets';

/** 气候色系 -> 湿度偏置 */
function paletteMoisture(palette: string): number {
  if (palette === 'arid') return -0.16;
  if (palette === 'tropical') return 0.14;
  return 0;
}

/**
 * 预设地形生成（seeded 可复现；同 preset + params + seed 逐瓦片一致）
 * 高度场 = 预设形状掩蔽（多中心径向衰减 / 环形 / 半平面）+ 分形噪声扰动；
 * 海平面按 landRatio 分位切割（陆地占比语义精确）；对称参数做镜像采样
 */
export function generateTerrainPreset(
  presetKey: string,
  values: Record<string, number | string>,
  seed: number,
  cols: number,
  rows: number
): MapTiles {
  const presetMeta = TERRAIN_PRESETS.find((p) => p.key === presetKey);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const landRatio = Math.min(0.75, Math.max(0.08, Number(values.landRatio ?? 0.32)));
  const roughness = Math.min(1.4, Math.max(0.2, Number(values.roughness ?? 0.7)));
  const symmetry = String(values.symmetry ?? 'none');
  const moistureBias = paletteMoisture(String(values.palette ?? 'temperate'));
  const freq = 7 / Math.max(cols, rows);
  const persistence = 0.42 * roughness;

  // 预设形状中心（seeded，位于画布中部区域）
  const centers: Array<{ x: number; y: number; r: number; shape: number }> = [];
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const maxD = Math.hypot(cx, cy) || 1;
  const islandCount = Math.max(1, Math.round(Number(values.islandCount ?? 1)));
  if (presetKey === 'archipelago') {
    for (let i = 0; i < islandCount; i++) {
      const ang = rng() * Math.PI * 2;
      const dist = (0.15 + rng() * 0.65) * maxD;
      centers.push({
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist,
        r: maxD * (0.14 + rng() * 0.12),
        shape: 1.6
      });
    }
  } else if (presetKey === 'pangaea') {
    centers.push({ x: cx, y: cy, r: maxD * 1.35, shape: 1.2 });
  } else if (presetKey === 'peninsula') {
    // 自上边缘伸入：窄长形状
    centers.push({ x: cx, y: rows * 0.2, r: maxD * 0.85, shape: 2.4 });
  } else {
    const rScale = presetKey === 'lowIsland' ? 0.55 : presetKey === 'highIsland' ? 0.72 : presetKey === 'atoll' ? 0.5 : 0.95;
    centers.push({ x: cx, y: cy, r: maxD * rScale, shape: presetKey === 'highIsland' ? 2.2 : 1.4 });
  }

  /** 预设形状掩蔽 [0,1] */
  const maskOf = (x: number, y: number): number => {
    if (presetKey === 'atoll') {
      // 环形：距主中心 R 的环带
      const d = Math.hypot(x - cx, y - cy) / (centers[0].r || 1);
      return Math.exp(-Math.pow((d - 0.85) / 0.3, 2));
    }
    let best = 0;
    for (const c of centers) {
      const d = Math.hypot(x - c.x, y - c.y) / c.r;
      const v = Math.max(0, 1 - Math.pow(d, c.shape));
      if (v > best) best = v;
    }
    return best;
  };

  const height = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // 对称：镜像采样左半 / 上半
      const sx = symmetry === 'x' ? Math.min(x, cols - 1 - x) : x;
      const sy = symmetry === 'y' ? Math.min(y, rows - 1 - y) : y;
      const noise = fractal(sx * freq, sy * freq, seed, 5, persistence);
      const mask = maskOf(sx, sy);
      let e = mask * 0.72 + noise * 0.42 - 0.14;
      if (presetKey === 'highIsland' || presetKey === 'continent' || presetKey === 'pangaea') {
        e += Math.pow(mask, 2) * 0.18; // 内陆抬升（山地倾向）
      }
      height[y * cols + x] = e;
    }
  }

  // 海平面 = (1 - landRatio) 分位（陆地占比语义精确）
  const sorted = Float64Array.from(height).sort();
  const sea = sorted[Math.min(sorted.length - 1, Math.floor((1 - landRatio) * sorted.length))];

  const tiles: MapTiles = { cols, rows, size: TILE_SIZE, data: new Array<string>(cols * rows).fill('') };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const m = fractal((x + 331) * freq * 0.8, (y + 173) * freq * 0.8, seed + 7777, 3, 0.5) + moistureBias;
      tiles.data[i] = classify(height[i], m, sea);
    }
  }
  return tiles;
}

export type { TerrainPreset };

/** 适合聚居的地形 */
const SETTLE_OK = new Set(['grass', 'plain', 'sand', 'farm', 'forest', 'pine', 'jungle', 'autumn', 'hill', 'desert']);
const WATER = new Set(['deepwater', 'water']);

export interface ScatterSite {
  /** 画布坐标（瓦片中心） */
  x: number;
  y: number;
  icon: string;
  label: string;
}

/** 在适合居住的瓦片上随机撒聚居点（互相保持距离，临水偏好港口/渔村） */
export function scatterSettlements(tiles: MapTiles, seed: number, count: number): ScatterSite[] {
  if (count <= 0) return [];
  const rng = mulberry32(seed ^ 0x5f3759df);
  const sites: ScatterSite[] = [];
  const minDist = Math.min(tiles.cols, tiles.rows) * tiles.size * 0.16;
  let guard = 0;
  while (sites.length < count && guard++ < 5000) {
    const x = Math.floor(rng() * tiles.cols);
    const y = Math.floor(rng() * tiles.rows);
    const t = tiles.data[y * tiles.cols + x];
    if (!SETTLE_OK.has(t)) continue;
    const px = (x + 0.5) * tiles.size;
    const py = (y + 0.5) * tiles.size;
    if (sites.some((s) => Math.hypot(s.x - px, s.y - py) < minDist)) continue;
    // 八邻含水 -> 沿海聚居
    let coastal = false;
    for (let dy = -1; dy <= 1 && !coastal; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= tiles.cols || ny >= tiles.rows) continue;
        if (WATER.has(tiles.data[ny * tiles.cols + nx])) {
          coastal = true;
          break;
        }
      }
    }
    const r = rng();
    const icon = coastal ? (r < 0.5 ? 'harbor' : 'fishing') : r < 0.25 ? 'city' : r < 0.55 ? 'town' : 'village';
    sites.push({ x: px, y: py, icon, label: iconLabel(icon) });
  }
  return sites;
}
