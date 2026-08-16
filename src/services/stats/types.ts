/**
 * 写作统计类型（P1-M5）
 */

export interface WritingStats {
  date: string; // YYYY-MM-DD
  bookId: string;
  wordsWritten: number;
  chaptersWorked: string[];
  sessionDuration: number; // 秒
}

export interface WritingGoal {
  bookId: string;
  dailyTarget: number; // 日更目标字数
  totalTarget: number; // 全书目标字数
}
