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
