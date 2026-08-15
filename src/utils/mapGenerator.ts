export interface RgbColor {
  r: number
  g: number
  b: number
}

export function hashSeed(s: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hexToRgb(hex: string): RgbColor {
  const cleaned = hex.replace(/^#/, '')
  const num = parseInt(cleaned, 16)
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff
  }
}

export class PerlinNoise {
  private perm: Uint8Array

  constructor(seed: number) {
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i

    let s = seed >>> 0
    if (s === 0) s = 1
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647
      const j = s % (i + 1)
      const tmp = p[i]
      p[i] = p[j]
      p[j] = tmp
    }

    this.perm = new Uint8Array(512)
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255]
    }
  }

  private _fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10)
  }

  private _lerp(a: number, b: number, t: number): number {
    return a + t * (b - a)
  }

  private _grad(hash: number, x: number, y: number): number {
    const h = hash & 7
    const u = h < 4 ? x : y
    const v = h < 4 ? y : x
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v)
  }

  public noise2(x: number, y: number): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    x -= Math.floor(x)
    y -= Math.floor(y)
    const u = this._fade(x)
    const v = this._fade(y)
    const p = this.perm
    const aa = p[p[X] + Y]
    const ab = p[p[X] + Y + 1]
    const ba = p[p[X + 1] + Y]
    const bb = p[p[X + 1] + Y + 1]
    return this._lerp(
      this._lerp(this._grad(aa, x, y), this._grad(ba, x - 1, y), u),
      this._lerp(this._grad(ab, x, y - 1), this._grad(bb, x - 1, y - 1), u),
      v
    )
  }

  public fbm(
    x: number,
    y: number,
    octaves: number,
    persistence: number = 0.5,
    lacunarity: number = 2
  ): number {
    let total = 0
    let frequency = 1
    let amplitude = 1
    let maxValue = 0
    for (let i = 0; i < octaves; i++) {
      total += this.noise2(x * frequency, y * frequency) * amplitude
      maxValue += amplitude
      amplitude *= persistence
      frequency *= lacunarity
    }
    return total / maxValue
  }
}

/* ===== 地形预设 ===== */

export type TerrainStyleId = 'fantasy' | 'terrain' | 'island'

export interface TerrainPreset {
  id: string
  name: string
  icon: string
  description: string
  /** 使用的瓦片集（决定生物群系配色） */
  style: TerrainStyleId
  /** 噪声特征尺度：相对地图尺寸的比例（越大越平缓成块） */
  featureSize: number
  /** fbm 细节层数 */
  octaves: number
  persistence: number
  lacunarity: number
  /** 域扭曲强度：让海岸线/山脉走向自然弯曲 */
  warp: number
  /** 岛屿衰减强度：0 = 大陆边缘延伸，1 = 标准孤岛 */
  islandFalloff: number
  /** 默认海平面 */
  seaLevel: number
  /** 平滑次数 */
  smoothPasses: number
}

export const TERRAIN_PRESETS: TerrainPreset[] = [
  {
    id: 'continent', name: '广袤大陆', icon: '🗺️', description: '大块陆地与海湾，适合世界地图',
    style: 'fantasy', featureSize: 0.16, octaves: 5, persistence: 0.5, lacunarity: 2,
    warp: 0.35, islandFalloff: 0.15, seaLevel: 0.4, smoothPasses: 2
  },
  {
    id: 'archipelago', name: '群岛海域', icon: '🏝️', description: '零散岛屿与海峡，适合航海冒险',
    style: 'island', featureSize: 0.11, octaves: 5, persistence: 0.55, lacunarity: 2,
    warp: 0.4, islandFalloff: 0.5, seaLevel: 0.55, smoothPasses: 1
  },
  {
    id: 'island', name: '孤岛', icon: '🌋', description: '中央一座岛屿，四周环海',
    style: 'island', featureSize: 0.2, octaves: 4, persistence: 0.5, lacunarity: 2,
    warp: 0.3, islandFalloff: 1, seaLevel: 0.45, smoothPasses: 1
  },
  {
    id: 'highlands', name: '崇山峻岭', icon: '⛰️', description: '山脉纵横的高地地形',
    style: 'terrain', featureSize: 0.13, octaves: 6, persistence: 0.55, lacunarity: 2,
    warp: 0.45, islandFalloff: 0.2, seaLevel: 0.3, smoothPasses: 2
  },
  {
    id: 'plains', name: '平原沃野', icon: '🌾', description: '平缓开阔的草原与耕地',
    style: 'terrain', featureSize: 0.24, octaves: 3, persistence: 0.4, lacunarity: 2,
    warp: 0.2, islandFalloff: 0.1, seaLevel: 0.35, smoothPasses: 2
  },
  {
    id: 'wasteland', name: '荒漠戈壁', icon: '🏜️', description: '干旱的沙漠与戈壁',
    style: 'terrain', featureSize: 0.17, octaves: 4, persistence: 0.5, lacunarity: 2,
    warp: 0.3, islandFalloff: 0.1, seaLevel: 0.28, smoothPasses: 2
  },
  {
    id: 'dungeon', name: '地牢', icon: '🗝️', description: '房间与走廊构成的地下城',
    style: 'terrain', featureSize: 0.16, octaves: 4, persistence: 0.5, lacunarity: 2,
    warp: 0, islandFalloff: 0, seaLevel: 0.4, smoothPasses: 0
  }
]

export function getPreset(id: string): TerrainPreset {
  return TERRAIN_PRESETS.find(p => p.id === id) ?? TERRAIN_PRESETS[0]
}

/**
 * 根据海拔 / 湿度挑选生物群系瓦片。
 * 阈值带刻意加宽，保证群系成块连贯。
 */
export function pickBiome(
  elevation: number,
  moisture: number,
  seaLevel: number,
  style: string
): number {
  if (style === 'fantasy') {
    if (elevation < seaLevel * 0.55) return 0
    if (elevation < seaLevel) return 1
    if (elevation < seaLevel + 0.04) return 2
    if (elevation < seaLevel + 0.09) return 3
    if (elevation > 0.86) return 8
    if (elevation > 0.76) return 7
    if (elevation > 0.62) return 6
    if (moisture < 0.3 && elevation > 0.55) return 9
    if (moisture > 0.62 && elevation < 0.5) return 10
    if (moisture > 0.4) return 5
    return 4
  } else if (style === 'terrain') {
    if (elevation < seaLevel * 0.5) return 0
    if (elevation < seaLevel) return 1
    if (elevation < seaLevel + 0.05) return 2
    if (elevation < seaLevel + 0.1) return 3
    if (elevation > 0.86) return 9
    if (elevation > 0.74) return 8
    if (elevation > 0.64) return 7
    if (moisture < 0.28 && elevation > 0.5) return 10
    if (moisture > 0.55) return 5
    if (moisture > 0.38) return 6
    if (moisture < 0.34) return 11
    return 4
  } else {
    /* island */
    if (elevation < seaLevel * 0.5) return 0
    if (elevation < seaLevel) return 1
    if (elevation < seaLevel + 0.04) return 2
    if (elevation < seaLevel + 0.07) return 3
    if (elevation > 0.84) return 9
    if (elevation > 0.7) return 8
    if (elevation > 0.58) return 7
    if (moisture > 0.45) return 6
    return 5
  }
}

/**
 * 3×3 众数滤波：将孤立噪点替换为邻域多数瓦片，让地形成块。
 * 阈值 6/9 较保守，保留窄海峡与河流。
 */
export function smoothTiles(map: number[], w: number, h: number, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const src = map.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const counts = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
            const t = src[ny * w + nx]
            counts.set(t, (counts.get(t) ?? 0) + 1)
          }
        }
        const cur = src[y * w + x]
        let best = cur
        let bestCount = 0
        for (const [t, c] of counts) {
          if (c > bestCount) {
            best = t
            bestCount = c
          }
        }
        if (bestCount >= 6 && best !== cur) {
          map[y * w + x] = best
        }
      }
    }
  }
}

export interface TerrainGenOptions {
  seed: number
  width: number
  height: number
  preset: TerrainPreset
  /** 0-1，覆盖 preset.seaLevel */
  seaLevel?: number
}

/**
 * 生成地形瓦片：
 * - 特征尺度按地图尺寸自适应，任意尺寸下地形都成块（修复高频噪点）
 * - 域扭曲让海岸线与山脉走向自然弯曲
 * - 海拔 / 湿度使用独立噪声实例，避免条纹相关
 * - 众数滤波清除孤点
 */
export function generateTerrainMap(opts: TerrainGenOptions): number[] {
  const { seed, width, height, preset } = opts
  const seaLevel = opts.seaLevel ?? preset.seaLevel

  const elevNoise = new PerlinNoise(seed)
  const moistNoise = new PerlinNoise((seed ^ 0x9e3779b9) >>> 0)
  const warpNoise = new PerlinNoise((seed + 7919) >>> 0)

  const map: number[] = new Array(width * height)

  /* 特征尺度：保证一张地图横跨固定数量的噪声晶格，地形特征稳定成块 */
  const featureScale = Math.max(6, Math.max(width, height) * preset.featureSize)
  const cx = width / 2
  const cy = height / 2

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const nx = x / featureScale
      const ny = y / featureScale

      /* 域扭曲 */
      let sx = nx
      let sy = ny
      if (preset.warp > 0) {
        const wx = warpNoise.fbm(nx + 3.1, ny + 1.7, 3) * preset.warp
        const wy = warpNoise.fbm(nx - 2.3, ny + 4.5, 3) * preset.warp
        sx += wx
        sy += wy
      }

      let e = (elevNoise.fbm(sx, sy, preset.octaves, preset.persistence, preset.lacunarity) + 1) / 2

      /* 岛屿衰减：超椭圆衰减让边缘不总是圆形 */
      if (preset.islandFalloff > 0) {
        const dx = (x - cx) / cx
        const dy = (y - cy) / cy
        const d = Math.pow(Math.abs(dx) ** 2.5 + Math.abs(dy) ** 2.5, 1 / 2.5)
        e *= Math.max(0, 1 - preset.islandFalloff * Math.pow(Math.min(d, 1.6), 2.3))
      }

      const m = (moistNoise.fbm(nx * 1.25 + 100, ny * 1.25 + 100, 3) + 1) / 2
      map[i] = pickBiome(e, m, seaLevel, preset.style)
    }
  }

  smoothTiles(map, width, height, preset.smoothPasses)
  return map
}

export function generateDungeon(
  seed: number,
  width: number,
  height: number,
  roomCount: number
): number[] {
  const rng = mulberry32(seed)
  const map: number[] = new Array(width * height).fill(1)

  function carveRect(
    x0: number, y0: number, x1: number, y1: number, tileId: number
  ): void {
    const minX = Math.max(0, Math.min(x0, x1))
    const maxX = Math.min(width - 1, Math.max(x0, x1))
    const minY = Math.max(0, Math.min(y0, y1))
    const maxY = Math.min(height - 1, Math.max(y0, y1))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        map[y * width + x] = tileId
      }
    }
  }

  function carveH(x0: number, x1: number, y: number, tileId: number): void {
    const minX = Math.max(0, Math.min(x0, x1))
    const maxX = Math.min(width - 1, Math.max(x0, x1))
    if (y >= 0 && y < height) {
      for (let x = minX; x <= maxX; x++) map[y * width + x] = tileId
    }
  }

  function carveV(y0: number, y1: number, x: number, tileId: number): void {
    const minY = Math.max(0, Math.min(y0, y1))
    const maxY = Math.min(height - 1, Math.max(y0, y1))
    if (x >= 0 && x < width) {
      for (let y = minY; y <= maxY; y++) map[y * width + x] = tileId
    }
  }

  interface Room {
    x: number
    y: number
    w: number
    h: number
    cx: number
    cy: number
  }

  const rooms: Room[] = []
  let attempts = 0
  const maxAttempts = roomCount * 60

  while (rooms.length < roomCount && attempts < maxAttempts) {
    attempts++
    const rw = 5 + Math.floor(rng() * 8)
    const rh = 5 + Math.floor(rng() * 8)
    const rx = 2 + Math.floor(rng() * Math.max(1, width - rw - 4))
    const ry = 2 + Math.floor(rng() * Math.max(1, height - rh - 4))

    let overlaps = false
    for (const room of rooms) {
      if (
        rx < room.x + room.w + 2 &&
        rx + rw + 2 > room.x &&
        ry < room.y + room.h + 2 &&
        ry + rh + 2 > room.y
      ) {
        overlaps = true
        break
      }
    }

    if (!overlaps) {
      rooms.push({
        x: rx,
        y: ry,
        w: rw,
        h: rh,
        cx: Math.floor(rx + rw / 2),
        cy: Math.floor(ry + rh / 2)
      })
    }
  }

  for (const room of rooms) {
    carveRect(room.x, room.y, room.x + room.w - 1, room.y + room.h - 1, 0)
  }

  /* L 形走廊连接相邻房间 */
  for (let i = 1; i < rooms.length; i++) {
    const r1 = rooms[i - 1]
    const r2 = rooms[i]
    if (rng() < 0.5) {
      carveH(r1.cx, r2.cx, r1.cy, 0)
      carveV(r1.cy, r2.cy, r2.cx, 0)
    } else {
      carveV(r1.cy, r2.cy, r1.cx, 0)
      carveH(r1.cx, r2.cx, r2.cy, 0)
    }
  }

  /* 首尾相连形成环，避免死路树 */
  if (rooms.length >= 2) {
    const r1 = rooms[0]
    const r2 = rooms[rooms.length - 1]
    if (rng() < 0.5) {
      carveH(r1.cx, r2.cx, r1.cy, 0)
      carveV(r1.cy, r2.cy, r2.cx, 0)
    } else {
      carveV(r1.cy, r2.cy, r1.cx, 0)
      carveH(r1.cx, r2.cx, r2.cy, 0)
    }
  }

  /* 在房间边缘的墙壁上开门 */
  for (const room of rooms) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ty = room.y - 1
      if (ty >= 0 && map[ty * width + x] === 1) {
        /* 门只开在走廊经过处：上下都是地板才算门口 */
        if (rng() < 0.3 && map[(ty - 1 >= 0 ? ty - 1 : ty) * width + x] === 0) {
          map[ty * width + x] = 2
        }
      }
      const by = room.y + room.h
      if (by < height && map[by * width + x] === 1) {
        if (rng() < 0.3 && map[(by + 1 < height ? by + 1 : by) * width + x] === 0) {
          map[by * width + x] = 2
        }
      }
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      const lx = room.x - 1
      if (lx >= 0 && map[y * width + lx] === 1) {
        if (rng() < 0.3 && map[y * width + (lx - 1 >= 0 ? lx - 1 : lx)] === 0) {
          map[y * width + lx] = 2
        }
      }
      const rx = room.x + room.w
      if (rx < width && map[y * width + rx] === 1) {
        if (rng() < 0.3 && map[y * width + (rx + 1 < width ? rx + 1 : rx)] === 0) {
          map[y * width + rx] = 2
        }
      }
    }
  }

  return map
}
