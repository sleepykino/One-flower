/**
 * 命名生成器类型定义（P2）
 * 按类型（角色/地点/招式/势力）+ 题材批量生成中文名字
 */

export type NameType = 'character' | 'location' | 'skill' | 'faction';

export type Gender = 'male' | 'female' | 'neutral';

export interface NameGenParams {
  type: NameType;
  genre: string;
  count: number;
  gender?: Gender;
  hints?: string;
}

export interface GeneratedName {
  name: string;
  meaning: string;
  type: NameType;
}

export interface NameFavorite {
  id: string;
  name: string;
  meaning: string;
  type: NameType;
  genre: string | null;
  createdAt: number;
}

/** 支持的题材列表 */
export const GENRES = ['武侠', '仙侠', '玄幻', '科幻', '奇幻', '都市', '历史', '西幻'];

/** 类型中文标签 */
export const TYPE_LABEL: Record<NameType, string> = {
  character: '角色',
  location: '地点',
  skill: '招式',
  faction: '势力'
};
