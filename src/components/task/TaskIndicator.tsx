/**
 * TaskIndicator（P2.1-M4）：底部状态栏任务指示器
 * 进行中任务数徽标 + 当前任务微进度条；仅存在运行中/失败任务时显示
 * （done 任务常驻不再占入口——2026-08-25 改进项闭环；失败任务保留以便重试）
 */

import { useState } from 'react';
import { useTaskStore } from '../../store/taskStore';
import { TaskPanel } from './TaskPanel';

export function TaskIndicator(): JSX.Element | null {
  const tasks = useTaskStore((s) => s.tasks);
  const [panelOpen, setPanelOpen] = useState(false);

  const running = tasks.filter((t) => t.status === 'running');
  const failed = tasks.some((t) => t.status === 'failed');
  // 无运行中/失败任务时隐藏（残留 done 任务不占指示器；失败任务保留入口以便重试）
  if (running.length === 0 && !failed && !panelOpen) return null;

  const current = running[0];
  const pct = current ? current.progress : -1;

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-ink-100"
        title="打开任务中心"
        onClick={() => setPanelOpen((v) => !v)}
      >
        <span
          className={`relative flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-medium text-white ${
            failed && running.length === 0 ? 'bg-red-500' : 'bg-violet-600'
          }`}
        >
          {running.length}
          {running.length > 0 && (
            <span className="absolute inset-0 animate-ping rounded-full bg-violet-400" />
          )}
        </span>
        {current && (
          <span className="max-w-[220px] truncate">
            {current.title}
            {current.detail ? ` · ${current.detail}` : ''}
          </span>
        )}
        {/* 微进度条：-1 为不确定态 */}
        {current && (
          <span className="h-1.5 w-16 overflow-hidden rounded bg-ink-100">
            {pct >= 0 ? (
              <span
                className="block h-full rounded bg-violet-600 transition-[width]"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            ) : (
              <span className="block h-full w-1/2 animate-pulse rounded bg-violet-400" />
            )}
          </span>
        )}
      </button>
      {panelOpen && <TaskPanel onClose={() => setPanelOpen(false)} />}
    </div>
  );
}
