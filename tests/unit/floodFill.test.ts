import { describe, expect, it } from 'vitest';
import { floodFillTiles } from '../../src/services/map/floodFill';
import type { MapTiles } from '../../src/services/map/types';

// T10.5：油漆桶填充（四连通区域替换）纯函数单测

function makeTiles(grid: string[]): MapTiles {
  // grid 为行文本，每字符一格，便于直观看连通区域
  const rows = grid.length;
  const cols = grid[0].length;
  return { cols, rows, size: 32, data: grid.join('').split('') };
}

function toGrid(t: MapTiles): string[] {
  const rows: string[] = [];
  for (let r = 0; r < t.rows; r++) {
    rows.push(t.data.slice(r * t.cols, (r + 1) * t.cols).join(''));
  }
  return rows;
}

describe('floodFillTiles', () => {
  it('同地形连通区域整体替换；被障碍隔开的同地形不受影响', () => {
    // 左侧草地与右侧草地被河流隔开（单字符地形码保证网格对齐）
    const t = makeTiles(['ggrg', 'ggrg', 'ggrg']);
    const out = floodFillTiles(t, 0, 0, 'f');
    expect(toGrid(out)).toEqual(['ffrg', 'ffrg', 'ffrg']);
  });

  it('四连通语义：对角不传播', () => {
    const t = makeTiles(['gw', 'wg']);
    const out = floodFillTiles(t, 0, 0, 's');
    expect(toGrid(out)).toEqual(['sw', 'wg']);
  });

  it('from === to 时原对象返回（无谓替换短路）', () => {
    const t = makeTiles(['gg', 'gg']);
    expect(floodFillTiles(t, 1, 1, 'g')).toBe(t);
  });

  it('纯函数：不改入参 tiles', () => {
    const t = makeTiles(['ggw', 'www']);
    const snapshot = [...t.data];
    floodFillTiles(t, 0, 0, 'h');
    expect(t.data).toEqual(snapshot);
  });

  it('从内部点起填同样覆盖整个连通块', () => {
    const t = makeTiles(['wwww', 'wssw', 'wssw', 'wwww']);
    const out = floodFillTiles(t, 2, 2, 'd');
    expect(toGrid(out)).toEqual(['wwww', 'wddw', 'wddw', 'wwww']);
  });
});
