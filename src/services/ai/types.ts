/** AI 编排类型（AIMode 复用 skill/types 定义） */

export type { AIMode } from '../skill/types';

import type { ProseMirrorDoc } from '../../types';
import type { ChatMessage } from './providers/LLMProvider';
import type { ChapterBeat } from '../chapter/ChapterService';

export type { ChapterBeat };

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

/** 错字检查（P2.1）：当前章节错别字校对结果 */
export interface TypoItem {
  original: string; // 含错字的原文片段（须与正文逐字一致，用于定位与替换）
  suggestion: string; // 修正后的完整片段
  reason: string; // 错误原因简述
}

export interface TypoReport {
  typos: TypoItem[];
  checkedAt: number;
}

/** P2.1-M2：文档内的引用标记（orchestrator 解析为 ForcedReference 全文注入） */
export interface AiReference {
  refType: 'character' | 'worldbook' | 'chapter';
  refId: string;
  label: string;
}

export interface ContinueParams {
  bookId: string;
  chapterId: string;
  currentContent: string;
  recentChapters: ChapterContent[];
  selectedCharacterIds: string[];
  /** 续写要求（可选），如"主角识破陷阱，引出幕后黑手" */
  requirement?: string;
  /** P7.3-M1：多轮会话历史（可选；开启多轮会话的续写注入此前的 user/assistant 轮次） */
  history?: ChatMessage[];
  /** M2: 当前文档的引用标记，orchestrator 解析全文注入 forcedRefs */
  aiReferences?: AiReference[];
  /** M5: 当前应执行的节拍（AIPanel 按 beats 与开关填充） */
  beat?: ChapterBeat;
  /** 批次11-6：本次续写注入角色卡的 token 预算覆盖（默认取 PromptAssembler characters 预算；长文模式下放大以承载全文角色） */
  characterBudget?: number;
  /** 三路检索 query 覆盖：默认取 currentContent 末尾；长文模式下并入拍文本/大纲以提升召回 */
  ragQuery?: string;
  /** 单次回复的 token 上限（约等于中文字数）；P7.6：显式 maxTokens 优先于 targetWords 换算（长文模式直传） */
  maxTokens?: number;
  /** P7.6：本次生成目标字数（提示词注入「篇幅要求」+ maxTokens 动态换算 + 流式优雅停） */
  targetWords?: number;
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
  /** M2: 当前文档的引用标记 */
  aiReferences?: AiReference[];
  /** 单次回复的 token 上限（约等于中文字数）；P7.6：显式 maxTokens 优先于 targetWords 换算 */
  maxTokens?: number;
  /** P7.6：本次生成目标字数（提示词注入「篇幅要求」+ maxTokens 动态换算 + 流式优雅停） */
  targetWords?: number;
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
  /** M2: 当前文档的引用标记 */
  aiReferences?: AiReference[];
  /** 单次回复的 token 上限（约等于中文字数），默认 4096；P7.6：显式 maxTokens 优先于 targetWords 换算 */
  maxTokens?: number;
  /** P7.6：本次生成目标字数（提示词注入「篇幅要求」+ maxTokens 动态换算 + 流式优雅停） */
  targetWords?: number;
  /** 采样温度，默认 0.9 */
  temperature?: number;
  signal?: AbortSignal;
}

export interface CheckParams {
  bookId: string;
  chapterId: string;
  chapterContent: string;
  /** M2: 当前文档的引用标记 */
  aiReferences?: AiReference[];
  signal?: AbortSignal;
}

export interface TypoCheckParams {
  bookId: string;
  chapterId: string;
  chapterContent: string;
  signal?: AbortSignal;
}

export type { ProseMirrorDoc };
