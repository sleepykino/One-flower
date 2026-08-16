/**
 * 备份导入服务：从 .zip 包流式解压逐章写入 SQLite + 落盘
 */

import { Unzip, UnzipInflate } from 'fflate';
import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { ChapterStatus, ProseMirrorDoc } from '../../types';
import { docToPlainText } from '../../utils/pmdoc';
import { isPMDoc } from '../../utils/pmdoc';

interface BackupMeta {
  version: number;
  book: Record<string, unknown>;
  chapters: Array<{
    id: string;
    parentId: string | null;
    title: string;
    outline: string | null;
    status: string;
    sortOrder: number;
    wordCount: number;
    summary: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  characters: Array<Record<string, unknown>>;
  characterSchemas: Array<Record<string, unknown>>;
  worldbook: Array<Record<string, unknown>>;
  foreshadowings: Array<Record<string, unknown>>;
}

export class ImportService {
  private bridge: NativeBridge & {
    fs: { readBinaryFile(p: string): Promise<Uint8Array> };
  };
  private db: Database;
  private wq: WriteQueue;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge as never;
    this.db = db;
    this.wq = wq;
  }

  /** 解压 .zip（流式，逐文件回调） */
  private unzip(buffer: Uint8Array): Promise<Map<string, Uint8Array>> {
    return new Promise((resolve, reject) => {
      const files = new Map<string, Uint8Array>();
      const unzip = new Unzip();
      unzip.register(UnzipInflate);
      unzip.onfile = (file) => {
        const chunks: Uint8Array[] = [];
        file.ondata = (err, data, final) => {
          if (err) {
            reject(err);
            return;
          }
          chunks.push(data);
          if (final) {
            const len = chunks.reduce((s, c) => s + c.length, 0);
            const out = new Uint8Array(len);
            let off = 0;
            for (const c of chunks) {
              out.set(c, off);
              off += c.length;
            }
            files.set(file.name, out);
          }
        };
        file.start();
      };
      try {
        unzip.push(buffer, true);
      } catch (e) {
        reject(e);
        return;
      }
      resolve(files);
    });
  }

  private decode(u8: Uint8Array): string {
    return new TextDecoder('utf-8').decode(u8);
  }

  /** 校验备份包完整性（不实际导入） */
  async validateBackup(zipPath: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    try {
      const buffer = await this.bridge.fs.readBinaryFile(zipPath);
      const files = await this.unzip(buffer);
      const metaRaw = files.get('meta.json');
      if (!metaRaw) {
        errors.push('缺少 meta.json');
        return { valid: false, errors };
      }
      const meta = JSON.parse(this.decode(metaRaw)) as BackupMeta;
      if (!meta.book?.title) errors.push('meta.json 缺少书籍标题');
      if (!Array.isArray(meta.chapters)) errors.push('meta.json 缺少章节列表');
      const chapterCount = meta.chapters?.length ?? 0;
      for (let i = 1; i <= chapterCount; i++) {
        const name = `chapters/${String(i).padStart(3, '0')}.json`;
        const docRaw = files.get(name);
        if (!docRaw) {
          errors.push(`缺少 ${name}`);
          continue;
        }
        const doc = JSON.parse(this.decode(docRaw));
        if (!isPMDoc(doc)) errors.push(`${name} 不是有效的 ProseMirror 文档`);
      }
    } catch (e) {
      errors.push(`解析失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { valid: errors.length === 0, errors };
  }

  /** 从 .zip 备份包导入：流式解压逐章写入（新书籍 ID，避免冲突） */
  async importBackup(zipPath: string): Promise<{ bookId: string; chapterCount: number }> {
    const buffer = await this.bridge.fs.readBinaryFile(zipPath);
    const files = await this.unzip(buffer);
    const metaRaw = files.get('meta.json');
    if (!metaRaw) throw new Error('备份包缺少 meta.json');
    const meta = JSON.parse(this.decode(metaRaw)) as BackupMeta;

    const appDataDir = await this.bridge.storage.appDataDir();
    const newBookId = crypto.randomUUID();
    const storageDir = `${appDataDir}/books/${newBookId}`.replace(/\\/g, '/');
    await this.bridge.fs.ensureDir(`${storageDir}/chapters`);

    const oldToNewChapterId = new Map<string, string>();
    const now = Date.now();

    // 逐章写入：章节行 + 正文文件 + FTS 索引
    const stmts: Array<{ sql: string; params: unknown[] }> = [];
    stmts.push({
      sql: `INSERT INTO books (id, title, genre, author, cover_path, storage_dir, enabled_skills, provider_config_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?)`,
      params: [
        newBookId,
        String(meta.book.title ?? '导入书籍'),
        (meta.book.genre as string) ?? null,
        (meta.book.author as string) ?? null,
        (meta.book.cover_path as string) ?? null,
        storageDir,
        now,
        now
      ]
    });

    let idx = 0;
    for (const ch of meta.chapters) {
      idx++;
      const docRaw = files.get(`chapters/${String(idx).padStart(3, '0')}.json`);
      const doc: ProseMirrorDoc = docRaw && isPMDoc(JSON.parse(this.decode(docRaw)))
        ? (JSON.parse(this.decode(docRaw)) as ProseMirrorDoc)
        : { type: 'doc', content: [{ type: 'paragraph' }] };

      const newChapterId = crypto.randomUUID();
      oldToNewChapterId.set(ch.id, newChapterId);
      const contentPath = `${storageDir}/chapters/${newChapterId}.json`;
      await this.bridge.fs.writeFile(contentPath, JSON.stringify(doc, null, 2));

      stmts.push({
        sql: `INSERT INTO chapters (id, book_id, parent_id, title, outline, status, sort_order, word_count, content_path, summary, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newChapterId,
          newBookId,
          null, // parentId 下一轮统一更新
          ch.title,
          ch.outline,
          ch.status as ChapterStatus,
          ch.sortOrder,
          ch.wordCount,
          contentPath,
          ch.summary,
          ch.createdAt,
          now
        ]
      });
      stmts.push({
        sql: 'INSERT INTO chapters_fts (chapter_id, book_id, title, content) VALUES (?, ?, ?, ?)',
        params: [newChapterId, newBookId, ch.title, docToPlainText(doc)]
      });
    }

    // 修正 parentId 映射
    for (const ch of meta.chapters) {
      const newId = oldToNewChapterId.get(ch.id)!;
      const mappedParent = ch.parentId ? oldToNewChapterId.get(ch.parentId) ?? null : null;
      stmts.push({
        sql: 'UPDATE chapters SET parent_id = ? WHERE id = ?',
        params: [mappedParent, newId]
      });
    }

    // 角色卡 / 模板 / 世界书 / 伏笔
    for (const c of meta.characters ?? []) {
      stmts.push({
        sql: `INSERT INTO characters (id, book_id, name, schema_id, data, tags, created_at, updated_at)
              VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(c.name ?? ''),
          String(c.data ?? '{}'),
          (c.tags as string) ?? '[]',
          now,
          now
        ]
      });
    }
    for (const s of meta.characterSchemas ?? []) {
      stmts.push({
        sql: `INSERT INTO character_schemas (id, book_id, name, schema_json, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(s.name ?? '模板'),
          String(s.schema_json ?? '{}'),
          now
        ]
      });
    }
    for (const w of meta.worldbook ?? []) {
      stmts.push({
        sql: `INSERT INTO worldbook_entries (id, book_id, title, category, content, tags, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(w.title ?? ''),
          (w.category as string) ?? null,
          String(w.content ?? ''),
          (w.tags as string) ?? '[]',
          now,
          now
        ]
      });
    }
    for (const f of meta.foreshadowings ?? []) {
      stmts.push({
        sql: `INSERT INTO foreshadowings (id, book_id, description, planted_chapter_id, resolved_chapter_id, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(f.description ?? ''),
          (f.planted_chapter_id as string)
            ? oldToNewChapterId.get(String(f.planted_chapter_id)) ?? null
            : null,
          (f.resolved_chapter_id as string)
            ? oldToNewChapterId.get(String(f.resolved_chapter_id)) ?? null
            : null,
          (f.status as string) ?? 'planted',
          now
        ]
      });
    }

    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        for (const s of stmts) {
          await tx.exec(s.sql, s.params);
        }
      })
    );

    return { bookId: newBookId, chapterCount: meta.chapters.length };
  }
}
