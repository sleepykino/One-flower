/**
 * TimelineService：时间线事件 CRUD + 泳道排序 + 时间线枚举（timeline_events 表）
 */

import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { TimelineEvent } from './types';

interface TimelineEventRow {
  id: string;
  book_id: string;
  title: string;
  description: string | null;
  timeline: string;
  sort_order: number;
  chapter_id: string | null;
  character_ids: string | null; // JSON 文本
  created_at: number;
}

function rowToEvent(r: TimelineEventRow): TimelineEvent {
  // character_ids 为 JSON 文本，解析失败或非数组时回退为空数组
  let characterIds: string[] = [];
  try {
    const parsed = JSON.parse(r.character_ids ?? '[]') as unknown;
    if (Array.isArray(parsed)) characterIds = parsed.map(String);
  } catch {
    characterIds = [];
  }
  return {
    id: r.id,
    bookId: r.book_id,
    title: r.title,
    description: r.description ?? '',
    timeline: r.timeline,
    sortOrder: Number(r.sort_order ?? 0),
    chapterId: r.chapter_id ?? undefined,
    characterIds,
    createdAt: r.created_at
  };
}

export class TimelineService {
  private db: Database;
  private wq: WriteQueue;

  constructor(db: Database, wq: WriteQueue) {
    this.db = db;
    this.wq = wq;
  }

  async create(
    data: Omit<TimelineEvent, 'id' | 'createdAt' | 'sortOrder'>
  ): Promise<TimelineEvent> {
    // sortOrder 取该时间线当前最大值 + 1，新事件追加到泳道末尾
    const maxRow = await this.db.queryOne<{ n: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) AS n FROM timeline_events WHERE book_id = ? AND timeline = ?',
      [data.bookId, data.timeline]
    );
    const ev: TimelineEvent = {
      ...data,
      chapterId: data.chapterId || undefined, // '' 视为未关联
      id: crypto.randomUUID(),
      sortOrder: Number(maxRow?.n ?? 0) + 1,
      createdAt: Date.now()
    };
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO timeline_events (id, book_id, title, description, timeline, sort_order, chapter_id, character_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ev.id,
          ev.bookId,
          ev.title,
          ev.description,
          ev.timeline,
          ev.sortOrder,
          ev.chapterId ?? null,
          JSON.stringify(ev.characterIds),
          ev.createdAt
        ]
      )
    );
    return ev;
  }

  async update(id: string, data: Partial<TimelineEvent>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (data.title !== undefined) {
      sets.push('title = ?');
      vals.push(data.title);
    }
    if (data.description !== undefined) {
      sets.push('description = ?');
      vals.push(data.description);
    }
    if (data.timeline !== undefined) {
      sets.push('timeline = ?');
      vals.push(data.timeline);
    }
    if (data.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      vals.push(data.sortOrder);
    }
    if (data.chapterId !== undefined) {
      sets.push('chapter_id = ?');
      vals.push(data.chapterId || null); // '' 视为清除关联
    }
    if (data.characterIds !== undefined) {
      sets.push('character_ids = ?');
      vals.push(JSON.stringify(data.characterIds));
    }
    if (sets.length === 0) return;
    vals.push(id);
    await this.wq.enqueue(() =>
      this.db.exec(`UPDATE timeline_events SET ${sets.join(', ')} WHERE id = ?`, vals)
    );
  }

  async delete(id: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('DELETE FROM timeline_events WHERE id = ?', [id])
    );
  }

  /** 全书事件：按时间线名 ASC、组内 sort_order ASC */
  async listByBook(bookId: string): Promise<TimelineEvent[]> {
    const rows = await this.db.query<TimelineEventRow>(
      'SELECT * FROM timeline_events WHERE book_id = ? ORDER BY timeline ASC, sort_order ASC',
      [bookId]
    );
    return rows.map(rowToEvent);
  }

  async listByTimeline(bookId: string, timeline: string): Promise<TimelineEvent[]> {
    const rows = await this.db.query<TimelineEventRow>(
      'SELECT * FROM timeline_events WHERE book_id = ? AND timeline = ? ORDER BY sort_order ASC',
      [bookId, timeline]
    );
    return rows.map(rowToEvent);
  }

  /** 按传入 id 顺序重写 sort_order（1..n），单事务提交保证原子性 */
  async reorder(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        for (let i = 0; i < ids.length; i++) {
          await tx.exec('UPDATE timeline_events SET sort_order = ? WHERE id = ?', [
            i + 1,
            ids[i]
          ]);
        }
      })
    );
  }

  /** 枚举书籍下的时间线名，按首次出现顺序（以最早 created_at 为准） */
  async listTimelines(bookId: string): Promise<string[]> {
    const rows = await this.db.query<{ timeline: string }>(
      `SELECT timeline, MIN(created_at) AS first_at FROM timeline_events
       WHERE book_id = ? GROUP BY timeline ORDER BY first_at ASC, timeline ASC`,
      [bookId]
    );
    return rows.map((r) => r.timeline);
  }
}
