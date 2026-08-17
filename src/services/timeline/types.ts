/**
 * 时间线事件类型（timeline_events 表）
 */

export interface TimelineEvent {
  id: string;
  bookId: string;
  title: string;
  description: string;
  timeline: string; // 'main' / 'subplot_a' ...
  sortOrder: number;
  chapterId?: string;
  characterIds: string[]; // 关联角色 id 列表（表中存 JSON 文本）
  createdAt: number;
}
