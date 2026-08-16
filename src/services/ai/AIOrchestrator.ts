/**
 * AIOrchestrator：模式路由器（核心差异化）
 * continue / rewrite / dialogue 流式；check 非流式返回结构化报告
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { SkillLoader } from '../skill/SkillLoader';
import type { PromptAssembler, PromptContext, TokenBreakdown } from './PromptAssembler';
import { DEFAULT_TOKEN_BUDGET } from './PromptAssembler';
import type { LLMProvider, ChatChunk } from './providers/LLMProvider';
import { createProvider } from './providers/LLMProvider';
import type { SummaryService } from '../summary/SummaryService';
import type { WorldbookRAGService } from '../worldbook/WorldbookRAGService';
import type {
  Character,
  CheckParams,
  ConsistencyReport,
  ContinueParams,
  DialogueParams,
  RewriteParams
} from './types';

/** P1 依赖（可选注入，不破坏 P0 构造签名） */
export interface OrchestratorDeps {
  summaryService?: SummaryService;
  ragService?: WorldbookRAGService;
}

/** 最近一次 AI 调用的上下文快照（ContextPanel 展示用） */
export interface ContextSnapshot {
  bookId: string;
  mode: string;
  ctx: PromptContext;
  breakdown: TokenBreakdown[];
  totalTokens: number;
  at: number;
}

export class AIOrchestrator {
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private skillLoader: SkillLoader;
  private promptAssembler: PromptAssembler;
  private bridge: NativeBridge;
  private deps: OrchestratorDeps;
  private lastContext = new Map<string, ContextSnapshot>();

  constructor(
    providerFactory: (configId: string) => Promise<LLMProvider>,
    skillLoader: SkillLoader,
    promptAssembler: PromptAssembler,
    bridge: NativeBridge,
    deps: OrchestratorDeps = {}
  ) {
    this.providerFactory = providerFactory;
    this.skillLoader = skillLoader;
    this.promptAssembler = promptAssembler;
    this.bridge = bridge;
    this.deps = deps;
  }

  /** ContextPanel 用：取最近一次调用的上下文快照 */
  getLastContext(bookId: string): ContextSnapshot | null {
    return this.lastContext.get(bookId) ?? null;
  }

  /** 记录上下文快照（每次 assemble 后调用） */
  private recordContext(bookId: string, ctx: PromptContext): void {
    const breakdown = this.promptAssembler.inspect(ctx);
    const totalTokens = breakdown.reduce((sum, b) => sum + b.tokens, 0);
    this.lastContext.set(bookId, {
      bookId,
      mode: ctx.mode,
      ctx,
      breakdown,
      totalTokens,
      at: Date.now()
    });
  }

  /** P1：摘要链 + 最近 2 章原文（服务不可用或失败时回退调用方传入的窗口） */
  private async fetchRecentContext(
    bookId: string,
    chapterId: string,
    fallback: ContinueParams['recentChapters']
  ): Promise<{
    summaryChain: Parameters<PromptAssembler['assemble']>[0]['summaryChain'];
    recentChapters: ContinueParams['recentChapters'];
  }> {
    if (!this.deps.summaryService) {
      return { summaryChain: undefined, recentChapters: fallback };
    }
    try {
      const rc = await this.deps.summaryService.getRecentContext(
        bookId,
        chapterId,
        DEFAULT_TOKEN_BUDGET.summaryChain
      );
      const recent = rc.recentChapters.length > 0 ? rc.recentChapters : fallback;
      return {
        summaryChain: rc.summaries.length > 0 ? rc.summaries : undefined,
        recentChapters: recent
      };
    } catch (e) {
      console.warn('[AI] 获取前情上下文失败，回退滑动窗口:', e);
      return { summaryChain: undefined, recentChapters: fallback };
    }
  }

  /** P1：世界书 RAG 检索 top-3（失败静默降级为空） */
  private async fetchRag(
    bookId: string,
    query: string
  ): Promise<Parameters<PromptAssembler['assemble']>[0]['worldbookEntries']> {
    if (!this.deps.ragService || !query.trim()) return undefined;
    try {
      const hits = await this.deps.ragService.retrieve(query, bookId, 3);
      return hits.length > 0 ? hits : undefined;
    } catch (e) {
      console.warn('[AI] 世界书 RAG 检索失败，已跳过:', e);
      return undefined;
    }
  }

  /** 读取书籍绑定的 provider（书籍未配置时取第一组配置） */
  private async resolveProvider(bookId: string): Promise<LLMProvider> {
    const book = await this.bridge.db.queryOne<{ provider_config_id: string | null }>(
      'SELECT provider_config_id FROM books WHERE id = ?',
      [bookId]
    );
    let configId = book?.provider_config_id ?? null;
    if (!configId) {
      const first = await this.bridge.db.queryOne<{ id: string }>(
        'SELECT id FROM provider_configs ORDER BY created_at ASC LIMIT 1'
      );
      configId = first?.id ?? null;
    }
    if (!configId) throw new Error('未配置任何模型，请先到设置页添加 Provider 配置');
    return this.providerFactory(configId);
  }

  /** 按 ID 加载角色卡 */
  private async loadCharacters(ids: string[]): Promise<Character[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.bridge.db.query<Record<string, unknown>>(
      `SELECT * FROM characters WHERE id IN (${placeholders})`,
      ids
    );
    return rows.map((r) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(String(r.data ?? '{}')) as Record<string, unknown>;
      } catch {
        data = {};
      }
      let tags: string[] = [];
      try {
        tags = JSON.parse(String(r.tags ?? '[]')) as string[];
      } catch {
        tags = [];
      }
      return {
        id: String(r.id),
        name: String(r.name),
        data,
        tags
      };
    });
  }

  private async loadWorldbook(bookId: string): Promise<
    Array<{ id: string; title: string; category: string | null; content: string }>
  > {
    const rows = await this.bridge.db.query<Record<string, unknown>>(
      'SELECT id, title, category, content FROM worldbook_entries WHERE book_id = ?',
      [bookId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      category: (r.category as string) ?? null,
      content: String(r.content ?? '')
    }));
  }

  /** 续写：流式返回，支持 AbortSignal 中断 */
  async *continueWriting(params: ContinueParams): AsyncIterable<ChatChunk> {
    const provider = await this.resolveProvider(params.bookId);
    const skills = await this.skillLoader.getEnabledForMode(params.bookId, 'continue');
    const characters = await this.loadCharacters(params.selectedCharacterIds);
    // P1：摘要链 + 最近 2 章原文（失败回退滑动窗口）
    const { summaryChain, recentChapters } = await this.fetchRecentContext(
      params.bookId,
      params.chapterId,
      params.recentChapters
    );
    // P1：世界书 RAG 检索（query 取当前章末尾约 2000 字）
    const ragQuery = params.currentContent.slice(-2000);
    const worldbookEntries = await this.fetchRag(params.bookId, ragQuery);
    const ctx: PromptContext = {
      mode: 'continue',
      systemInstruction: '',
      enabledSkills: skills,
      characters,
      worldbookEntries,
      summaryChain,
      recentChapters,
      userInstruction: params.requirement,
      currentChapter: {
        id: params.chapterId,
        title: '',
        content: params.currentContent
      }
    };
    this.recordContext(params.bookId, ctx);
    const messages = this.promptAssembler.assemble(ctx);
    const config = await this.modelOf(params.bookId);
    yield* provider.stream(messages, {
      model: config,
      signal: params.signal,
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.85
    });
  }

  /** 改写选中文本 */
  async *rewrite(params: RewriteParams): AsyncIterable<ChatChunk> {
    const provider = await this.resolveProvider(params.bookId);
    const skills = await this.skillLoader.getEnabledForMode(params.bookId, 'rewrite');
    const ctx: PromptContext = {
      mode: 'rewrite',
      systemInstruction: '',
      enabledSkills: skills,
      characters: [],
      recentChapters: params.recentChapters,
      selectedText: params.selectedText,
      userInstruction: params.instruction
    };
    this.recordContext(params.bookId, ctx);
    const messages = this.promptAssembler.assemble(ctx);
    yield* provider.stream(messages, {
      model: await this.modelOf(params.bookId),
      signal: params.signal,
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.7
    });
  }

  /** 生成对白 */
  async *generateDialogue(params: DialogueParams): AsyncIterable<ChatChunk> {
    const provider = await this.resolveProvider(params.bookId);
    const skills = await this.skillLoader.getEnabledForMode(params.bookId, 'dialogue');
    const characters = await this.loadCharacters(params.characterIds);
    // P1：摘要链 + 最近 2 章原文
    const { summaryChain, recentChapters } = await this.fetchRecentContext(
      params.bookId,
      params.chapterId,
      params.recentChapters
    );
    // P1：世界书 RAG 检索（query 取场景描述）
    const worldbookEntries = await this.fetchRag(params.bookId, params.scene);
    const ctx: PromptContext = {
      mode: 'dialogue',
      systemInstruction: '',
      enabledSkills: skills,
      characters,
      worldbookEntries,
      summaryChain,
      recentChapters,
      userInstruction: params.scene
    };
    this.recordContext(params.bookId, ctx);
    const messages = this.promptAssembler.assemble(ctx);
    yield* provider.stream(messages, {
      model: await this.modelOf(params.bookId),
      signal: params.signal,
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.9
    });
  }

  /** 一致性检查：非流式，返回结构化报告（不注入文风 Skill） */
  async checkConsistency(params: CheckParams): Promise<ConsistencyReport> {
    const provider = await this.resolveProvider(params.bookId);
    // check 模式不注入文风 Skill：通过 applies_to 过滤自然排除
    const skills = await this.skillLoader.getEnabledForMode(params.bookId, 'check');
    const characters = await this.loadCharacters(
      (
        await this.bridge.db.query<{ id: string }>(
          'SELECT id FROM characters WHERE book_id = ?',
          [params.bookId]
        )
      ).map((r) => r.id)
    );
    const worldbook = await this.loadWorldbook(params.bookId);

    const checkCtx: PromptContext = {
      mode: 'check',
      systemInstruction: '',
      enabledSkills: skills, // 文风 Skill 的 applies_to 不含 check，此处为空
      characters,
      worldbookEntries: worldbook,
      recentChapters: [],
      currentChapter: {
        id: params.chapterId,
        title: '',
        content: params.chapterContent
      }
    };
    this.recordContext(params.bookId, checkCtx);
    const messages = this.promptAssembler.assemble(checkCtx);

    const res = await provider.chat(messages, {
      model: await this.modelOf(params.bookId),
      signal: params.signal,
      maxTokens: 4096,
      temperature: 0.2
    });

    return this.parseReport(res.content);
  }

  /** 从模型输出解析矛盾报告（容忍 markdown 代码块包裹） */
  private parseReport(raw: string): ConsistencyReport {
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    try {
      const parsed = JSON.parse(text) as {
        contradictions?: Array<{
          severity?: string;
          description?: string;
          relatedSetting?: string;
          chapterExcerpt?: string;
        }>;
      };
      return {
        contradictions: (parsed.contradictions ?? []).map((c) => ({
          severity: (['high', 'medium', 'low'].includes(String(c.severity))
            ? c.severity
            : 'medium') as 'high' | 'medium' | 'low',
          description: String(c.description ?? ''),
          relatedSetting: String(c.relatedSetting ?? ''),
          chapterExcerpt: String(c.chapterExcerpt ?? '')
        })),
        checkedAt: Date.now()
      };
    } catch {
      return {
        contradictions: [
          {
            severity: 'low',
            description: `模型输出无法解析为 JSON，原文如下：${raw.slice(0, 500)}`,
            relatedSetting: '',
            chapterExcerpt: ''
          }
        ],
        checkedAt: Date.now()
      };
    }
  }

  /** 书籍绑定的模型名 */
  private async modelOf(bookId: string): Promise<string> {
    const book = await this.bridge.db.queryOne<{ provider_config_id: string | null }>(
      'SELECT provider_config_id FROM books WHERE id = ?',
      [bookId]
    );
    let configId = book?.provider_config_id ?? null;
    if (!configId) {
      const first = await this.bridge.db.queryOne<{ id: string }>(
        'SELECT id FROM provider_configs ORDER BY created_at ASC LIMIT 1'
      );
      configId = first?.id ?? null;
    }
    if (!configId) throw new Error('未配置任何模型');
    const row = await this.bridge.db.queryOne<{ model: string }>(
      'SELECT model FROM provider_configs WHERE id = ?',
      [configId]
    );
    if (!row) throw new Error('模型配置不存在');
    return row.model;
  }
}

export type { ChatChunk };
export { createProvider };
