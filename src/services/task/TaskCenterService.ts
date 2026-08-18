/**
 * TaskCenterService（P2.1-M4）：长任务注册/进度上报/取消/失败重试/清除
 * 内存态运行时；AbortController 内部管理，subscribe 推送快照数组
 */

import type { TaskInfo, TaskRunContext, TaskSpec } from './types';

interface InternalTask {
  info: TaskInfo;
  spec: TaskSpec;
  controller: AbortController;
}

export class TaskCenterService {
  private tasks = new Map<string, InternalTask>();
  private listeners = new Set<(tasks: TaskInfo[]) => void>();

  /** 同步注册并异步启动 run；run 抛错 -> failed，cancel -> cancelled */
  register(spec: TaskSpec): TaskInfo {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const info: TaskInfo = {
      id,
      kind: spec.kind,
      title: spec.title,
      status: 'running',
      progress: -1,
      cancellable: spec.cancellable ?? true,
      startedAt: Date.now()
    };
    this.tasks.set(id, { info, spec, controller });
    this.emit();

    const ctx: TaskRunContext = {
      report: (progress, detail) => {
        const t = this.tasks.get(id);
        if (!t || t.info.status !== 'running') return;
        t.info = { ...t.info, progress, detail: detail ?? t.info.detail };
        this.emit();
      },
      signal: controller.signal
    };

    void (async () => {
      try {
        await spec.run(ctx);
        this.finish(id, 'done');
      } catch (e) {
        const aborted =
          controller.signal.aborted || (e instanceof Error && e.name === 'AbortError');
        if (aborted) {
          this.finish(id, 'cancelled');
        } else {
          this.finish(id, 'failed', e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return { ...info };
  }

  list(): TaskInfo[] {
    return [...this.tasks.values()].map((t) => ({ ...t.info }));
  }

  /** 触发内部 AbortController.abort()（run 内部遵循 signal） */
  cancel(id: string): void {
    const t = this.tasks.get(id);
    if (t && t.info.status === 'running' && t.info.cancellable) {
      t.controller.abort();
    }
  }

  /** 调用 spec.retry（通常为重新 register 同一 spec），无 retry 返回 false */
  retry(id: string): boolean {
    const t = this.tasks.get(id);
    if (!t || t.info.status !== 'failed' || !t.spec.retry) return false;
    // 移除失败记录后由 retry 重新注册（避免同 id 复用）
    this.tasks.delete(id);
    this.emit();
    t.spec.retry();
    return true;
  }

  /** 清除 done/failed/cancelled 记录 */
  clearFinished(): void {
    let changed = false;
    for (const [id, t] of this.tasks) {
      if (t.info.status !== 'running') {
        this.tasks.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  subscribe(fn: (tasks: TaskInfo[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => {
      this.listeners.delete(fn);
    };
  }

  private finish(id: string, status: 'done' | 'failed' | 'cancelled', error?: string): void {
    const t = this.tasks.get(id);
    if (!t) return;
    t.info = { ...t.info, status, finishedAt: Date.now(), error };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.list();
    for (const fn of this.listeners) {
      try {
        fn(snapshot);
      } catch (e) {
        console.warn('[TaskCenter] subscriber error:', e);
      }
    }
  }
}
