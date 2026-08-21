/**
 * 选图组件（P3）：本地上传 / AI 生成 / 从图库选 三入口
 * 仅负责挑出（并按需入库）一张图片，具体用途（封面回写 / 角色关联）由调用方处理
 */

import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { ImageGenDialog } from './ImageGenDialog';
import type { ImageAsset, ImageScene, ImageUsage } from '../../services/image/types';

interface Props {
  bookId: string;
  /** AI 生成入口的场景（封面/角色/插图） */
  scene: ImageScene;
  /** 入库用途标签 */
  usage: ImageUsage;
  refId?: string | null;
  title?: string;
  onPicked: (asset: ImageAsset) => void | Promise<void>;
  onClose: () => void;
}

const FILTERS = [
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
];

export function ImagePicker({ bookId, scene, usage, refId, title, onPicked, onClose }: Props): JSX.Element {
  const { imageAssetService } = getAppContext();
  const [mode, setMode] = useState<'menu' | 'library'>('menu');
  const [genOpen, setGenOpen] = useState(false);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'library') return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await imageAssetService.listByBook(bookId);
        if (cancelled) return;
        setImages(list);
        const entries = await Promise.all(
          list.map(async (a) => [a.id, await imageAssetService.resolveUrl(a)] as const)
        );
        if (!cancelled) setUrls(Object.fromEntries(entries));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, bookId, imageAssetService]);

  /** 本地上传 */
  const pickUpload = async (): Promise<void> => {
    setError(null);
    try {
      const path = await open({ multiple: false, filters: FILTERS });
      if (!path || typeof path !== 'string') return;
      setBusy(true);
      const asset = await imageAssetService.importFromFile(bookId, path, usage, refId ?? null);
      await onPicked(asset);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 图库选择 */
  const pickLibrary = async (asset: ImageAsset): Promise<void> => {
    try {
      await onPicked(asset);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      {genOpen && (
        <ImageGenDialog
          bookId={bookId}
          scene={scene}
          usage={usage}
          refId={refId}
          title={title ? `${title} · AI 生成` : undefined}
          onConfirm={async (assets) => {
            if (assets.length > 0) {
              await onPicked(assets[0]);
            }
            onClose();
          }}
          onClose={() => setGenOpen(false)}
        />
      )}
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onClick={busy ? undefined : onClose}>
        <div className="w-[480px] rounded-lg bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="mb-3 text-base font-medium">{title ?? '选择图片'}</div>

          {mode === 'menu' && (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy}
                className="flex flex-col items-center gap-2 rounded border border-ink-200 px-3 py-4 text-sm hover:border-violet-300 hover:bg-violet-50 disabled:opacity-40"
                onClick={() => void pickUpload()}
              >
                <span className="text-2xl">📁</span>
                本地上传
                <span className="text-[11px] text-ink-400">不依赖 AI 配置</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center gap-2 rounded border border-ink-200 px-3 py-4 text-sm hover:border-violet-300 hover:bg-violet-50"
                onClick={() => setGenOpen(true)}
              >
                <span className="text-2xl">✨</span>
                AI 生成
                <span className="text-[11px] text-ink-400">两段式提示词 + 多候选</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center gap-2 rounded border border-ink-200 px-3 py-4 text-sm hover:border-violet-300 hover:bg-violet-50"
                onClick={() => setMode('library')}
              >
                <span className="text-2xl">🖼️</span>
                从图库选
                <span className="text-[11px] text-ink-400">复用本书已有图片</span>
              </button>
            </div>
          )}

          {mode === 'library' && (
            <div className="max-h-[52vh] overflow-y-auto">
              {images.length === 0 ? (
                <div className="py-8 text-center text-sm text-ink-400">本书还没有图片，先上传或生成一张吧</div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {images.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="overflow-hidden rounded border border-ink-100 hover:border-violet-400"
                      title={`${a.fileName} · ${a.width}x${a.height}`}
                      onClick={() => void pickLibrary(a)}
                    >
                      <img src={urls[a.id]} alt={a.fileName} className="h-24 w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="mt-2 text-xs text-violet-600 hover:underline"
                onClick={() => setMode('menu')}
              >
                ← 返回
              </button>
            </div>
          )}

          {error && <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</div>}

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
              onClick={onClose}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
