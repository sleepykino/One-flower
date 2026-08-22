/**
 * 贴图 imageCache（P4.1-M1）：素材 id -> HTMLImageElement 全局缓存
 * Konva.Image 与瓦片纹理共用；未加载完成时调用方渲染占位
 */

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

/** 同步取已加载的图（未加载返回 null） */
export function getCachedImage(assetId: string): HTMLImageElement | null {
  return cache.get(assetId) ?? null;
}

/** 加载素材图（去重；失败返回 null 不抛错） */
export function loadAssetImage(assetId: string, url: string): Promise<HTMLImageElement | null> {
  const hit = cache.get(assetId);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(assetId);
  if (inflight) return inflight;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new window.Image();
    img.onload = (): void => {
      cache.set(assetId, img);
      pending.delete(assetId);
      resolve(img);
    };
    img.onerror = (): void => {
      pending.delete(assetId);
      resolve(null);
    };
    img.src = url;
  });
  pending.set(assetId, p);
  return p;
}

/** 素材被删除后清缓存 */
export function evictAssetImage(assetId: string): void {
  cache.delete(assetId);
}
