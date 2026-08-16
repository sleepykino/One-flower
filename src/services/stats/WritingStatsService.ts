/**
 * WritingStatsService：字数目标与统计（P1-M5）
 * 只记录字数差和会话时长（不过度采集）；writing_stats 按会话追加行，查询时按日聚合
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { WritingGoal, WritingStats } from './types';

interface DailyRow {
  date: string;
  words: number;
  duration: number;
  chapters: string | null;
}

function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDate(dt);
}

export class WritingStatsService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  /** 活跃编辑会话（每本书一个） */
  private sessions = new Map<string, { startAt: number; startWords: number }>();

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
  }

  private async totalWords(bookId: string): Promise<number> {
    const row = await this.db.queryOne<{ total: number | null }>(
      'SELECT COALESCE(SUM(word_count), 0) AS total FROM chapters WHERE book_id = ?',
      [bookId]
    );
    return Number(row?.total ?? 0);
  }

  /** 编辑器进入时开启会话（记录起始字数与时间） */
  async beginSession(bookId: string): Promise<void> {
    this.sessions.set(bookId, { startAt: Date.now(), startWords: await this.totalWords(bookId) });
  }

  /** 编辑器退出时结束会话：字数差 + 时长落库 */
  async endSession(bookId: string, chaptersWorked: string[] = []): Promise<void> {
    const s = this.sessions.get(bookId);
    if (!s) return;
    this.sessions.delete(bookId);
    const durationSec = Math.round((Date.now() - s.startAt) / 1000);
    if (durationSec < 5) return; // 忽略瞬时进出
    const endWords = await this.totalWords(bookId);
    const diff = endWords - s.startWords;
    if (diff <= 0 && durationSec < 60) return;
    await this.recordSession(bookId, Math.max(diff, 0), chaptersWorked, durationSec);
  }

  /** 记录一次编辑会话（增量） */
  async recordSession(
    bookId: string,
    wordsWritten: number,
    chaptersWorked: string[],
    duration: number
  ): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO writing_stats (id, book_id, date, words_written, chapters_worked, session_duration, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          bookId,
          localDate(),
          Math.max(wordsWritten, 0),
          JSON.stringify(chaptersWorked),
          Math.max(duration, 0),
          Date.now()
        ]
      )
    );
  }

  /** 某日聚合 */
  async getDailyStats(bookId: string, date: string): Promise<WritingStats | null> {
    const rows = await this.db.query<DailyRow>(
      `SELECT date, COALESCE(SUM(words_written),0) AS words, COALESCE(SUM(session_duration),0) AS duration,
              MIN(chapters_worked) AS chapters
       FROM writing_stats WHERE book_id = ? AND date = ? GROUP BY date`,
      [bookId, date]
    );
    const r = rows[0];
    if (!r || (r.words === 0 && r.duration === 0)) return null;
    return {
      date,
      bookId,
      wordsWritten: Number(r.words),
      chaptersWorked: parseChapters(r.chapters),
      sessionDuration: Number(r.duration)
    };
  }

  /** 日期范围（含起止）按日聚合，无数据的日期补 0 */
  async getRangeStats(bookId: string, from: string, to: string): Promise<WritingStats[]> {
    const rows = await this.db.query<DailyRow>(
      `SELECT date, COALESCE(SUM(words_written),0) AS words, COALESCE(SUM(session_duration),0) AS duration,
              MIN(chapters_worked) AS chapters
       FROM writing_stats WHERE book_id = ? AND date BETWEEN ? AND ? GROUP BY date`,
      [bookId, from, to]
    );
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const out: WritingStats[] = [];
    let d = from;
    let guard = 0;
    while (d <= to && guard < 400) {
      const r = byDate.get(d);
      out.push({
        date: d,
        bookId,
        wordsWritten: Number(r?.words ?? 0),
        chaptersWorked: parseChapters(r?.chapters ?? null),
        sessionDuration: Number(r?.duration ?? 0)
      });
      d = shiftDate(d, 1);
      guard++;
    }
    return out;
  }

  /** 连续写作天数（今天或昨天为起点向前数） */
  async getStreak(bookId: string): Promise<number> {
    const rows = await this.db.query<{ date: string }>(
      `SELECT date, SUM(words_written) AS words FROM writing_stats
       WHERE book_id = ? GROUP BY date HAVING words > 0 ORDER BY date DESC LIMIT 400`,
      [bookId]
    );
    if (rows.length === 0) return 0;
    const today = localDate();
    const yesterday = shiftDate(today, -1);
    const first = rows[0].date;
    if (first !== today && first !== yesterday) return 0;
    let streak = 0;
    let cursor = first;
    for (const r of rows) {
      if (r.date !== cursor) break;
      streak++;
      cursor = shiftDate(cursor, -1);
    }
    return streak;
  }

  async setGoal(goal: WritingGoal): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO writing_goals (book_id, daily_target, total_target, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET daily_target = excluded.daily_target, total_target = excluded.total_target, updated_at = excluded.updated_at`,
        [goal.bookId, Math.max(goal.dailyTarget, 0), Math.max(goal.totalTarget, 0), Date.now()]
      )
    );
  }

  async getGoal(bookId: string): Promise<WritingGoal | null> {
    const row = await this.bridge.db.queryOne<Record<string, unknown>>(
      'SELECT book_id, daily_target, total_target FROM writing_goals WHERE book_id = ?',
      [bookId]
    );
    if (!row) return null;
    return {
      bookId,
      dailyTarget: Number(row.daily_target ?? 3000),
      totalTarget: Number(row.total_target ?? 0)
    };
  }
}

function parseChapters(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}
