import { describe, expect, it } from 'vitest';
import {
  generateTerrain,
  generateTerrainPreset,
  mulberry32,
  scatterSettlements
} from '../../src/services/map/terrainGen';
import type { MapTiles } from '../../src/services/map/types';

// T10.5：瓦片地形生成纯函数单测（本地算法，无 AI 依赖）
// 核心：seed 复现——同 preset + params + seed 逐瓦片一致

const WATER = new Set(['deepwater', 'water']);

describe('mulberry32', () => {
  it('同种子序列完全一致，异种子序列不同', () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    const seq1 = [r1(), r1(), r1()];
    const seq2 = [r2(), r2(), r2()];
    expect(seq1).toEqual(seq2);
    expect([mulberry32(43)(), mulberry32(43)()]).not.toEqual(seq1);
  });

  it('输出落在 [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateTerrainPreset（seed 复现）', () => {
  it('同 preset + 参数 + seed 逐瓦片一致', () => {
    const a = generateTerrainPreset('pangaea', { landRatio: 0.5, roughness: 0.7 }, 20260825, 48, 48);
    const b = generateTerrainPreset('pangaea', { landRatio: 0.5, roughness: 0.7 }, 20260825, 48, 48);
    expect(a.data).toEqual(b.data);
    expect(a.cols).toBe(48);
    expect(a.rows).toBe(48);
  });

  it('不同 seed 产出不同地形', () => {
    const a = generateTerrainPreset('archipelago', {}, 1, 40, 40);
    const b = generateTerrainPreset('archipelago', {}, 2, 40, 40);
    expect(a.data.some((t, i) => t !== b.data[i])).toBe(true);
  });

  it('海平面按 landRatio 分位切割：陆地占比语义精确（±3%）', () => {
    for (const ratio of [0.15, 0.35, 0.6]) {
      const tiles = generateTerrainPreset(
        'continent',
        { landRatio: ratio, roughness: 0.6 },
        99,
        64,
        64
      );
      const land = tiles.data.filter((t) => !WATER.has(t)).length;
      const actual = land / (64 * 64);
      // 分位切割本身精确；容差仅覆盖取整与对称采样的边界效应
      expect(Math.abs(actual - ratio)).toBeLessThan(0.03);
    }
  });

  it('输出仅含已知地形 id 且无空瓦片', () => {
    const known = new Set([
      'deepwater', 'water', 'sand', 'grass', 'plain', 'forest',
      'jungle', 'hill', 'pine', 'mountain', 'snow', 'desert'
    ]);
    const tiles = generateTerrainPreset('atoll', { landRatio: 0.18 }, 12345, 32, 32);
    expect(tiles.data).toHaveLength(32 * 32);
    for (const t of tiles.data) expect(known.has(t)).toBe(true);
  });

  it('参数越界被钳制（landRatio 上限 0.75 / 下限 0.08），不抛错', () => {
    const hi = generateTerrainPreset('pangaea', { landRatio: 5 }, 7, 16, 16);
    const lo = generateTerrainPreset('pangaea', { landRatio: -1 }, 7, 16, 16);
    expect(hi.data.length).toBe(256);
    expect(lo.data.length).toBe(256);
  });

  it('对称模式：symmetry=x 高度场镜像 -> 水陆分布逐瓦片对称', () => {
    // 注：湿度噪声通道不做镜像采样，故陆地内的具体分类（草原/沙漠等）允许差异；
    // 对称性保证的是高度场，即水/陆的划分
    const tiles = generateTerrainPreset(
      'continent',
      { landRatio: 0.4, symmetry: 'x' },
      555,
      33,
      21
    );
    const isWater = (t: string) => t === 'deepwater' || t === 'water';
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < Math.floor(33 / 2); x++) {
        expect(isWater(tiles.data[y * 33 + x])).toBe(isWater(tiles.data[y * 33 + (33 - 1 - x)]));
      }
    }
  });
});

describe('scatterSettlements', () => {
  it('按数量撒点、坐标在画布内、icon 取自合法集合且 seed 可复现', () => {
    const tiles = generateTerrainPreset('continent', { landRatio: 0.5 }, 888, 48, 48);
    const s1 = scatterSettlements(tiles, 42, 6);
    const s2 = scatterSettlements(tiles, 42, 6);
    expect(s1).toEqual(s2);
    expect(s1.length).toBeLessThanOrEqual(6);
    const icons = new Set(['harbor', 'fishing', 'city', 'town', 'village']);
    for (const s of s1) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(48 * tiles.size);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(48 * tiles.size);
      expect(icons.has(s.icon)).toBe(true);
      expect(s.label).not.toBe('');
    }
  });

  it('count<=0 返回空数组；聚居点只落在陆地瓦片上', () => {
    expect(scatterSettlements({ cols: 4, rows: 4, size: 32, data: new Array(16).fill('') }, 1, 3)).toEqual([]);
    const tiles = generateTerrainPreset('pangaea', { landRatio: 0.6 }, 321, 40, 40);
    const sites = scatterSettlements(tiles, 9, 20);
    for (const s of sites) {
      const col = Math.floor(s.x / tiles.size);
      const row = Math.floor(s.y / tiles.size);
      const t = tiles.data[row * tiles.cols + col];
      expect(WATER.has(t)).toBe(false);
    }
  });
});

describe('generateTerrain（底层无预设，直测导出函数）', () => {
  it('同 seed 逐瓦片一致，异 seed 不同', () => {
    const a = generateTerrain({ cols: 24, rows: 24, seed: 7 });
    const b = generateTerrain({ cols: 24, rows: 24, seed: 7 });
    const c = generateTerrain({ cols: 24, rows: 24, seed: 8 });
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toEqual(c.data);
  });

  it('island=false 关闭岛屿掩蔽（不再下压边缘）后陆地占比显著提升', () => {
    const landOf = (t: MapTiles) => t.data.filter((id) => !WATER.has(id)).length;
    const withIsland = generateTerrain({ cols: 40, rows: 40, seed: 11, seaLevel: 0.42, island: true });
    const without = generateTerrain({ cols: 40, rows: 40, seed: 11, seaLevel: 0.42, island: false });
    expect(landOf(without)).toBeGreaterThan(landOf(withIsland));
  });

  it('seaLevel 抬升则水域扩张；tileSize 与尺寸透传', () => {
    const dry = generateTerrain({ cols: 32, rows: 32, seed: 3, seaLevel: 0.2 });
    const wet = generateTerrain({ cols: 32, rows: 32, seed: 3, seaLevel: 0.6 });
    const waterOf = (t: MapTiles) => t.data.filter((id) => WATER.has(id)).length;
    expect(waterOf(wet)).toBeGreaterThan(waterOf(dry));

    const t = generateTerrain({ cols: 16, rows: 8, seed: 5, tileSize: 64 });
    expect(t.size).toBe(64);
    expect(t.cols).toBe(16);
    expect(t.rows).toBe(8);
    expect(t.data).toHaveLength(128);
  });
});
