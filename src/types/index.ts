/** 全局领域类型（对应 SQLite 表结构，字段为驼峰映射） */

export interface Book {
  id: string;
  title: string;
  genre: string | null;
  author: string | null;
  coverPath: string | null;
  storageDir: string;
  enabledSkills: string; // JSON array string
  providerConfigId: string | null;
  /** P6：置顶（书架恒排最前） */
  pinned: boolean;
  /** P6：手动排序序（迁移 011，初始 = created_at） */
  sortOrder: number;
  /** P6：软删除时间（NULL = 正常；非空 = 回收站中） */
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** P6：书架聚合统计（list/listDeleted 填充，get 不保证） */
  chapterCount?: number;
  totalWords?: number;
}

/** P6：书架排序模式 */
export type BookSortMode = 'updated' | 'created' | 'title' | 'manual';

export type ChapterStatus = 'draft' | 'revised' | 'final';

export interface Chapter {
  id: string;
  bookId: string;
  parentId: string | null;
  title: string;
  outline: string | null;
  status: ChapterStatus;
  sortOrder: number;
  wordCount: number;
  contentPath: string | null;
  summary: string | null;
  /** 摘要生成时间（P1 摘要链） */
  summaryGeneratedAt?: number | null;
  /** 生成摘要时的章节字数（判断摘要是否过期） */
  summarySourceWords?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Character {
  id: string;
  bookId: string;
  name: string;
  schemaId: string | null;
  data: string; // JSON: 按 schema 结构化数据
  tags: string | null; // JSON array string
  createdAt: number;
  updatedAt: number;
}

export interface CharacterSchema {
  id: string;
  bookId: string | null;
  name: string;
  schemaJson: string; // JSON Schema
  createdAt: number;
}

export interface WorldbookEntry {
  id: string;
  bookId: string;
  title: string;
  category: string | null;
  content: string;
  tags: string | null;
  /** 启用开关：false 时条目不参与 AI 注入 / RAG 检索 / [[ 新增引用列表 */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ForeshadowingStatus = 'planted' | 'resolved' | 'abandoned';

export interface Foreshadowing {
  id: string;
  bookId: string;
  description: string;
  plantedChapterId: string | null;
  resolvedChapterId: string | null;
  status: ForeshadowingStatus;
  createdAt: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  /** 'comfyui' 为 P4 新增的本地生图专用协议（不能绑定对话功能） */
  provider: 'openai_compat' | 'anthropic' | 'google' | 'comfyui';
  baseUrl: string | null;
  model: string;
  isDefault: boolean;
  createdAt: number;
}

/** ProseMirror 文档 JSON */
export type ProseMirrorDoc = { type: 'doc'; content: unknown[] };

export const CHAPTER_STATUS_LABEL: Record<ChapterStatus, string> = {
  draft: '草稿',
  revised: '修订',
  final: '定稿'
};

export const FORESHADOWING_STATUS_LABEL: Record<ForeshadowingStatus, string> = {
  planted: '已埋设',
  resolved: '已回收',
  abandoned: '已放弃'
};
