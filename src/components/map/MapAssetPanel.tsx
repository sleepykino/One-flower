/**
 * 素材库面板（P4.1-M1）：左侧栏「我的素材」区
 * 分类/搜索 + 上传（贴图/瓦片纹理）+ 缩略图网格（点击进入连续放置 / 选为笔刷纹理）
 * 内置 SVG 素材包随首启入库（builtin=1 前置显示）
 */

import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import { MapAssetService, MapAssetReferenceError, type MapAsset, type MapAssetUsage } from '../../services/map/MapAssetService';

interface Props {
  /** 当前选中的贴图引用（'asset:{id}'），与内置图标共用放置模式 */
  selected: string | null;
  onSelect: (ref: string | null) => void;
  /** 瓦片纹理被选中（terrainId 形态 'asset:tile:{id}'） */
  selectedTile: string | null;
  onSelectTile?: (terrainId: string | null) => void;
  /** 素材库发生变化（上传/删除）后通知编辑器重载贴图缓存与瓦片纹理 */
  onChanged?: () => void;
}

const CATEGORIES = ['全部', '地形', '水文', '植被', '聚居', '建筑', '军事', '奇幻', '自定义'];

export function MapAssetPanel(props: Props): JSX.Element {
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [cat, setCat] = useState('全部');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  /** 行内改名（Tauri WebView 无 window.prompt） */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const reload = (notify = false): void => {
    void (async () => {
      try {
        const svc = new MapAssetService(getAppContext().bridge);
        await svc.ensureBuiltin();
        const list = await svc.list({ keyword });
        setAssets(list);
        const map: Record<string, string> = {};
        for (const a of list) {
          try {
            map[a.id] = await svc.resolveUrl(a.id);
          } catch {
            map[a.id] = '';
          }
        }
        setUrls(map);
        if (notify) props.onChanged?.();
      } catch (e) {
        console.warn('[Map] 素材库读取失败:', e);
      }
    })();
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const shown = cat === '全部' ? assets : assets.filter((a) => a.category === cat);
  const stamps = shown.filter((a) => a.usage === 'stamp');
  const tiles = shown.filter((a) => a.usage === 'tile');

  const upload = async (usage: MapAssetUsage): Promise<void> => {
    const files = await open({
      multiple: true,
      filters: [
        {
          name: '图片',
          extensions: usage === 'tile' ? ['png', 'jpg', 'jpeg', 'webp', 'bmp'] : ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg', 'gif']
        }
      ]
    });
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const svc = new MapAssetService(getAppContext().bridge);
      await svc.import(files, '自定义', usage);
      reload(true);
    } catch (e) {
      void toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const removeAsset = (a: MapAsset): void => {
    void (async () => {
      const svc = new MapAssetService(getAppContext().bridge);
      try {
        try {
          await svc.remove(a.id);
        } catch (e) {
          if (e instanceof MapAssetReferenceError) {
            const names = e.refs.slice(0, 5).map((r) => `《${r.bookTitle}》${r.mapName}`).join('、');
            const more = e.refs.length > 5 ? ` 等 ${e.refs.length} 张` : '';
            const ok = await confirmDialog(
              `素材仍被 ${e.refs.length} 张地图引用（${names}${more}）。\n强制删除后这些节点将显示为占位框，确定？`
            );
            if (!ok) return;
            await svc.remove(a.id, true);
          } else {
            throw e;
          }
        }
        reload(true);
      } catch (e) {
        void toast.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  const commitRename = (a: MapAsset): void => {
    const next = renameText.trim();
    setRenamingId(null);
    if (!next || next === a.name) return;
    void new MapAssetService(getAppContext().bridge).rename(a.id, next).then(() => reload());
  };

  const stampRef = (id: string): string => `asset:${id}`;

  return (
    <div>
      <div className="flex items-center gap-1">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索素材…"
          className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 text-xs outline-none focus:border-violet-400"
        />
        <button
          type="button"
          disabled={busy}
          title="上传贴图素材（PNG/JPG/SVG 等，全局跨书共享）"
          className="shrink-0 rounded border border-ink-200 px-1.5 py-1 text-xs text-violet-600 hover:bg-violet-50 disabled:opacity-40"
          onClick={() => void upload('stamp')}
        >
          + 上传
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`rounded px-1.5 py-0.5 text-xs ${
              c === cat ? 'bg-violet-50 text-violet-700' : 'text-ink-500 hover:bg-ink-100'
            }`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {stamps.length === 0 && tiles.length === 0 && (
        <p className="mt-2 text-xs leading-4 text-ink-400">暂无素材，点「+ 上传」导入图片。</p>
      )}

      {stamps.length > 0 && (
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {stamps.map((a) => {
            const sel = props.selected === stampRef(a.id);
            return (
              <div key={a.id} className="group relative">
                <button
                  type="button"
                  title={`${a.name}（点击后在画布放置）`}
                  className={`flex h-12 w-full items-center justify-center overflow-hidden rounded border ${
                    sel ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-300' : 'border-ink-200 hover:bg-ink-100'
                  }`}
                  onClick={() => props.onSelect(sel ? null : stampRef(a.id))}
                >
                  {urls[a.id] ? (
                    <img src={urls[a.id]} alt={a.name} className="max-h-10 max-w-10 object-contain" draggable={false} />
                  ) : (
                    <span className="text-xs text-ink-300">…</span>
                  )}
                </button>
                <div className="absolute inset-x-0 -bottom-4 hidden justify-center gap-1 group-hover:flex">
                  {!a.builtin && (
                    <>
                      <button
                        type="button"
                        className="rounded bg-white/95 px-1 text-[10px] text-ink-500 shadow hover:text-violet-600"
                        onClick={() => {
                          setRenamingId(a.id);
                          setRenameText(a.name);
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="rounded bg-white/95 px-1 text-[10px] text-red-500 shadow"
                        onClick={() => removeAsset(a)}
                      >
                        删
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {renamingId !== null && stamps.some((a) => a.id === renamingId) && (
        <div className="mt-1 flex gap-1">
          <input
            autoFocus
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(stamps.find((a) => a.id === renamingId)!);
              if (e.key === 'Escape') setRenamingId(null);
            }}
            onBlur={() => commitRename(stamps.find((a) => a.id === renamingId)!)}
            className="min-w-0 flex-1 rounded border border-violet-300 px-2 py-1 text-xs outline-none"
            placeholder="素材名称"
          />
        </div>
      )}

      {props.onSelectTile && (
        <div className="mt-2 border-t border-ink-100 pt-1.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-500">瓦片纹理</span>
            <button
              type="button"
              disabled={busy}
              title="上传小图（≤256px）作为自定义地形瓦片"
              className="text-[11px] text-violet-600 hover:underline disabled:opacity-40"
              onClick={() => void upload('tile')}
            >
              + 纹理
            </button>
          </div>
          {tiles.length === 0 ? (
            <p className="text-[11px] leading-4 text-ink-400">上传小图作为笔刷可刷的地形纹理。</p>
          ) : (
            <div className="grid grid-cols-6 gap-1">
              {tiles.map((a) => {
                const terrainId = `asset:tile:${a.id}`;
                const sel = props.selectedTile === terrainId;
                return (
                  <div key={a.id} className="group relative">
                    <button
                      type="button"
                      title={`${a.name}（选为笔刷地形）`}
                      className={`h-7 w-full overflow-hidden rounded border ${
                        sel ? 'border-emerald-500 ring-1 ring-emerald-300' : 'border-ink-200 hover:bg-ink-100'
                      }`}
                      onClick={() => props.onSelectTile?.(sel ? null : terrainId)}
                    >
                      {urls[a.id] ? (
                        <img src={urls[a.id]} alt={a.name} className="h-full w-full object-cover" draggable={false} />
                      ) : (
                        <span className="text-[10px] text-ink-300">…</span>
                      )}
                    </button>
                    <button
                      type="button"
                      title={`删除纹理「${a.name}」`}
                      className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] text-red-500 shadow group-hover:flex hover:bg-red-50"
                      onClick={() => removeAsset(a)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] leading-4 text-ink-400">
        素材全局共享（跨书）；贴图选中后点击画布连续放置，Esc 停止。选中贴图后可在右侧调色（色相/饱和/明度）。
      </p>
    </div>
  );
}
