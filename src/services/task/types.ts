/**
 * 任务中心类型（P2.1-M4）：长任务注册/进度/取消/重试
 * 任务本身不持久化（内存态）；可恢复性由各功能自己的会话表承担
 */

export type TaskKind =
  | 'longform'
  | 'fact-extract'
  | 'inference'
  | 'consistency'
  | 'batch-embed'
  | 'screenplay'
  | 'storyboard'
  | 'generic';

export type TaskStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface TaskInfo {
  id: string;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  progress: number; // 0-100；未知进度传 -1，UI 显示不确定态
  detail?: string; // "第 3/8 拍" / "正在处理第 12 章"
  cancellable: boolean;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface TaskRunContext {
  report: (progress: number, detail?: string) => void;
  signal: AbortSignal;
}

export interface TaskSpec {
  kind: TaskKind;
  title: string;
  cancellable?: boolean; // 默认 true
  run: (ctx: TaskRunContext) => Promise<void>;
  /** 失败重试动作（通常为重新 register 同一 spec） */
  retry?: () => void;
}
