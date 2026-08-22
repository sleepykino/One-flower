/**
 * 分镜画板视图（P5-M3，工作台 overlay 内）：选集 + 镜头卡片网格 + 批量生成
 * 单镜 2 候选挑选后入库；批量走任务中心（刷新由 Workbench 统一轮询，本视图不自轮询）
 * 图源与封面对齐：AI 生成 / 本地上传 / 从图库选 / 清除
 */

import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { alertDialog } from '../../native/dialog';
import { useTaskStore } from '../../store/taskStore';
import { SHOT_SIZE_LABEL, type Screenplay, type Scene, type Shot } from '../../services/screenplay/types';
import type { GeneratedImage } from '../../services/ai/providers/ImageProvider';
import type { ImageAsset } from '../../services/image/types';

interface Props {
  bookId: string;
  screenplay: Screenplay;
  onChanged: () => void;
}

interface FlatShot {
  scene: Scene;
  shot: Shot;
  epNumber: number;
}

/** 单镜候选挑选浮层 */
function CandidatePicker({
  candidates,
  onPick,
  onCancel
}: {
  candidates: Array<{ url: string; image: GeneratedImage }>;
  onPick: (image: GeneratedImage) => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="rounded-lg bg-white p-3 shadow-2xl">
        <div className="mb-2 text-sm font-medium">选择一张分镜图（共 {candidates.length} 候选）</div>
        <div className="flex gap-2">
          {candidates.map((c, i) => (
            <button
              key={i}
              type="button"
              className="overflow-hidden rounded border-2 border-ink-100 hover:border-violet-400"
              onClick={() => onPick(c.image)}
            >
              <img src={c.url} alt={`候选 ${i + 1}`} className="h-48 w-auto object-contain" />
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-end">
          <button type="button" className="rounded border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/** 图库挑选浮层（从本书已有图片中选一张作为分镜图） */
function LibraryPicker({
  bookId,
  onPick,
  onCancel
}: {
  bookId: string;
  onPick: (assetId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      try {
        const { imageAssetService } = getAppContext();
        const list = await imageAssetService.listByBook(bookId);
        setImages(list);
        const entries = await Promise.all(
          list.map(async (a) => [a.id, await imageAssetService.resolveUrl(a)] as const)
        );
        setUrls(Object.fromEntries(entries));
      } catch {
        setImages([]);
      }
    })();
  }, [bookId]);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[80vh] w-[640px] flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
          <span className="text-sm font-medium">从图库选择（本书全部图片）</span>
          <button type="button" className="text-xs text-ink-400 hover:text-ink-700" onClick={onCancel}>
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {images.length === 0 && <div className="py-8 text-center text-xs text-ink-400">图库暂无图片</div>}
          <div className="grid grid-cols-4 gap-2">
            {images.map((a) => (
              <button
                key={a.id}
                type="button"
                className="overflow-hidden rounded border border-ink-100 hover:border-violet-400"
                onClick={() => onPick(a.id)}
              >
                <img src={urls[a.id]} alt={a.fileName} className="h-24 w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function StoryboardView({ bookId, screenplay, onChanged }: Props): JSX.Element {
  const [epIdx, setEpIdx] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [generatingShotId, setGeneratingShotId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<{ url: string; image: GeneratedImage; shot: Shot }> | null>(null);
  const [libraryFor, setLibraryFor] = useState<Shot | null>(null);
  /** 批量任务运行态来自任务 store（刷新由 Workbench 统一轮询） */
  const running = useTaskStore((s) => s.tasks.some((t) => t.kind === 'storyboard' && t.status === 'running'));

  const episodes = screenplay.data.episodes;
  const ep = episodes[Math.min(epIdx, Math.max(0, episodes.length - 1))];
  const shots = useMemo<FlatShot[]>(
    () =>
      (ep?.scenes ?? []).flatMap((sc) =>
        sc.shots.map((st) => ({ scene: sc, shot: st, epNumber: ep?.number ?? 1 }))
      ),
    [ep]
  );
  const missing = shots.filter((x) => !x.shot.imageAssetId).length;

  /** 分镜图 URL 解析（images 表 + asset 协议）；内容无变化时跳过 setState，避免轮询期间无谓重渲染 */
  useEffect(() => {
    void (async () => {
      const { db, imageAssetService } = getAppContext();
      const map: Record<string, string> = {};
      for (const { shot } of shots) {
        if (!shot.imageAssetId || map[shot.imageAssetId]) continue;
        try {
          const row = await db.queryOne<{ book_id: string; file_name: string }>(
            'SELECT book_id, file_name FROM images WHERE id = ?',
            [shot.imageAssetId]
          );
          if (row) {
            map[shot.imageAssetId] = await imageAssetService.resolveUrl({
              bookId: String(row.book_id),
              fileName: String(row.file_name)
            } as never);
          }
        } catch {
          /* 单图失败跳过 */
        }
      }
      setUrls((prev) => (JSON.stringify(prev) === JSON.stringify(map) ? prev : map));
    })();
  }, [shots]);

  const generateOne = (item: FlatShot): void => {
    setGeneratingShotId(item.shot.id);
    void (async () => {
      try {
        const { storyboardService } = getAppContext();
        const { images } = await storyboardService.generateCandidates(bookId, item.scene, item.shot);
        setCandidates(
          images.map((image) => ({
            url: URL.createObjectURL(new Blob([image.bytes as unknown as BlobPart], { type: image.mimeType })),
            image,
            shot: item.shot
          }))
        );
      } catch (e) {
        void alertDialog(`分镜图生成失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setGeneratingShotId(null);
      }
    })();
  };

  const pick = (image: GeneratedImage, shot: Shot): void => {
    const item = shots.find((x) => x.shot.id === shot.id);
    if (!item) return;
    void (async () => {
      try {
        const { storyboardService } = getAppContext();
        const prompt = await storyboardService.buildShotPrompt(bookId, item.scene, shot);
        await storyboardService.saveShotImage(bookId, screenplay.id, shot, image, prompt);
        setCandidates(null);
        onChanged();
      } catch (e) {
        void alertDialog(`保存失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  /** 本地上传图片作为该镜分镜图（与封面上传同链路：入库 usage='storyboard'） */
  const uploadFor = (shot: Shot): void => {
    void (async () => {
      try {
        const file = await open({
          multiple: false,
          filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
        });
        if (!file || typeof file !== 'string') return;
        const { imageAssetService, screenplayService } = getAppContext();
        const asset = await imageAssetService.importFromFile(bookId, file, 'storyboard', shot.id);
        await screenplayService.setShotImage(screenplay.id, shot.id, asset.id);
        onChanged();
      } catch (e) {
        void alertDialog(`上传失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  /** 从图库选图回填 */
  const pickFromLibrary = (shot: Shot, assetId: string): void => {
    void getAppContext()
      .screenplayService.setShotImage(screenplay.id, shot.id, assetId)
      .then(() => {
        setLibraryFor(null);
        onChanged();
      })
      .catch((e) => void alertDialog(`回填失败：${e instanceof Error ? e.message : String(e)}`));
  };

  const clearImage = (shot: Shot): void => {
    void getAppContext()
      .screenplayService.setShotImage(screenplay.id, shot.id, undefined, undefined)
      .then(onChanged);
  };

  const generateMissing = (): void => {
    if (missing === 0) return;
    try {
      getAppContext().storyboardService.generateMissing(bookId, screenplay.id);
    } catch (e) {
      void alertDialog(`启动批量生成失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部：选集 + 批量 */}
      <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2">
        <select
          className="rounded border border-ink-200 px-2 py-1 text-sm"
          value={String(epIdx)}
          onChange={(e) => setEpIdx(Number(e.target.value))}
        >
          {episodes.map((e, i) => (
            <option key={e.id} value={String(i)}>
              第 {e.number} 集{e.title ? `：${e.title}` : ''}（{e.scenes.reduce((n, s) => n + s.shots.length, 0)} 镜）
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-400">
          共 {shots.length} 镜 · 缺图 {missing}
        </span>
        <button
          type="button"
          className={`ml-auto rounded px-3 py-1 text-sm ${
            missing > 0 && !running
              ? 'bg-violet-600 text-white hover:bg-violet-700'
              : 'border border-ink-200 text-ink-400'
          }`}
          disabled={missing === 0 || running}
          onClick={generateMissing}
        >
          {running ? '批量生成中…' : `AI 批量补图（${missing}）`}
        </button>
      </div>

      {/* 卡片网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {shots.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">
            本集暂无镜头（先在剧本编辑视图完成逐场生成）
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 2xl:grid-cols-4">
          {shots.map((item) => {
            const { shot, scene } = item;
            const url = shot.imageAssetId ? urls[shot.imageAssetId] : undefined;
            return (
              <div key={shot.id} className="group overflow-hidden rounded-lg border border-ink-100 bg-white">
                <div className="relative h-36 bg-ink-50">
                  {url ? (
                    <img src={url} alt={`镜 ${shot.number}`} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                      <button
                        type="button"
                        disabled={generatingShotId !== null}
                        className="flex items-center gap-1 text-xs text-violet-600 hover:underline disabled:opacity-40"
                        onClick={() => generateOne(item)}
                      >
                        {generatingShotId === shot.id ? (
                          <>
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
                            生成中…
                          </>
                        ) : (
                          '⚡ AI 生成分镜图（2 候选）'
                        )}
                      </button>
                      <div className="flex items-center gap-2 text-[11px] text-ink-400">
                        <button type="button" className="hover:text-violet-600" onClick={() => uploadFor(shot)}>
                          上传图片
                        </button>
                        <span>·</span>
                        <button type="button" className="hover:text-violet-600" onClick={() => setLibraryFor(shot)}>
                          从图库选
                        </button>
                      </div>
                    </div>
                  )}
                  {/* 已有图时悬停操作条（与封面图源一致的选项） */}
                  {url && (
                    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-black/50 px-1 py-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-violet-600 shadow hover:bg-white"
                        onClick={() => generateOne(item)}
                      >
                        重新生成
                      </button>
                      <button
                        type="button"
                        className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-ink-600 shadow hover:bg-white"
                        onClick={() => uploadFor(shot)}
                      >
                        上传
                      </button>
                      <button
                        type="button"
                        className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-ink-600 shadow hover:bg-white"
                        onClick={() => setLibraryFor(shot)}
                      >
                        图库
                      </button>
                      <button
                        type="button"
                        className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-red-500 shadow hover:bg-white"
                        onClick={() => clearImage(shot)}
                      >
                        清除
                      </button>
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                      镜 {shot.number}
                    </span>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                      {shot.size} {SHOT_SIZE_LABEL[shot.size]}
                    </span>
                    {shot.camera && (
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">{shot.camera}</span>
                    )}
                    {shot.durationSec !== undefined && (
                      <span className="ml-auto text-[10px] text-ink-400">{shot.durationSec}s</span>
                    )}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-600" title={shot.description}>
                    {shot.description || '（无描述）'}
                  </div>
                  {shot.dialogue.length > 0 && (
                    <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-ink-400">
                      {shot.dialogue.map((d) => `${d.character}：${d.line}`).join(' / ')}
                    </div>
                  )}
                  <div className="mt-1 truncate text-[10px] text-ink-300" title={`${scene.interior}.${scene.location}`}>
                    {scene.interior}.{scene.location} · {scene.timeOfDay}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 候选挑选 */}
      {candidates && candidates.length > 0 && (
        <CandidatePicker
          candidates={candidates}
          onPick={(img) => pick(img, candidates[0].shot)}
          onCancel={() => setCandidates(null)}
        />
      )}
      {/* 图库挑选 */}
      {libraryFor && (
        <LibraryPicker
          bookId={bookId}
          onPick={(assetId) => pickFromLibrary(libraryFor, assetId)}
          onCancel={() => setLibraryFor(null)}
        />
      )}
    </div>
  );
}
