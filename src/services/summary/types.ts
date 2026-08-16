/** 章节摘要链类型定义 */

export interface ChapterSummary {
  chapterId: string;
  title: string;
  summary: string;
  generatedAt: number;
}

export interface SummaryProgress {
  chapterId: string;
  title: string;
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
}

/** 前情上下文：前 N 章摘要 + 最近 2 章原文 */
export interface RecentContext {
  summaries: ChapterSummary[]; // 远 -> 近
  recentChapters: Array<{ id: string; title: string; content: string }>; // 远 -> 近
}
