/**
 * TaskPanel（P2.1-M4）：浮层任务列表
 * 每项：标题/进度条/detail/取消（running 且 cancellable）/重试（failed 且有 retry）/错误信息；底部"清除已完成"
 */

import { useTaskStore } from '../../store/taskStore';
import { getAppContext } from '../../context/app-context';
import type { TaskInfo } from '../../services/task/types';

const STATUS_LABEL: Record<TaskInfo['status'], string> = {
  running: '运行中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

const STATUS_STYLE: Record<TaskInfo['status'], string> = {
  running: 'bg-violet-50 text-violet-600',
  done: 'bg-emerald-50 text-emerald-600',
  failed: 'bg-red-50 text-red-600',
  cancelled: 'bg-ink-100 text-ink-500'
};

export function TaskPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const tasks = useTaskStore((s) => s.tasks);

  const cancel = (id: string): void => getAppContext().tasks.cancel(id);
  const retry = (id: string): void => {
    getAppContext().tasks.retry(id);
  };

  const sorted = [...tasks].sort((a, b) => {
    const rank = (t: TaskInfo): number => (t.status === 'running' ? 0 : 1);
    return rank(a) - rank(b) || (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt);
  });

  return (
    <>
      <button
        type="button"
        aria-label="关闭任务面板"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div className="absolute bottom-6 left-0 z-50 w-80 rounded-md border border-ink-200 bg-white p-2 shadow-lg">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-medium">任务中心</span>
          <button
            type="button"
            className="rounded px-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            onClick={() => getAppContext().tasks.clearFinished()}
          >
            清除已完成
          </button>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {sorted.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-ink-400">暂无任务</div>
          )}
          {sorted.map((t) => (
            <div key={t.id} className="rounded border border-ink-100 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1 text-[10px] ${STATUS_STYLE[t.status]}`}>
                  {STATUS_LABEL[t.status]}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{t.title}</span>
                {t.status === 'running' && t.cancellable && (
                  <button
                    type="button"
                    className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50"
                    onClick={() => cancel(t.id)}
                  >
                    取消
                  </button>
                )}
                {t.status === 'failed' && (
                  <button
                    type="button"
                    className="rounded border border-ink-200 px-1.5 py-0.5 text-[10px] text-ink-600 hover:bg-ink-100"
                    onClick={() => retry(t.id)}
                    title="重新运行"
                  >
                    重试
                  </button>
                )}
              </div>
              {/* 进度条 */}
              {t.status === 'running' && (
                <div className="mt-1 h-1 overflow-hidden rounded bg-ink-100">
                  {t.progress >= 0 ? (
                    <div
                      className="h-full rounded bg-violet-600 transition-[width]"
                      style={{ width: `${Math.min(100, Math.max(0, t.progress))}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/2 animate-pulse rounded bg-violet-400" />
                  )}
                </div>
              )}
              {t.detail && t.status === 'running' && (
                <div className="mt-0.5 text-[10px] text-ink-400">{t.detail}</div>
              )}
              {t.status === 'failed' && t.error && (
                <div className="mt-0.5 break-all text-[10px] text-red-500">{t.error}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
