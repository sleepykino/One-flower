/**
 * 长文模式类型（P2.1-M7）：章节级"规划-生成-自洽"循环
 * 长文是编排层，循环调用 continue 模式（不新增 AIMode）
 */

export type LongFormStatus = 'ready' | 'running' | 'paused' | 'seam-review' | 'done' | 'aborted';

export interface LongFormBeat {
  id: string;
  text: string;
  targetWords: number; // 默认 500-1200
  status: 'pending' | 'done';
  usedTokens?: number;
  /** 本拍生成正文（接缝自检用；随会话落盘） */
  generatedText?: string;
}

export interface LongFormSession {
  id: string;
  bookId: string;
  chapterId: string;
  status: LongFormStatus;
  beats: LongFormBeat[];
  currentBeatIndex: number;
  usedTokens: number;
  estimatedTokens: number;
  /** 作者补充提示（节拍初稿输入，透传到逐拍生成） */
  hints?: string;
  /** 参与生成的角色卡 id（空 = 生成时默认注入本书全部角色） */
  characterIds?: string[];
  /** 接缝自检结果（序列化落库 seams 列；status=done 后重启仍可展示遗留接缝问题） */
  seams?: SeamIssue[];
  createdAt: number;
  updatedAt: number;
}

export interface SeamIssue {
  beatIndex: number; // 接缝位于第 beatIndex 拍与 beatIndex+1 拍之间（0-based）
  kind: 'tone' | 'address' | 'timeline' | 'repetition' | 'other';
  description: string;
  excerpt: string; // 接缝前后各约 100 字
}

export interface LongFormRunHooks {
  /** 当前拍开始（UI 此刻 startAITemp） */
  onBeatStart?: (beatIndex: number, beat: LongFormBeat) => void;
  /** 流式分片（UI 此刻 appendAITemp） */
  onChunk?: (beatIndex: number, chunk: string) => void;
  /** 当前拍完成（UI 此刻 acceptAITemp 落正文） */
  onBeatDone?: (beatIndex: number, beat: LongFormBeat, fullText: string) => void;
  /** 当前拍被中断（UI 此刻 finishAITemp 走三选项） */
  onBeatInterrupted?: (beatIndex: number) => void;
}
