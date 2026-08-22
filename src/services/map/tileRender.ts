/**
 * 瓦片地形离屏渲染：整层瓦片画到一个 HTMLCanvasElement，
 * Konva 用单张 Image 显示（避免上千个 shape 节点的性能开销）。
 * 涂抹时可用 drawTileCell 增量重绘单格，抬笔后再整体同步。
 * P4.1：自定义瓦片纹理（terrainId = 'asset:tile:{素材id}'）绘制素材图片（已加载时）
 */

import { terrainDef, type MapTiles } from './types';
import { getCachedImage } from '../../components/map/imageCache';

/** 自定义瓦片纹理的兜底底色（按 id 哈希取柔和色） */
function assetTileColor(assetId: string): string {
  let h = 0;
  for (let i = 0; i < assetId.length; i++) h = (Math.imul(h, 31) + assetId.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 45%, 72%)`;
}

/** 绘制/擦除单格（terrainId 为 '' 表示擦除为透明） */
export function drawTileCell(ctx: CanvasRenderingContext2D, tiles: MapTiles, col: number, row: number, terrainId: string): void {
  const { size } = tiles;
  const x = col * size;
  const y = row * size;
  ctx.clearRect(x, y, size, size);
  if (terrainId === '') return;
  // 自定义瓦片纹理：绘制素材图（未加载完成时画兜底色，加载后由调用方整体重绘）
  if (terrainId.startsWith('asset:tile:')) {
    const assetId = terrainId.slice('asset:tile:'.length);
    const img = getCachedImage(assetId);
    if (img) {
      const r = Math.max(img.width, img.height) || 1;
      const s = size / r;
      ctx.drawImage(img, x + (size - img.width * s) / 2, y + (size - img.height * s) / 2, img.width * s, img.height * s);
      return;
    }
    ctx.fillStyle = assetTileColor(assetId);
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = 'rgba(60,50,30,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    return;
  }
  const def = terrainDef(terrainId);
  if (!def) return;
  ctx.fillStyle = def.color;
  ctx.fillRect(x, y, size, size);
  // 极淡格线，保留手绘网格质感
  ctx.strokeStyle = 'rgba(60,50,30,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  if (def.emoji) {
    ctx.font = `${Math.round(size * 0.6)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.emoji, x + size / 2, y + size / 2 + 1);
  }
}

/** 全量渲染瓦片层到新离屏 canvas */
export function renderTilesToCanvas(tiles: MapTiles): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = tiles.cols * tiles.size;
  canvas.height = tiles.rows * tiles.size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let row = 0; row < tiles.rows; row++) {
      for (let col = 0; col < tiles.cols; col++) {
        drawTileCell(ctx, tiles, col, row, tiles.data[row * tiles.cols + col]);
      }
    }
  }
  return canvas;
}
