/**
 * 设定反推类型（P2.1-M6）：事实抽取 -> 推导链 -> 越级矛盾校验
 */

export type FactKind = 'object' | 'technology' | 'social' | 'magic' | 'geography' | 'other';
export type FactSource = 'worldbook' | 'character' | 'chapter';

export interface SettingFact {
  id: string;
  bookId: string;
  kind: FactKind;
  domain: string; // 归属领域："光学" / "航海" / "火药" / "冶金"
  fact: string; // "存在眼镜"
  basis: string; // 依据摘录："第5章：他从眼镜上方看她"
  confidence: number; // 0-1
  exempt: boolean; // 架空豁免
  source: FactSource;
  sourceRef: string; // worldbook 条目 id / 角色 id / 章节 id
  createdAt: number;
}

export interface InferenceChainItem {
  id: string;
  factId: string;
  premise: string; // "光学玻璃工艺成熟"
  conclusion: string; // "望远镜与航海天文应有相应发展"
  confidence: number;
}

/** 抽取/推导范围预估（UI 二次确认弹层用） */
export interface ExtractionScope {
  worldbookEntries: number;
  characters: number;
  chapters: number;
  /** 抽取预计 LLM 调用次数（条目/角色按 5 条一批，章节每章 1 次） */
  extractCalls: number;
  /** 推导预计 LLM 调用次数（每个非豁免领域 1 次） */
  domains: number;
}
