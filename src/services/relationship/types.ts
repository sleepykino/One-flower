/**
 * 角色关系类型（P1-M3）
 */

export interface Relationship {
  id: string;
  bookId: string;
  fromCharacterId: string;
  toCharacterId: string;
  type: string; // 师徒/敌对/恋人/亲属/主仆/盟友/同门/其他
  description: string;
  bidirectional: boolean;
  createdAt: number;
}

/** 预设关系类型 */
export const RELATIONSHIP_TYPES = [
  '师徒',
  '敌对',
  '恋人',
  '亲属',
  '主仆',
  '盟友',
  '同门',
  '其他'
] as const;
