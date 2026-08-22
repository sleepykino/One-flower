/**
 * 图库面板（P3，编辑器右侧 tab）：浏览本书全部图片、按用途筛选、删除（带引用检查）、复用（插入正文）
 */

import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { useEditorStore } from '../../store/editorStore';
import { confirmDialog } from '../../native/dialog';
import { ImageReferenceError } from '../../services/image/types';
import type { ImageAsset, ImageUsage } from '../../services/image/types';
import { USAGE_LABELS } from '../../services/image/types';

const FILTERS = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }];

type Filter = ImageUsage | 'all';

const FILTER_TABS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'cover', label: '封面' },
  { key: 'character', label: '角色' },
  { key: 'illustration', label: '插图' }
];

function refLabel(ref: { type: string; title: string }): string {
  switch (ref.type) {
    case 'cover':
      return `书籍封面（${ref.title}）`;
    case 'character':
      return `角色「${ref.title}」`;
    default:
      return `章节「${ref.title}」`;
  }
}

export function ImageLibraryPanel({ bookId }: { bookId: string }): JSX.Element {
  const { imageAssetService } = getAppContext();
  const [filter, setFilter] = useState<Filter>('all');
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const list = await imageAssetService.listByBook(bookId, filter === 'all' ? undefined : filter);
      setImages(list);
      const entries = await Promise.all(
        list.map(async (a) => [a.id, await imageAssetService.resolveUrl(a)] as const)
      );
      setUrls(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [bookId, filter, imageAssetService]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 复用：插入正文光标处 */
  const insert = (asset: ImageAsset): void => {
    const api = useEditorStore.getState().editorApi;
    if (!api?.insertIllustration) {
      setMsg('请先打开一个章节再插入图片');
      return;
    }
    const ok = api.insertIllustration(asset);
    setMsg(ok ? `已插入：${asset.fileName}` : '插入失败');
  };

  /** 删除：引用检查 + 二次确认 */
  const remove = async (asset: ImageAsset): Promise<void> => {
    try {
      await imageAssetService.remove(asset.id);
      await reload();
    } catch (e) {
      if (e instanceof ImageReferenceError) {
        const list = e.refs.map((r) => refLabel(r)).join('、');
        const force = await confirmDialog(
          `该图片正被以下位置引用：\n${list}\n\n强制删除后，上述位置将显示占位文字。确定删除吗？`,
          '图片被引用'
        );
        if (force) {
          await imageAssetService.remove(asset.id, true);
          await reload();
        }
      } else {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    }
  };

  /** 上传新图片到图库 */
  const upload = async (): Promise<void> => {
    try {
      const path = await open({ multiple: false, filters: FILTERS });
      if (!path || typeof path !== 'string') return;
      await imageAssetService.importFromFile(bookId, path, 'library');
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-ink-100 px-2 py-1.5">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`rounded px-1.5 py-0.5 text-xs ${
              filter === t.key ? 'bg-violet-100 text-violet-700' : 'text-ink-500 hover:bg-ink-100'
            }`}
            onClick={() => setFilter(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto rounded border border-ink-200 px-1.5 py-0.5 text-xs text-ink-600 hover:bg-ink-100"
          title="上传图片到图库（不依赖 AI 配置）"
          onClick={() => void upload()}
        >
          + 上传
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && images.length === 0 && <div className="py-8 text-center text-xs text-ink-400">加载中…</div>}
        {!loading && images.length === 0 && (
          <div className="py-8 text-center text-xs text-ink-400">
            暂无图片。可上传，或在封面 / 角色卡 / 编辑器中生成。
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {images.map((a) => (
            <div key={a.id} className="group overflow-hidden rounded border border-ink-100 bg-white">
              <img src={urls[a.id]} alt={a.fileName} className="h-24 w-full object-cover" loading="lazy" />
              <div className="flex items-center justify-between px-1.5 py-1">
                <span className="truncate text-[10px] text-ink-400" title={a.fileName}>
                  {USAGE_LABELS[a.usage]} · {a.width}×{a.height}
                </span>
                <span className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    className="rounded text-[10px] text-violet-600 hover:bg-violet-50"
                    title="插入正文光标处"
                    onClick={() => insert(a)}
                  >
                    插入
                  </button>
                  <button
                    type="button"
                    className="rounded text-[10px] text-red-500 hover:bg-red-50"
                    title="删除"
                    onClick={() => void remove(a)}
                  >
                    删除
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {msg && (
        <div className="border-t border-ink-100 px-2 py-1 text-[11px] text-ink-500">
          {msg}
          <button type="button" className="ml-2 text-violet-600 hover:underline" onClick={() => setMsg(null)}>
            知道了
          </button>
        </div>
      )}
    </div>
  );
}
