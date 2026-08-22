/**
 * 剧本控制台（P5，编辑器 rail「工具」组 tab）：240px 内的轻量入口
 * 剧本列表 + 状态/进度 + 打开工作台；不放任何结构化编辑表单（重界面在 overlay）
 */

import { useEffect, useRef, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { alertDialog, confirmDialog } from '../../native/dialog';
import { useTaskStore } from '../../store/taskStore';
import { screenplayStats, type Screenplay, type ScreenplayStatus } from '../../services/screenplay/types';

const STATUS_LABEL: Record<ScreenplayStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-ink-100 text-ink-500' },
  outlining: { label: '大纲中', cls: 'bg-amber-100 text-amber-700' },
  generating: { label: '生成中', cls: 'bg-violet-100 text-violet-700' },
  review: { label: '待确认', cls: 'bg-sky-100 text-sky-700' },
  done: { label: '已完成', cls: 'bg-emerald-100 text-emerald-700' }
};

interface Props {
  bookId: string;
  /** 打开工作台（wizard=true 直接进入转化向导） */
  onOpen: (screenplayId?: string, wizard?: boolean) => void;
}

export function ScreenplayPanel({ bookId, onOpen }: Props): JSX.Element {
  const [list, setList] = useState<Screenplay[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const reload = (): void => {
    void getAppContext()
      .screenplayService.listByBook(bookId)
      .then(setList)
      .catch(() => setList([]));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // 生成任务事件驱动刷新（订阅任务 store 进度签名，节流重拉列表；任务结束终态刷新），替代定时轮询
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
    const fetchList = (): void => {
      lastFetchRef.current = Date.now();
      reload();
    };
    if (running) {
      wasRunningRef.current = true;
      const elapsed = Date.now() - lastFetchRef.current;
      if (elapsed >= 1000) {
        fetchList();
      } else {
        if (trailingRef.current) window.clearTimeout(trailingRef.current);
        trailingRef.current = window.setTimeout(fetchList, 1000 - elapsed);
      }
    } else if (wasRunningRef.current) {
      wasRunningRef.current = false;
      if (trailingRef.current) {
        window.clearTimeout(trailingRef.current);
        trailingRef.current = null;
      }
      fetchList();
    }
    return () => {
      if (trailingRef.current) window.clearTimeout(trailingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskSig]);

  const create = (): void => {
    void (async () => {
      const sp = await getAppContext().screenplayService.create(bookId, `剧本 ${new Date().toLocaleDateString('zh-CN')}`);
      reload();
      onOpen(sp.id);
    })();
  };

  const remove = (sp: Screenplay): void => {
    void confirmDialog(`删除剧本「${sp.title}」？（分镜图保留在图库）`).then((ok) => {
      if (!ok) return;
      void getAppContext()
        .screenplayService.remove(sp.id)
        .then(reload)
        .catch((e) => void alertDialog(`删除失败：${e instanceof Error ? e.message : String(e)}`));
    });
  };

  const commitRename = (sp: Screenplay): void => {
    setRenaming(null);
    const next = renameText.trim();
    if (!next || next === sp.title) return;
    void getAppContext()
      .screenplayService.rename(sp.id, next)
      .then(reload);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
        <span className="text-sm font-medium">剧本</span>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded border border-violet-200 px-1.5 py-0.5 text-[11px] text-violet-600 hover:bg-violet-50"
            onClick={() => onOpen(undefined, true)}
          >
            从章节转化
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600 hover:bg-ink-100"
            onClick={create}
          >
            + 新建
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {list.length === 0 && (
          <div className="rounded border border-dashed border-ink-200 p-4 text-center text-xs leading-5 text-ink-400">
            暂无剧本。「从章节转化」把小说章节改编为剧集剧本，
            支持逐场生成镜头与对白、一键分镜图。
          </div>
        )}
        {list.map((sp) => {
          const stats = screenplayStats(sp);
          const st = STATUS_LABEL[sp.status];
          return (
            <div key={sp.id} className="group mb-1.5 rounded border border-ink-100 bg-white px-2 py-1.5 hover:border-violet-200">
              {renaming === sp.id ? (
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(sp);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={() => commitRename(sp)}
                  className="w-full rounded border border-violet-300 px-1 py-0.5 text-xs outline-none"
                />
              ) : (
                <button
                  type="button"
                  className="block w-full truncate text-left text-xs font-medium text-ink-700"
                  title={sp.title}
                  onClick={() => onOpen(sp.id)}
                >
                  {sp.title}
                </button>
              )}
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`rounded px-1 py-px text-[10px] ${st.cls}`}>{st.label}</span>
                <span className="text-[10px] text-ink-400">
                  {stats.episodes} 集 · {stats.doneScenes}/{stats.scenes} 场
                </span>
                <span className="ml-auto hidden gap-1.5 group-hover:flex">
                  <button
                    type="button"
                    className="text-[10px] text-ink-400 hover:text-violet-600"
                    onClick={() => {
                      setRenaming(sp.id);
                      setRenameText(sp.title);
                    }}
                  >
                    改名
                  </button>
                  <button type="button" className="text-[10px] text-ink-400 hover:text-red-600" onClick={() => remove(sp)}>
                    删除
                  </button>
                </span>
              </div>
              {sp.status === 'generating' && (
                <div className="mt-1 h-1 overflow-hidden rounded bg-ink-100">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{ width: `${stats.scenes > 0 ? Math.round((stats.doneScenes / stats.scenes) * 100) : 0}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-ink-100 px-3 py-2">
        <button
          type="button"
          className="w-full rounded bg-violet-600 py-1.5 text-xs text-white hover:bg-violet-700"
          onClick={() => onOpen(list[0]?.id)}
        >
          打开剧本工作台
        </button>
        <p className="mt-1.5 text-[10px] leading-4 text-ink-400">
          剧本编辑、分镜画板与转化向导在工作台全屏窗口中进行。
        </p>
      </div>
    </div>
  );
}
