/**
 * 章节版本历史：diff 快照存储 + 重放恢复 + 对比 + GC
 * 首版存全文（full），后续存增量（delta），恢复时重放 diff 链
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { ProseMirrorDoc } from '../../types';
import { applyOps, diffJson, diffLines, type DiffOp, type VersionPayload } from '../../utils/diff';
import { countWords, docToPlainText } from '../../utils/pmdoc';

export interface ChapterVersionMeta {
  id: string;
  chapterId: string;
  createdAt: number;
  wordCount: number;
}

export interface DiffResult {
  added: number;
  removed: number;
  hunks: Array<{ type: 'add' | 'remove' | 'equal'; content: string }>;
}

export class ChapterVersionStore {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
  }

  /** 保存当前版本（与上一版做 diff，存 diff 而非全文） */
  async saveVersion(chapterId: string, doc: ProseMirrorDoc): Promise<void> {
    const prevDoc = await this.getLatestDoc(chapterId);
    let payload: VersionPayload;
    if (!prevDoc) {
      payload = { t: 'full', doc };
    } else {
      const ops = diffJson(prevDoc, doc);
      if (ops.length === 0) return; // 无变化不落版本
      payload = { t: 'delta', ops };
    }
    const id = crypto.randomUUID();
    const wordCount = countWords(doc);
    await this.wq.enqueue(() =>
      this.db.exec(
        'INSERT INTO chapter_versions (id, chapter_id, diff_json, word_count, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, chapterId, JSON.stringify(payload), wordCount, Date.now()]
      )
    );
  }

  /** 列出某章节的所有版本（按时间倒序） */
  async listVersions(chapterId: string): Promise<ChapterVersionMeta[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT id, chapter_id, word_count, created_at FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC',
      [chapterId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      chapterId: String(r.chapter_id),
      createdAt: Number(r.created_at),
      wordCount: Number(r.word_count ?? 0)
    }));
  }

  private async getVersionsAsc(chapterId: string): Promise<Array<Record<string, unknown>>> {
    return this.db.query(
      'SELECT id, diff_json, created_at FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at ASC',
      [chapterId]
    );
  }

  /** 重放 diff 链获取某版本的完整文档 */
  async getVersion(versionId: string): Promise<ProseMirrorDoc> {
    const rows = await this.getVersionsAsc(
      String(
        (
          await this.db.queryOne<{ chapter_id: string }>(
            'SELECT chapter_id FROM chapter_versions WHERE id = ?',
            [versionId]
          )
        )?.chapter_id ?? ''
      )
    );
    const idx = rows.findIndex((r) => String(r.id) === versionId);
    if (idx < 0) throw new Error('版本不存在');

    let doc: unknown = null;
    for (let i = 0; i <= idx; i++) {
      const payload = JSON.parse(String(rows[i].diff_json)) as VersionPayload;
      if (payload.t === 'full') {
        doc = structuredClone(payload.doc);
      } else if (doc !== null) {
        doc = applyOps(doc, (payload.ops ?? []) as DiffOp[]);
      }
    }
    return doc as ProseMirrorDoc;
  }

  /** 章节最新已存版本对应的文档（无版本时返回 null） */
  private async getLatestDoc(chapterId: string): Promise<ProseMirrorDoc | null> {
    const rows = await this.getVersionsAsc(chapterId);
    if (rows.length === 0) return null;
    let doc: unknown = null;
    for (const r of rows) {
      const payload = JSON.parse(String(r.diff_json)) as VersionPayload;
      if (payload.t === 'full') {
        doc = structuredClone(payload.doc);
      } else if (doc !== null) {
        doc = applyOps(doc, (payload.ops ?? []) as DiffOp[]);
      }
    }
    return (doc as ProseMirrorDoc) ?? null;
  }

  /** 对比两个版本（段落级 diff 视图） */
  async diff(fromVersionId: string, toVersionId: string): Promise<DiffResult> {
    const [fromDoc, toDoc] = await Promise.all([
      this.getVersion(fromVersionId),
      this.getVersion(toVersionId)
    ]);
    return diffLines(
      docToPlainText(fromDoc).split('\n'),
      docToPlainText(toDoc).split('\n')
    );
  }

  /** 回退到某版本：以 full 快照落新版本 + 更新章节正文与索引 */
  async restore(versionId: string): Promise<ProseMirrorDoc> {
    const doc = await this.getVersion(versionId);
    const chapterRow = await this.db.queryOne<Record<string, unknown>>(
      `SELECT c.id, c.book_id, c.title, c.content_path, b.storage_dir
       FROM chapter_versions v JOIN chapters c ON c.id = v.chapter_id JOIN books b ON b.id = c.book_id
       WHERE v.id = ?`,
      [versionId]
    );
    if (!chapterRow) throw new Error('章节不存在');
    const contentPath =
      (chapterRow.content_path as string) ??
      `${chapterRow.storage_dir}/chapters/${chapterRow.id}.json`;

    const wordCount = countWords(doc);
    await this.bridge.fs.writeFile(contentPath, JSON.stringify(doc, null, 2));

    // 落一个 full 版本 + 更新章节字数 + 重建 FTS
    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        await tx.exec(
          'INSERT INTO chapter_versions (id, chapter_id, diff_json, word_count, created_at) VALUES (?, ?, ?, ?, ?)',
          [crypto.randomUUID(), chapterRow.id, JSON.stringify({ t: 'full', doc }), wordCount, Date.now()]
        );
        await tx.exec('UPDATE chapters SET word_count = ?, updated_at = ? WHERE id = ?', [
          wordCount,
          Date.now(),
          chapterRow.id
        ]);
        await tx.exec('DELETE FROM chapters_fts WHERE chapter_id = ?', [chapterRow.id]);
        await tx.exec(
          'INSERT INTO chapters_fts (chapter_id, book_id, title, content) VALUES (?, ?, ?, ?)',
          [chapterRow.id, chapterRow.book_id, chapterRow.title, docToPlainText(doc)]
        );
      })
    );
    return doc;
  }

  /** GC：保留最近 N 版 + 每天 1 个日版本 */
  async gc(chapterId: string, keepRecent = 50, keepDaily = 1): Promise<void> {
    const rows = await this.getVersionsAsc(chapterId);
    const recent = rows.slice(-keepRecent);
    const older = rows.slice(0, Math.max(0, rows.length - keepRecent));

    // 旧版本按天分组，每天保留最后 keepDaily 个
    const keepIds = new Set(recent.map((r) => String(r.id)));
    const byDay = new Map<string, Array<Record<string, unknown>>>();
    for (const r of older) {
      const day = new Date(Number(r.created_at)).toISOString().slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push(r);
      byDay.set(day, list);
    }
    for (const [, list] of byDay) {
      for (const r of list.slice(-keepDaily)) keepIds.add(String(r.id));
    }

    const deleteIds = rows.map((r) => String(r.id)).filter((id) => !keepIds.has(id));
    for (const id of deleteIds) {
      await this.wq.enqueue(() => this.db.exec('DELETE FROM chapter_versions WHERE id = ?', [id]));
    }
  }
}
