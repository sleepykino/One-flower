/**
 * 剧本工作台（P5，94vh 全屏 overlay，对齐 MapEditor 交互模式）
 * 顶部：剧本选择 + 视图切换（剧本编辑/分镜画板）+ 保存状态 + 导出（Fountain/分镜表）+ 关闭
 * 内部：ScreenplayEditor / StoryboardView / AdaptWizard（居中对话框）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { toast } from '../common/toast';
import { useEditorStore } from '../../store/editorStore';
import { useTaskStore } from '../../store/taskStore';
import type { Chapter } from '../../types';
import type { Screenplay } from '../../services/screenplay/types';
import { screenplayStats } from '../../services/screenplay/types';
import { ScreenplayEditor } from './ScreenplayEditor';
import { StoryboardView } from './StoryboardView';
import { AdaptWizard } from './AdaptWizard';

interface Props {
  bookId: string;
  initialScreenplayId?: string;
  initialWizard?: boolean;
  onClose: () => void;
}

export function ScreenplayWorkbench({ bookId, initialScreenplayId, initialWizard, onClose }: Props): JSX.Element {
  const [list, setList] = useState<Screenplay[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(initialScreenplayId ?? null);
  const [screenplay, setScreenplay] = useState<Screenplay | null>(null);
  const [view, setView] = useState<'edit' | 'board'>('edit');
  const [wizardOpen, setWizardOpen] = useState(initialWizard ?? false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [savedAt, setSavedAt] = useState(0);

  const reloadList = useCallback((): void => {
    void getAppContext()
      .screenplayService.listByBook(bookId)
      .then((l) => {
        setList(l);
        setCurrentId((prev) => (prev && l.some((sp) => sp.id === prev) ? prev : (l[0]?.id ?? null)));
      })
      .catch(() => setList([]));
  }, [bookId]);

  const reloadCurrent = useCallback((): void => {
    if (!currentId) {
      setScreenplay(null);
      return;
    }
    void getAppContext()
      .screenplayService.get(currentId)
      .then((sp) => setScreenplay(sp))
      .catch(() => setScreenplay(null));
  }, [currentId]);

  /** 局部刷新：编辑/回填操作用服务返回值原地更新，免去全量重拉（高频路径） */
  const applyUpdate = useCallback((sp: import('../../services/screenplay/types').Screenplay): void => {
    setScreenplay(sp);
    setList((prev) => prev.map((x) => (x.id === sp.id ? sp : x)));
  }, []);

  useEffect(() => {
    reloadList();
  }, [reloadList]);

  useEffect(() => {
    reloadCurrent();
  }, [reloadCurrent]);

  useEffect(() => {
    void getAppContext()
      .chapterService.listTreeOrder(bookId)
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [bookId]);

  /** 生成任务事件驱动刷新：订阅任务 store 的进度签名，节流重拉当前剧本；
      任务结束时做一次终态刷新（剧本 status / 列表同步），替代定时轮询 */
  const taskSig = useTaskStore((s) =>
    s.tasks
      .filter((t) => t.kind === 'screenplay' || t.kind === 'storyboard')
      .map((t) => `${t.id}:${t.status}:${t.progress}`)
      .join('|')
  );
  const lastFetchRef = useRef(0);
  const trailingRef = useRef<number | null>(null);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    const running = useTaskStore
      .getState()
      .tasks.some((t) => (t.kind === 'screenplay' || t.kind === 'storyboard') && t.status === 'running');
    if (running) {
      wasRunningRef.current = true;
      // 节流：1s 内的连续进度事件合并为一次尾部重拉
      const elapsed = Date.now() - lastFetchRef.current;
      if (elapsed >= 1000) {
        lastFetchRef.current = Date.now();
        reloadCurrent();
      } else {
        if (trailingRef.current) window.clearTimeout(trailingRef.current);
        trailingRef.current = window.setTimeout(
          () => {
            lastFetchRef.current = Date.now();
            reloadCurrent();
          },
          1000 - elapsed
        );
      }
    } else if (wasRunningRef.current) {
      wasRunningRef.current = false;
      if (trailingRef.current) {
        window.clearTimeout(trailingRef.current);
        trailingRef.current = null;
      }
      reloadCurrent();
      reloadList();
    }
    return () => {
      if (trailingRef.current) window.clearTimeout(trailingRef.current);
    };
  }, [taskSig, reloadCurrent, reloadList]);

  const stats = screenplay ? screenplayStats(screenplay) : null;

  const createBlank = (): void => {
    void (async () => {
      const sp = await getAppContext().screenplayService.create(bookId, `剧本 ${new Date().toLocaleDateString('zh-CN')}`);
      reloadList();
      setCurrentId(sp.id);
    })();
  };

  const jumpChapter = (chapterId: string): void => {
    useEditorStore.getState().setCurrentChapter(chapterId);
    onClose();
  };

  const exportFountain = (): void => {
    if (!screenplay) return;
    void (async () => {
      const target = await saveDialog({
        defaultPath: `${screenplay.title.replace(/[\\/:*?"<>|]/g, '_')}.fountain`,
        filters: [{ name: 'Fountain 剧本', extensions: ['fountain', 'txt'] }]
      });
      if (!target || typeof target !== 'string') return;
      try {
        await getAppContext().screenplayService.exportFountain(screenplay.id, target);
        setSavedAt(Date.now());
        void toast.success(`已导出 Fountain：${target}`);
      } catch (e) {
        void toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  const exportStoryboard = (): void => {
    if (!screenplay) return;
    void (async () => {
      const target = await saveDialog({
        defaultPath: `${screenplay.title.replace(/[\\/:*?"<>|]/g, '_')}-分镜表.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (!target || typeof target !== 'string') return;
      try {
        await getAppContext().screenplayService.exportStoryboardMarkdown(screenplay.id, target);
        void toast.success(`已导出分镜表：${target}`);
      } catch (e) {
        void toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  const generatePending = (): void => {
    if (!screenplay) return;
    if (screenplay.status === 'generating') return;
    if (screenplay.data.episodes.length === 0) {
      setWizardOpen(true);
      return;
    }
    getAppContext().screenplayAdapt.generateScenes(screenplay.id);
    reloadCurrent();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[94vh] w-[min(1500px,97vw)] flex-col overflow-hidden rounded bg-white shadow-2xl">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-semibold">剧本工作台</span>
            <select
              value={currentId ?? ''}
              className="min-w-0 max-w-48 truncate rounded border border-ink-200 px-1.5 py-0.5 text-xs outline-none hover:border-violet-300"
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__new__') {
                  e.target.value = currentId ?? '';
                  createBlank();
                } else if (v === '__wizard__') {
                  e.target.value = currentId ?? '';
                  setWizardOpen(true);
                } else {
                  setCurrentId(v);
                }
              }}
            >
              {!currentId && <option value="">（暂无剧本）</option>}
              {list.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.title}
                </option>
              ))}
              <option value="__new__">＋ 新建空白剧本…</option>
              <option value="__wizard__">⚡ 从章节转化…</option>
            </select>
            {screenplay && stats && (
              <span className="shrink-0 text-xs text-ink-400">
                {stats.episodes} 集 · {stats.doneScenes}/{stats.scenes} 场 · {stats.shotsWithImage}/{stats.shots} 镜有图
                {screenplay.status === 'generating' && (
                  <span className="ml-1 rounded bg-violet-100 px-1.5 py-px text-[10px] text-violet-700">生成中</span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* 视图切换 */}
            <div className="flex rounded border border-ink-200 bg-ink-50 p-0.5 text-xs" data-tour="screenplay-tabs">
              <button
                type="button"
                className={`rounded px-2.5 py-1 ${view === 'edit' ? 'bg-white font-medium text-violet-700 shadow-sm' : 'text-ink-500'}`}
                onClick={() => setView('edit')}
              >
                剧本编辑
              </button>
              <button
                type="button"
                data-tour="screenplay-storyboard"
                className={`rounded px-2.5 py-1 ${view === 'board' ? 'bg-white font-medium text-violet-700 shadow-sm' : 'text-ink-500'}`}
                onClick={() => setView('board')}
              >
                分镜画板
              </button>
            </div>
            <button
              type="button"
              data-tour="screenplay-export"
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
              onClick={exportFountain}
              disabled={!screenplay}
              title="导出 Fountain 格式剧本（专业剧本工具可识别）"
            >
              导出剧本
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
              onClick={exportStoryboard}
              disabled={!screenplay}
              title="导出 Markdown 分镜表（含 storyboard/ 图片目录）"
            >
              导出分镜表
            </button>
            <button type="button" className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100" onClick={onClose} title="关闭">
              ×
            </button>
          </div>
        </div>

        {/* 内容区 */}
        {screenplay ? (
          view === 'edit' ? (
            <ScreenplayEditor
              bookId={bookId}
              screenplay={screenplay}
              onChanged={reloadCurrent}
              onUpdated={applyUpdate}
              onJumpChapter={jumpChapter}
              onGeneratePending={generatePending}
            />
          ) : (
            <StoryboardView bookId={bookId} screenplay={screenplay} onChanged={reloadCurrent} onUpdated={applyUpdate} />
          )
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm text-ink-400">
            暂无剧本或未选择
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-violet-600 px-4 py-1.5 text-sm text-white hover:bg-violet-700"
                onClick={() => setWizardOpen(true)}
              >
                从章节转化
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 px-4 py-1.5 text-sm hover:bg-ink-100"
                onClick={createBlank}
              >
                新建空白剧本
              </button>
            </div>
          </div>
        )}

        {/* 转化向导（居中对话框） */}
        {wizardOpen && (
          <AdaptWizard
            bookId={bookId}
            chapters={chapters}
            onClose={() => setWizardOpen(false)}
            onStarted={(spId) => {
              setWizardOpen(false);
              setCurrentId(spId);
              setView('edit');
              reloadList();
            }}
          />
        )}

        {savedAt > 0 && (
          <div className="pointer-events-none absolute bottom-3 right-4 rounded bg-white/95 px-2 py-1 text-xs text-emerald-600 shadow">
            已导出 ✓
          </div>
        )}
      </div>
    </div>
  );
}
