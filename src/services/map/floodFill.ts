/**
 * 油漆桶填充（P4.1）：从 (col,row) 把与起始格同地形的四连通区域整体替换为 to
 * 纯函数不改入参；从 MapEditor 抽出以便单测覆盖（组件文件含 Konva 依赖无法在 node 导入）
 */

import type { MapTiles } from './types';

export function floodFillTiles(tiles: MapTiles, col: number, row: number, to: string): MapTiles {
  const { cols, rows, data } = tiles;
  const from = data[row * cols + col];
  if (from === to) return tiles;
  const next = [...data];
  const stack: number[] = [row * cols + col];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (next[i] !== from) continue;
    next[i] = to;
    const c = i % cols;
    const r = (i - c) / cols;
    if (c > 0) stack.push(i - 1);
    if (c < cols - 1) stack.push(i + 1);
    if (r > 0) stack.push(i - cols);
    if (r < rows - 1) stack.push(i + cols);
  }
  return { ...tiles, data: next };
}
