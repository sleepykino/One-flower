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

export function pickBiome(
  elevation: number,
  moisture: number,
  seaLevel: number,
  style: string
): number {
  if (style === 'fantasy') {
    if (elevation < seaLevel * 0.6) return 0
    if (elevation < seaLevel) return 1
    if (elevation < seaLevel + 0.03) return 2
    if (elevation < seaLevel + 0.06) return 3
    if (moisture < 0.3 && elevation > 0.65) return 9
    if (moisture > 0.6 && elevation < 0.5) return 10
    if (elevation > 0.85) return 8
    if (elevation > 0.75) return 7
    if (elevation > 0.6) return 6
    if (moisture > 0.45) return 5
    return 4
  } else if (style === 'terrain') {
    if (elevation < seaLevel * 0.5) return 0
    if (elevation < seaLevel) return 1
    if (elevation < seaLevel + 0.04) return 2
    if (elevation < seaLevel + 0.08) return 3
    if (moisture < 0.25 && elevation > 0.6) return 9
    if (moisture > 0.55 && elevation < 0.5) return 10
    if (elevation > 0.85) return 8
    if (elevation > 0.72) return 7
    if (elevation > 0.6 && moisture < 0.35) return 6
    if (elevation > 0.6) return 5
    if (moisture > 0.4) return 11
    return 4
  } else {
    if (elevation < 0.3) return 0
    if (elevation < 0.45) return 1
    if (elevation < 0.55) return 2
    if (elevation < 0.58) return 3
    if (elevation < 0.62) return 4
    if (elevation > 0.85) return 9
    if (elevation > 0.75) return 8
    if (moisture > 0.4) return 6
    return 5
  }
}

export function generateTerrainMap(
  seed: number,
  width: number,
  height: number,
  seaLevel: number,
  roughness: number,
  octaves: number,
  style: string
): number[] {
  const noise = new PerlinNoise(seed)
  const map: number[] = new Array(width * height)
  const cx = width / 2
  const cy = height / 2
  const maxDist = Math.sqrt(cx * cx + cy * cy)
  const scale = roughness > 0 ? roughness : 1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let e = (noise.fbm(x / scale, y / scale, octaves) + 1) / 2

      if (style === 'island') {
        const dx = (x - cx) / maxDist
        const dy = (y - cy) / maxDist
        const d = Math.sqrt(dx * dx + dy * dy)
        e *= Math.max(0, 1 - Math.pow(d, 2.2))
      }

      const m = (noise.fbm((x + 1000) / scale, (y + 1000) / scale, octaves) + 1) / 2
      map[i] = pickBiome(e, m, seaLevel, style)
    }
  }

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
    map: number[],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w: number,
    h: number,
    tileId: number
  ): void {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (x >= 0 && x < w && y >= 0 && y < h) {
          map[y * w + x] = tileId
        }
      }
    }
  }

  function carveH(
    map: number[],
    x0: number,
    x1: number,
    y: number,
    w: number,
    h: number,
    tileId: number
  ): void {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    for (let x = minX; x <= maxX; x++) {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        map[y * w + x] = tileId
      }
    }
  }

  function carveV(
    map: number[],
    y0: number,
    y1: number,
    x: number,
    w: number,
    h: number,
    tileId: number
  ): void {
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    for (let y = minY; y <= maxY; y++) {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        map[y * w + x] = tileId
      }
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
  const maxAttempts = roomCount * 50

  while (rooms.length < roomCount && attempts < maxAttempts) {
    attempts++
    const rw = 4 + Math.floor(rng() * 7)
    const rh = 4 + Math.floor(rng() * 7)
    const rx = 1 + Math.floor(rng() * Math.max(1, width - rw - 2))
    const ry = 1 + Math.floor(rng() * Math.max(1, height - rh - 2))

    let overlaps = false
    for (const room of rooms) {
      if (
        rx < room.x + room.w + 1 &&
        rx + rw + 1 > room.x &&
        ry < room.y + room.h + 1 &&
        ry + rh + 1 > room.y
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
    carveRect(
      map,
      room.x,
      room.y,
      room.x + room.w - 1,
      room.y + room.h - 1,
      width,
      height,
      0
    )
  }

  for (let i = 1; i < rooms.length; i++) {
    const r1 = rooms[i - 1]
    const r2 = rooms[i]
    if (rng() < 0.5) {
      carveH(map, r1.cx, r2.cx, r1.cy, width, height, 0)
      carveV(map, r1.cy, r2.cy, r2.cx, width, height, 0)
    } else {
      carveV(map, r1.cy, r2.cy, r1.cx, width, height, 0)
      carveH(map, r1.cx, r2.cx, r2.cy, width, height, 0)
    }
  }

  if (rooms.length >= 2) {
    const r1 = rooms[0]
    const r2 = rooms[rooms.length - 1]
    if (rng() < 0.5) {
      carveH(map, r1.cx, r2.cx, r1.cy, width, height, 0)
      carveV(map, r1.cy, r2.cy, r2.cx, width, height, 0)
    } else {
      carveV(map, r1.cy, r2.cy, r1.cx, width, height, 0)
      carveH(map, r1.cx, r2.cx, r2.cy, width, height, 0)
    }
  }

  for (const room of rooms) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ty = room.y - 1
      if (ty >= 0 && map[ty * width + x] === 1 && map[room.y * width + x] === 0) {
        if (rng() < 0.15) map[ty * width + x] = 2
      }
      const by = room.y + room.h
      if (
        by < height &&
        map[by * width + x] === 1 &&
        map[(room.y + room.h - 1) * width + x] === 0
      ) {
        if (rng() < 0.15) map[by * width + x] = 2
      }
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      const lx = room.x - 1
      if (lx >= 0 && map[y * width + lx] === 1 && map[y * width + room.x] === 0) {
        if (rng() < 0.15) map[y * width + lx] = 2
      }
      const rx = room.x + room.w
      if (
        rx < width &&
        map[y * width + rx] === 1 &&
        map[y * width + (room.x + room.w - 1)] === 0
      ) {
        if (rng() < 0.15) map[y * width + rx] = 2
      }
    }
  }

  return map
}
