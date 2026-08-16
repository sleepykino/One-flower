/**
 * SummaryService：章节摘要链
 * - 章节保存后自动生成摘要（后台任务，防抖，不阻塞编辑器）
 * - 前情上下文升级：前 N 章摘要（token 预算内尽可能多）+ 最近 2 章原文
 * - 支持手动重新生成与批量补全（导入旧书）
 */

import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider } from '../ai/providers/LLMProvider';
import type { ChatMessage } from '../ai/providers/LLMProvider';
import { resolveProvider, resolveModelName } from '../ai/providerResolver';
import type { NativeBridge } from '../../native/NativeBridge';
import type { ChapterService } from '../chapter/ChapterService';
import type { Chapter } from '../../types';
import { docToPlainText } from '../../utils/pmdoc';
import { countTokens } from '../../utils/tokens';
import type { ChapterSummary, RecentContext, SummaryProgress } from './types';

const SUMMARY_SYSTEM_PROMPT = `你是一个小说摘要生成器。请将以下章节内容压缩为 100-200 字的摘要，包含：
1. 主要事件
2. 出场角色及其行为
3. 关键设定变化
4. 留下的悬念
不要评价文笔，只客观记录情节。只输出摘要正文，不要任何前后缀。`;

/** 低于该字数的章节不生成摘要（空章/提纲章） */
const MIN_WORDS_TO_SUMMARIZE = 200;
const MAX_RETRY = 2;
const AUTO_SUMMARY_DELAY_MS = 5000;
/** 摘要链最多回溯章节数 */
const MAX_SUMMARY_CHAIN = 20;

export class SummaryService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private chapterService: ChapterService;

  /** 防抖计时器（按章节） */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 生成中的章节（防重复） */
  private inFlight = new Set<string>();

  constructor(
    bridge: NativeBridge,
    db: Database,
    wq: WriteQueue,
    providerFactory: (configId: string) => Promise<LLMProvider>,
    chapterService: ChapterService
  ) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.providerFactory = providerFactory;
    this.chapterService = chapterService;
  }

  /** 摘要是否需要（重新）生成：无摘要，或字数已变化 */
  needsRefresh(ch: Chapter): boolean {
    if (ch.wordCount < MIN_WORDS_TO_SUMMARIZE) return false;
    if (!ch.summary || !ch.summaryGeneratedAt) return true;
    return ch.wordCount !== (ch.summarySourceWords ?? 0);
  }

  /** 为某章生成摘要（含重试），并持久化到 chapters.summary */
  async generateSummary(chapterId: string): Promise<ChapterSummary> {
    if (this.inFlight.has(chapterId)) {
      throw new Error('该章节摘要正在生成中');
    }
    this.inFlight.add(chapterId);
    try {
      const ch = await this.chapterService.get(chapterId);
      if (!ch) throw new Error('章节不存在');
      if (ch.wordCount < MIN_WORDS_TO_SUMMARIZE) {
        throw new Error(`章节字数（${ch.wordCount}）过少，无需生成摘要`);
      }

      const text = docToPlainText(await this.chapterService.getContent(chapterId));
      if (!text.trim()) throw new Error('章节正文为空');

      const provider = await resolveProvider(this.bridge, ch.bookId, this.providerFactory);
      const model = await resolveModelName(this.bridge, ch.bookId);

      const messages: ChatMessage[] = [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `《${ch.title}》\n\n${text}`
        }
      ];

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        try {
          const res = await provider.chat(messages, {
            model,
            temperature: 0.3,
            maxTokens: 600
          });
          const summary = res.content.trim();
          if (!summary) throw new Error('模型返回空摘要');
          const now = Date.now();
          await this.wq.enqueue(() =>
            this.db.exec(
              'UPDATE chapters SET summary = ?, summary_generated_at = ?, summary_source_words = ?, updated_at = ? WHERE id = ?',
              [summary, now, ch.wordCount, now, chapterId]
            )
          );
          return { chapterId, title: ch.title, summary, generatedAt: now };
        } catch (e) {
          lastError = e;
          if (attempt < MAX_RETRY) {
            await new Promise((r) => setTimeout(r, attempt * 1000));
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    } finally {
      this.inFlight.delete(chapterId);
    }
  }

  /** 手动重新生成（无条件） */
  async regenerate(chapterId: string): Promise<ChapterSummary> {
    return this.generateSummary(chapterId);
  }

  /** 批量生成/补全（导入旧书时）：按目录顺序逐章处理，yield 进度 */
  async *generateAllSummaries(
    bookId: string,
    opts?: { force?: boolean }
  ): AsyncGenerator<SummaryProgress> {
    const chapters = await this.chapterService.listTreeOrder(bookId);
    for (const ch of chapters) {
      yield { chapterId: ch.id, title: ch.title, status: 'pending' };
      if (!opts?.force && !this.needsRefresh(ch)) {
        yield { chapterId: ch.id, title: ch.title, status: 'done' };
        continue;
      }
      if (ch.wordCount < MIN_WORDS_TO_SUMMARIZE) {
        yield { chapterId: ch.id, title: ch.title, status: 'done' };
        continue;
      }
      yield { chapterId: ch.id, title: ch.title, status: 'generating' };
      try {
        await this.generateSummary(ch.id);
        yield { chapterId: ch.id, title: ch.title, status: 'done' };
      } catch (e) {
        yield {
          chapterId: ch.id,
          title: ch.title,
          status: 'error',
          error: e instanceof Error ? e.message : String(e)
        };
      }
    }
  }

  /**
   * 前情上下文：当前章之前的章节中，
   * - 摘要链：按 token 预算尽量多地带上（跳过最近 2 章——它们以原文进入上下文）
   * - 最近 2 章原文
   */
  async getRecentContext(
    bookId: string,
    currentChapterId: string,
    maxTokens: number
  ): Promise<RecentContext> {
    const current = await this.chapterService.get(currentChapterId);
    if (!current) return { summaries: [], recentChapters: [] };

    // 最近 2 章原文（远 -> 近）
    const recentChapters = await this.chapterService.recentChapters(bookId, currentChapterId, 2);
    const recentIds = new Set(recentChapters.map((c) => c.id));

    // 当前章之前的章节（近 -> 远），排除走原文的最近 2 章
    const prevRows = await this.db.query<Record<string, unknown>>(
      `SELECT id, title, summary, summary_generated_at FROM chapters
       WHERE book_id = ? AND id != ? AND (sort_order < ? OR (sort_order = ? AND created_at < ?))
       ORDER BY sort_order DESC, created_at DESC
       LIMIT ?`,
      [bookId, currentChapterId, current.sortOrder, current.sortOrder, current.createdAt, 100]
    );

    const summaries: ChapterSummary[] = [];
    let used = 0;
    for (const r of prevRows) {
      const id = String(r.id);
      const summary = (r.summary as string) ?? '';
      if (!summary || recentIds.has(id)) continue;
      const tokens = countTokens(`《${String(r.title)}》${summary}`);
      if (used + tokens > maxTokens || summaries.length >= MAX_SUMMARY_CHAIN) break;
      used += tokens;
      summaries.push({
        chapterId: id,
        title: String(r.title),
        summary,
        generatedAt: Number(r.summary_generated_at ?? 0)
      });
    }
    // 远 -> 近
    return { summaries: summaries.reverse(), recentChapters };
  }

  /** 保存后自动触发（防抖 5s，后台执行，失败静默记录） */
  scheduleAutoSummary(chapterId: string): void {
    const existing = this.debounceTimers.get(chapterId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(chapterId);
      void (async () => {
        const ch = await this.chapterService.get(chapterId);
        if (!ch || !this.needsRefresh(ch) || this.inFlight.has(chapterId)) return;
        try {
          await this.generateSummary(chapterId);
        } catch (e) {
          console.warn('[SummaryService] 自动摘要失败:', e);
        }
      })();
    }, AUTO_SUMMARY_DELAY_MS);
    this.debounceTimers.set(chapterId, timer);
  }

  dispose(): void {
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }
}
