/**
 * 贴图 imageCache（P4.1-M1）：素材 id -> HTMLImageElement 全局缓存
 * Konva.Image 与瓦片纹理共用；未加载完成时调用方渲染占位。
 * 带 LRU 上限：Map 保插入序，get 时 touch，超限淘汰最久未用条目（防长会话内存无限增长）。
 */

const MAX_ENTRIES = 200;

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

/** 同步取已加载的图（未加载返回 null）；命中即 touch（移到末尾） */
export function getCachedImage(assetId: string): HTMLImageElement | null {
  const hit = cache.get(assetId);
  if (!hit) return null;
  cache.delete(assetId);
  cache.set(assetId, hit);
  return hit;
}

/** 加载素材图（去重；失败返回 null 不抛错） */
export function loadAssetImage(assetId: string, url: string): Promise<HTMLImageElement | null> {
  const hit = cache.get(assetId);
  if (hit) {
    // touch
    cache.delete(assetId);
    cache.set(assetId, hit);
    return Promise.resolve(hit);
  }
  const inflight = pending.get(assetId);
  if (inflight) return inflight;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new window.Image();
    img.onload = (): void => {
      cache.set(assetId, img);
      evictOldest();
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

/** 超上限时淘汰最久未用的条目（Map 首项） */
function evictOldest(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
