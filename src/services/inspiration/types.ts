/**
 * P2.1-B 灵感激发包：共享类型
 * - M1 故事种子 / M2 每日卡片 / M3 角色采访 / M4 推演报告 / M5 多视角重写
 * - 灵感库统一存 inspirations 表（content 为 JSON 序列化的完整内容）
 */

import type { ChatChunk } from '../ai/providers/LLMProvider';

/** 灵感库条目类型（inspirations.type） */
export type InspirationType = 'seed' | 'card' | 'whatif_report' | 'interview_summary';

/** 灵感库条目（inspirations 表行映射） */
export interface InspirationItem {
  id: string;
  bookId: string | null; // NULL 为全局（种子/收藏卡片）
  type: InspirationType;
  title: string | null;
  content: string; // JSON：StorySeed / InspirationCard / WhatIfReport / 采访摘要
  tags: string | null; // JSON array string
  source: 'builtin' | 'ai';
  favorited: boolean;
  metadata: string | null; // JSON：额外元数据（genre/elements/所属书籍名等）
  createdAt: number;
}

/** 类型中文标签 */
export const INSPIRATION_TYPE_LABEL: Record<InspirationType, string> = {
  seed: '故事种子',
  card: '灵感卡片',
  whatif_report: '推演报告',
  interview_summary: '采访摘要'
};

// ============ M1 故事种子 ============

export interface StorySeed {
  id: string;
  title: string; // 种子标题，如"轮回剑客"
  logline: string; // 一句话钩子
  expansion: string; // 3-5 句话扩展
  conflictPoints: string[]; // 关键冲突点
  possibleEndings: string[]; // 潜在结局方向
  genre: string; // 题材标签
  elements: string[]; // 输入元素
  tone: string; // 语气：serious/absurd/warm/dark
  createdAt: number;
  favorited: boolean;
}

export interface SeedGenParams {
  genre: string; // 武侠/科幻/奇幻/悬疑/都市...
  elements: string[]; // 元素组合，如 ["时间循环", "复仇", "背叛"]
  count: number; // 生成数量，默认 5
  tone?: string; // 语气，默认 serious
  hints?: string; // 额外提示
  signal?: AbortSignal;
}

/** 随机生成参数（骰子按钮，AI 提供随机题材 + 元素组合） */
export interface RandomSeedParams {
  genre: string;
  elements: string[];
  reason: string; // 组合理由（一句话，帮助用户理解这组搭配的火花）
}

export const SEED_TONES: Array<{ value: string; label: string }> = [
  { value: 'serious', label: '严肃' },
  { value: 'absurd', label: '荒诞' },
  { value: 'warm', label: '温暖' },
  { value: 'dark', label: '黑暗' }
];

// ============ M2 每日灵感卡片 ============

export type CardType =
  | 'technique'
  | 'scene_example'
  | 'character_angle'
  | 'narrative'
  | 'opening'
  | 'quote';

export const CARD_TYPE_LABEL: Record<CardType, string> = {
  technique: '写作技法',
  scene_example: '场景范例',
  character_angle: '人物刻画角度',
  narrative: '叙事手法',
  opening: '经典开头',
  quote: '写作格言'
};

export interface InspirationCard {
  id: string;
  type: CardType;
  title: string;
  content: string; // 卡片正文（Markdown）
  source: 'builtin' | 'ai'; // builtin 仅默认兜底卡一张
  tags: string[];
  createdAt: number;
  favorited: boolean;
  /** 本次生成题材的来源说明（如"取自《书名》"/"随机题材"），仅 AI 卡有 */
  themeSource?: string;
}

// ============ M3 角色采访 ============

export type InterviewAngle =
  | 'childhood'
  | 'motivation'
  | 'secret'
  | 'relationships'
  | 'event_opinion'
  | 'free';

export const INTERVIEW_ANGLE_LABEL: Record<InterviewAngle, string> = {
  childhood: '童年',
  motivation: '动机',
  secret: '秘密',
  relationships: '关系',
  event_opinion: '对某事件看法',
  free: '自由'
};

export interface InterviewMessage {
  role: 'interviewer' | 'character';
  content: string;
  timestamp: number;
}

export interface InterviewSession {
  id: string;
  bookId: string;
  characterId: string;
  angle: InterviewAngle;
  messages: InterviewMessage[];
  startedAt: number;
  endedAt?: number;
  savedToCharacter?: boolean;
}

export interface InterviewRecord {
  sessionId: string;
  characterId: string;
  messageCount: number;
  duration: number; // 秒
  summary: string; // AI 生成的采访摘要（等待用户确认是否写入角色卡）
  savedToCharacter: boolean; // 用户是否点了「添加到角色卡」
}

// ============ M4 "如果…会怎样"推演 ============

export interface WhatIfParams {
  bookId: string;
  hypothesis: string; // "如果主角在第三章就死了"
  range: 3 | 5 | 10; // 推演后续章节数
  fromChapterId?: string; // 锚点章节：假设发生在该章之后（默认最新章）
  signal?: AbortSignal;
  /** 阶段性进度回调（组装上下文 -> 推演中 -> 解析报告） */
  onStage?: (stage: 'context' | 'running' | 'parsing') => void;
}

export interface WhatIfReport {
  id: string;
  bookId: string;
  hypothesis: string;
  range: number;
  anchorChapterTitle: string; // 锚点章节（推演起点）
  impactScope: string; // 影响范围概述
  characterChanges: Array<{
    characterId: string;
    characterName: string;
    originalArc: string; // 原弧光
    modifiedArc: string; // 推演后弧光
  }>;
  plotBranches: Array<{
    chapterOffset: number; // 第几章后
    branchPoint: string; // 分支点描述
    outcome: string; // 走向预测
  }>;
  risks: string[]; // 潜在风险
  recommendation: string; // AI 建议：值得尝试 / 风险过高 / 需要调整
  generatedAt: number;
}

// ============ M5 多视角重写 ============

export interface PerspectiveRewriteParams {
  bookId: string;
  chapterId: string;
  selectedText: string;
  perspective: string; // 视角：角色名 / "上帝视角" / "旁观者视角" / "未来回望视角"
  characterId?: string; // 角色视角时关联角色卡（注入设定保持一致性）
  tone?: string; // 风格调整提示
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

export interface AvailablePerspective {
  label: string; // "张三的视角" / "上帝视角"
  type: 'character' | 'narrator';
  characterId?: string;
  characterName?: string;
}

export type { ChatChunk };
