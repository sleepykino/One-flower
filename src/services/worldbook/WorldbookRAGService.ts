/**
 * WorldbookRAGService：世界书向量检索
 * - 条目写入/更新时自动向量化（embedding API）
 * - AI 续写/对白前按当前情节检索 top-K 相关条目注入 Prompt
 * - 向量存 worldbook_embeddings 表（base64 TEXT，规避 BLOB 经 Rust 转 UTF-8 的丢失），
 *   检索在 JS 侧做余弦相似度（每书条目量级小，无需 sqlite-vec）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider } from '../ai/providers/LLMProvider';
import { resolveProviderConfigIdForFeature } from '../ai/providerResolver';
import type { AppSettingsService } from '../settings/AppSettingsService';
import type { WorldbookEntry } from '../../types';

export interface EmbedProgress {
  entryId: string;
  title: string;
  status: 'pending' | 'embedding' | 'done' | 'error';
  error?: string;
}

/** embedding 配置键 */
export const EMBED_PROVIDER_KEY = 'embedding.providerConfigId';
export const EMBED_MODEL_KEY = 'embedding.model';
export const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';

/** Float32Array <-> base64 */
function f32ToBase64(vec: Float32Array): string {
  const bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToF32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface RawEntry {
  id: string;
  bookId: string;
  title: string;
  category: string | null;
  content: string;
  tags: string | null;
  updatedAt: number;
}

export class WorldbookRAGService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private settings: AppSettingsService;

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

  /** 解析 embedding 用的 provider 与模型（模型分工「向量嵌入」未配置时回退第一组配置） */
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

  private async loadEntry(entryId: string): Promise<RawEntry | null> {
    const r = await this.db.queryOne<Record<string, unknown>>(
      'SELECT id, book_id, title, category, content, tags, updated_at FROM worldbook_entries WHERE id = ?',
      [entryId]
    );
    if (!r) return null;
    return {
      id: String(r.id),
      bookId: String(r.book_id),
      title: String(r.title),
      category: (r.category as string) ?? null,
      content: String(r.content ?? ''),
      tags: (r.tags as string) ?? null,
      updatedAt: Number(r.updated_at ?? 0)
    };
  }

  private entryText(e: RawEntry): string {
    const tags = (() => {
      try {
        return (JSON.parse(e.tags ?? '[]') as string[]).join('、');
      } catch {
        return '';
      }
    })();
    return [e.title, e.category ?? '', tags, e.content].filter(Boolean).join('\n');
  }

  /** 向量化单个条目并持久化（写入/更新时触发） */
  async embedEntry(entryId: string): Promise<void> {
    const entry = await this.loadEntry(entryId);
    if (!entry) throw new Error('世界书条目不存在');
    const { provider, model } = await this.resolveEmbedding(entry.bookId);
    if (!provider.embed) throw new Error(`供应商 ${provider.name} 不支持向量嵌入（embeddings）`);
    const [vec] = await provider.embed([this.entryText(entry)], model);
    const f32 = Float32Array.from(vec);
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO worldbook_embeddings (entry_id, book_id, embedding, dim, model, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET
           embedding = excluded.embedding, dim = excluded.dim,
           model = excluded.model, updated_at = excluded.updated_at`,
        [entryId, entry.bookId, f32ToBase64(f32), f32.length, model, Date.now()]
      )
    );
  }

  /** 批量向量化（首次启用 RAG / 切换模型后）；默认跳过已是最新向量的条目 */
  async *embedAll(
    bookId: string,
    opts?: { force?: boolean }
  ): AsyncGenerator<EmbedProgress> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT e.id, e.title, e.updated_at, emb.updated_at AS embedded_at FROM worldbook_entries e LEFT JOIN worldbook_embeddings emb ON emb.entry_id = e.id WHERE e.book_id = ? ORDER BY e.created_at ASC',
      [bookId]
    );
    for (const r of rows) {
      const id = String(r.id);
      const title = String(r.title);
      const embeddedAt = Number(r.embedded_at ?? 0);
      const entryUpdatedAt = Number(r.updated_at ?? 0);
      if (!opts?.force && embeddedAt >= entryUpdatedAt) {
        yield { entryId: id, title, status: 'done' };
        continue;
      }
      yield { entryId: id, title, status: 'embedding' };
      try {
        await this.embedEntry(id);
        yield { entryId: id, title, status: 'done' };
      } catch (e) {
        yield {
          entryId: id,
          title,
          status: 'error',
          error: e instanceof Error ? e.message : String(e)
        };
      }
    }
  }

  /** 按查询文本检索最相关 top-K 条目（余弦相似度） */
  async retrieve(query: string, bookId: string, topK = 3): Promise<WorldbookEntry[]> {
    const queryText = query.trim();
    if (!queryText) return [];
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT e.id, e.book_id, e.title, e.category, e.content, e.tags, emb.embedding
       FROM worldbook_embeddings emb
       JOIN worldbook_entries e ON e.id = emb.entry_id
       WHERE emb.book_id = ?
       ORDER BY e.created_at ASC`,
      [bookId]
    );
    if (rows.length === 0) return [];

    const { provider, model } = await this.resolveEmbedding(bookId);
    if (!provider.embed) throw new Error(`供应商 ${provider.name} 不支持向量嵌入（embeddings）`);
    const [qv] = await provider.embed([queryText], model);
    const qvec = Float32Array.from(qv);

    const scored = rows
      .map((r) => ({
        row: r,
        score: cosineSimilarity(qvec, base64ToF32(String(r.embedding)))
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, topK));

    return scored.map(({ row }) => ({
      id: String(row.id),
      bookId: String(row.book_id),
      title: String(row.title),
      category: (row.category as string) ?? null,
      content: String(row.content ?? ''),
      tags: (row.tags as string) ?? '[]',
      createdAt: 0,
      updatedAt: 0
    }));
  }

  /** 删除条目时清理向量 */
  async removeEmbedding(entryId: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('DELETE FROM worldbook_embeddings WHERE entry_id = ?', [entryId])
    );
  }

  /** 已向量化条目集合（UI 展示嵌入状态用） */
  async embeddedEntryIds(bookId: string): Promise<Set<string>> {
    const rows = await this.db.query<{ entry_id: string }>(
      'SELECT entry_id FROM worldbook_embeddings WHERE book_id = ?',
      [bookId]
    );
    return new Set(rows.map((r) => String(r.entry_id)));
  }

  /** 当前配置的嵌入维度（无向量时返回 null） */
  async getEmbeddingDimension(): Promise<number | null> {
    const row = await this.db.queryOne<{ dim: number }>(
      'SELECT dim FROM worldbook_embeddings LIMIT 1'
    );
    return row ? Number(row.dim) : null;
  }
}
