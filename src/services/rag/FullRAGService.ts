/**
 * FullRAGService（P2-M2）：全量 RAG 三路检索
 * - 章节原文按段落切分（200-500 字）向量化，段落内容不变则复用旧向量（增量）
 * - 检索三路并行打分：摘要链 + 世界书 + 原文片段（query 只 embed 一次）
 * - 解决"第 3 章的细节在第 50 章被召回"的远期记忆问题
 * - 向量存 base64 TEXT（与 P1 worldbook_embeddings 同模式，无需 sqlite-vec）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider } from '../ai/providers/LLMProvider';
import { resolveProviderConfigIdForFeature } from '../ai/providerResolver';
import type { AppSettingsService } from '../settings/AppSettingsService';
import {
  EMBED_MODEL_KEY,
  DEFAULT_EMBED_MODEL
} from '../worldbook/WorldbookRAGService';
import { estimateTokens } from '../ai/providers/LLMProvider';
import { f32ToBase64, base64ToF32, cosineSimilarity, hashText } from '../../utils/vector';
import { docToPlainText } from '../../utils/pmdoc';
import type { WorldbookEntry, ProseMirrorDoc } from '../../types';

export interface ChapterEmbedProgress {
  chapterId: string;
  title: string;
  status: 'pending' | 'embedding' | 'done' | 'error';
  error?: string;
}

export interface RetrieveOptions {
  topKSummaries?: number;
  topKWorldbook?: number;
  topKSegments?: number;
}

export interface SegmentRecall {
  segmentId: string;
  chapterId: string;
  chapterTitle: string;
  excerpt: string;
  score: number;
}

export interface SummaryRecall {
  chapterId: string;
  title: string;
  summary: string;
  score: number;
}

export interface RAGResult {
  summaries: SummaryRecall[];
  worldbookEntries: WorldbookEntry[];
  segments: SegmentRecall[];
  totalTokens: number;
}

/** 段落切分：按空行分段，累积 200+ 产出，超长段按句拆，目标 200-500 字 */
export function splitSegments(text: string): Array<{ content: string; start: number }> {
  const out: Array<{ content: string; start: number }> = [];
  const pushSeg = (s: string, start: number): void => {
    const t = s.trim();
    if (t.length >= 30) out.push({ content: t, start });
  };

  let pos = 0;
  for (const para of text.split(/\n{2,}/)) {
    const start = pos;
    pos += para.length + 2;
    const p = para.trim();
    if (!p) continue;

    if (p.length > 500) {
      // 超长段按句拆分（start_pos 取段落起点，仅作展示辅助）
      let sbuf = '';
      for (const sent of p.split(/(?<=[。！？!?；])/)) {
        if (sbuf && sbuf.length + sent.length > 500) {
          pushSeg(sbuf, start);
          sbuf = '';
        }
        sbuf += sent;
        if (sbuf.length >= 200) {
          pushSeg(sbuf, start);
          sbuf = '';
        }
      }
      if (sbuf) pushSeg(sbuf, start);
      continue;
    }

    // 常规段：与上一缓冲合并
    if (out.length > 0) {
      const last = out[out.length - 1];
      if (last.content.length + p.length <= 500) {
        last.content = `${last.content}\n${p}`;
        continue;
      }
    }
    pushSeg(p, start);
  }
  return out;
}

export class FullRAGService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private settings: AppSettingsService;
  /** 保存后防抖嵌入的定时器 */
  private pendingTimers = new Map<string, number>();

  constructor(
    bridge: NativeBridge,
    db: Database,
    wq: WriteQueue,
    providerFactory: (configId: string) => Promise<LLMProvider>,
    settings: AppSettingsService
  ) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.providerFactory = providerFactory;
    this.settings = settings;
  }

  private async resolveEmbedding(bookId: string): Promise<{
    provider: LLMProvider;
    model: string;
  }> {
    const configId = await resolveProviderConfigIdForFeature(this.bridge, bookId, 'embedding');
    if (!configId) throw new Error('未配置 Embedding 服务：请到设置页「模型分工」配置向量模型');
    const provider = await this.providerFactory(configId);
    if (!provider.embed) {
      throw new Error(`Provider「${provider.name}」不支持向量嵌入（Anthropic 无此能力）`);
    }
    const model = (await this.settings.get(EMBED_MODEL_KEY)) ?? DEFAULT_EMBED_MODEL;
    return { provider, model };
  }

  /** 保存后延迟向量化（防抖 8s，失败静默不阻塞编辑） */
  scheduleEmbed(chapterId: string): void {
    const old = this.pendingTimers.get(chapterId);
    if (old) window.clearTimeout(old);
    const t = window.setTimeout(() => {
      this.pendingTimers.delete(chapterId);
      void this.embedChapterSegments(chapterId).catch((e) =>
        console.warn('[FullRAG] 章节自动向量化失败:', e)
      );
    }, 8000);
    this.pendingTimers.set(chapterId, t);
  }

  /** 从文件系统读取章节正文纯文本（ProseMirror JSON；失败返回空串） */
  private async loadChapterPlain(chapterId: string, bookId: string, contentPath: string | null): Promise<string> {
    let path = contentPath;
    if (!path) {
      const book = await this.db.queryOne<{ storage_dir: string }>(
        'SELECT storage_dir FROM books WHERE id = ?',
        [bookId]
      );
      if (!book) return '';
      path = `${String(book.storage_dir).replace(/\\/g, '/')}/chapters/${chapterId}.json`;
    }
    try {
      const raw = await this.bridge.fs.readFile(path);
      const doc = JSON.parse(raw) as ProseMirrorDoc;
      return doc?.type === 'doc' ? docToPlainText(doc) : '';
    } catch {
      return '';
    }
  }

  /** 向量化单章：段落切分 + 增量嵌入（内容不变的段落复用旧向量）+ 摘要向量 */
  async embedChapterSegments(chapterId: string): Promise<void> {
    const ch = await this.db.queryOne<{ id: string; book_id: string; content_path: string | null; summary: string | null }>(
      'SELECT id, book_id, content_path, summary FROM chapters WHERE id = ?',
      [chapterId]
    );
    if (!ch) throw new Error('章节不存在');
    const bookId = String(ch.book_id);
    // 正文存文件系统（ProseMirror JSON），DB 无 content 列
    const plain = await this.loadChapterPlain(chapterId, bookId, ch.content_path ?? null);

    if (!plain) {
      await this.removeChapterSegments(chapterId);
      return;
    }

    const segs = splitSegments(plain);
    const targetIds = segs.map((s) => `${chapterId}_${hashText(s.content)}`);

    // 现有片段：删除已消失的段（连带向量）
    const existing = await this.db.query<{ id: string }>(
      'SELECT id FROM chapter_segments WHERE chapter_id = ?',
      [chapterId]
    );
    const existingIds = new Set(existing.map((r) => String(r.id)));
    const targetSet = new Set(targetIds);
    for (const id of existingIds) {
      if (!targetSet.has(id)) {
        await this.wq.enqueue(() =>
          this.db.exec('DELETE FROM chapter_segments WHERE id = ?', [id])
        );
      }
    }

    // 增量：只嵌入新段
    const fresh = segs.filter((s, i) => !existingIds.has(targetIds[i]));
    if (fresh.length > 0) {
      const { provider, model } = await this.resolveEmbedding(bookId);
      if (!provider.embed) throw new Error(`供应商 ${provider.name} 不支持向量嵌入`);
      const BATCH = 16;
      for (let i = 0; i < fresh.length; i += BATCH) {
        const batch = fresh.slice(i, i + BATCH);
        const vectors = await provider.embed(batch.map((s) => s.content), model);
        for (let j = 0; j < batch.length; j++) {
          const f32 = Float32Array.from(vectors[j]);
          const segId = `${chapterId}_${hashText(batch[j].content)}`;
          const createdAt = Date.now();
          await this.wq.enqueue(() =>
            this.db.exec(
              `INSERT INTO chapter_segments (id, chapter_id, book_id, content, start_pos, end_pos, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO NOTHING`,
              [
                segId,
                chapterId,
                bookId,
                batch[j].content,
                batch[j].start,
                batch[j].start + batch[j].content.length,
                createdAt
              ]
            )
          );
          await this.wq.enqueue(() =>
            this.db.exec(
              `INSERT INTO chapter_segments_embeddings (segment_id, chapter_id, book_id, embedding, dim, model, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(segment_id) DO UPDATE SET
                 embedding = excluded.embedding, dim = excluded.dim,
                 model = excluded.model, updated_at = excluded.updated_at`,
              [segId, chapterId, bookId, f32ToBase64(f32), f32.length, model, Date.now()]
            )
          );
        }
      }
    }

    // 摘要向量（有摘要时维护，摘要为空则删除旧向量）
    const summary = String(ch.summary ?? '').trim();
    if (summary) {
      const { provider, model } = await this.resolveEmbedding(bookId);
      if (!provider.embed) throw new Error(`供应商 ${provider.name} 不支持向量嵌入`);
      const [vec] = await provider.embed([`《${'章节'}》\n${summary}`], model);
      const f32 = Float32Array.from(vec);
      await this.wq.enqueue(() =>
        this.db.exec(
          `INSERT INTO chapter_summary_embeddings (chapter_id, book_id, embedding, dim, model, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(chapter_id) DO UPDATE SET
             embedding = excluded.embedding, dim = excluded.dim,
             model = excluded.model, updated_at = excluded.updated_at`,
          [chapterId, bookId, f32ToBase64(f32), f32.length, model, Date.now()]
        )
      );
    } else {
      await this.wq.enqueue(() =>
        this.db.exec('DELETE FROM chapter_summary_embeddings WHERE chapter_id = ?', [chapterId])
      );
    }
  }

  /** 批量向量化全书（未变化的段落自动跳过） */
  async *embedAllSegments(bookId: string): AsyncGenerator<ChapterEmbedProgress> {
    const rows = await this.db.query<{ id: string; title: string }>(
      'SELECT id, title FROM chapters WHERE book_id = ? ORDER BY created_at ASC',
      [bookId]
    );
    for (const r of rows) {
      yield { chapterId: String(r.id), title: String(r.title), status: 'embedding' };
      try {
        await this.embedChapterSegments(String(r.id));
        yield { chapterId: String(r.id), title: String(r.title), status: 'done' };
      } catch (e) {
        yield {
          chapterId: String(r.id),
          title: String(r.title),
          status: 'error',
          error: e instanceof Error ? e.message : String(e)
        };
      }
    }
  }

  /** 删除章节时清理片段与向量 */
  async removeChapterSegments(chapterId: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('DELETE FROM chapter_segments WHERE chapter_id = ?', [chapterId])
    );
    await this.wq.enqueue(() =>
      this.db.exec(
        'DELETE FROM chapter_segments_embeddings WHERE chapter_id = ?',
        [chapterId]
      )
    );
    await this.wq.enqueue(() =>
      this.db.exec('DELETE FROM chapter_summary_embeddings WHERE chapter_id = ?', [chapterId])
    );
  }

  /** 全量检索：query 只 embed 一次，三路并行打分 */
  async retrieve(query: string, bookId: string, options?: RetrieveOptions): Promise<RAGResult> {
    const queryText = query.trim();
    const empty: RAGResult = {
      summaries: [],
      worldbookEntries: [],
      segments: [],
      totalTokens: 0
    };
    if (!queryText) return empty;

    const [wbRows, sumRows, segRows] = await Promise.all([
      this.db.query<Record<string, unknown>>(
        `SELECT e.id, e.book_id, e.title, e.category, e.content, e.tags, emb.embedding
         FROM worldbook_embeddings emb
         JOIN worldbook_entries e ON e.id = emb.entry_id
         WHERE emb.book_id = ?`,
        [bookId]
      ),
      this.db.query<Record<string, unknown>>(
        `SELECT c.id AS chapter_id, c.title, c.summary, emb.embedding
         FROM chapter_summary_embeddings emb
         JOIN chapters c ON c.id = emb.chapter_id
         WHERE emb.book_id = ? AND c.summary IS NOT NULL AND c.summary != ''`,
        [bookId]
      ),
      this.db.query<Record<string, unknown>>(
        `SELECT s.id AS segment_id, s.content, s.chapter_id, c.title AS chapter_title, emb.embedding
         FROM chapter_segments_embeddings emb
         JOIN chapter_segments s ON s.id = emb.segment_id
         JOIN chapters c ON c.id = s.chapter_id
         WHERE emb.book_id = ?`,
        [bookId]
      )
    ]);
    if (wbRows.length === 0 && sumRows.length === 0 && segRows.length === 0) return empty;

    const { provider, model } = await this.resolveEmbedding(bookId);
    if (!provider.embed) throw new Error(`供应商 ${provider.name} 不支持向量嵌入`);
    const [qv] = await provider.embed([queryText], model);
    const qvec = Float32Array.from(qv);

    const topK = (n: number): number => Math.max(1, n);
    const kSum = options?.topKSummaries ?? 5;
    const kWb = options?.topKWorldbook ?? 3;
    const kSeg = options?.topKSegments ?? 3;

    const summaries: SummaryRecall[] = sumRows
      .map((r) => ({
        chapterId: String(r.chapter_id),
        title: String(r.title),
        summary: String(r.summary ?? ''),
        score: cosineSimilarity(qvec, base64ToF32(String(r.embedding)))
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK(kSum));

    const worldbookEntries: WorldbookEntry[] = wbRows
      .map((r) => ({ row: r, score: cosineSimilarity(qvec, base64ToF32(String(r.embedding))) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK(kWb))
      .map(({ row }) => ({
        id: String(row.id),
        bookId: String(row.book_id),
        title: String(row.title),
        category: (row.category as string) ?? null,
        content: String(row.content ?? ''),
        tags: (row.tags as string) ?? '[]',
        createdAt: 0,
        updatedAt: 0
      }));

    const segments: SegmentRecall[] = segRows
      .map((r) => ({
        segmentId: String(r.segment_id),
        chapterId: String(r.chapter_id),
        chapterTitle: String(r.chapter_title),
        excerpt: String(r.content ?? ''),
        score: cosineSimilarity(qvec, base64ToF32(String(r.embedding)))
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK(kSeg))
      .map((s) => ({ ...s, excerpt: s.excerpt.slice(0, 400) }));

    const totalTokens =
      summaries.reduce((n, s) => n + estimateTokens(`${s.title}${s.summary}`), 0) +
      worldbookEntries.reduce((n, w) => n + estimateTokens(w.content), 0) +
      segments.reduce((n, s) => n + estimateTokens(s.excerpt), 0);

    return { summaries, worldbookEntries, segments, totalTokens };
  }

  /** 章节片段统计（UI 展示嵌入状态用） */
  async segmentStats(bookId: string): Promise<{ chapters: number; segments: number }> {
    const seg = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM chapter_segments WHERE book_id = ?',
      [bookId]
    );
    const ch = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(DISTINCT chapter_id) AS n FROM chapter_segments WHERE book_id = ?',
      [bookId]
    );
    return { chapters: Number(ch?.n ?? 0), segments: Number(seg?.n ?? 0) };
  }
}
