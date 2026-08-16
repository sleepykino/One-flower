/** AI 编排类型（AIMode 复用 skill/types 定义） */

export type { AIMode } from '../skill/types';

import type { ProseMirrorDoc } from '../../types';

export interface Character {
  id: string;
  name: string;
  data: Record<string, unknown>; // 按 schema 结构化
  tags: string[];
}

export interface ChapterContent {
  id: string;
  title: string;
  outline?: string;
  content: string; // 纯文本或简化 HTML
}

export interface WorldbookEntryRef {
  id: string;
  title: string;
  category: string | null;
  content: string;
}

export interface ConsistencyReport {
  contradictions: Array<{
    severity: 'high' | 'medium' | 'low';
    description: string; // "第 12 行说主角蓝眼睛，但角色卡是黑眼睛"
    relatedSetting: string; // 关联的角色卡/世界书条目
    chapterExcerpt: string; // 章节中的原文片段
  }>;
  checkedAt: number;
}

export interface ContinueParams {
  bookId: string;
  chapterId: string;
  currentContent: string;
  recentChapters: ChapterContent[];
  selectedCharacterIds: string[];
  /** 续写要求（可选），如"主角识破陷阱，引出幕后黑手" */
  requirement?: string;
  /** 单次回复的 token 上限（约等于中文字数） */
  maxTokens?: number;
  /** 采样温度，默认 0.85 */
  temperature?: number;
  signal?: AbortSignal;
}

export interface RewriteParams {
  bookId: string;
  chapterId: string;
  selectedText: string;
  instruction: string; // 如"改为更紧张的氛围"
  recentChapters: ChapterContent[];
  /** 单次回复的 token 上限（约等于中文字数） */
  maxTokens?: number;
  /** 采样温度，默认 0.7 */
  temperature?: number;
  signal?: AbortSignal;
}

export interface DialogueParams {
  bookId: string;
  chapterId: string;
  scene: string; // 场景描述
  characterIds: string[]; // 参与对话的角色
  recentChapters: ChapterContent[];
  /** 单次回复的 token 上限（约等于中文字数），默认 4096 */
  maxTokens?: number;
  /** 采样温度，默认 0.9 */
  temperature?: number;
  signal?: AbortSignal;
}

export interface CheckParams {
  bookId: string;
  chapterId: string;
  chapterContent: string;
  signal?: AbortSignal;
}

export type { ProseMirrorDoc };
