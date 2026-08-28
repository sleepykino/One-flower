/**
 * AIOrchestrator：模式路由器（核心差异化）
 * continue / rewrite / dialogue 流式；check 非流式返回结构化报告
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { SkillLoader } from '../skill/SkillLoader';
import type { PromptAssembler, PromptContext, TokenBreakdown, ForcedReference } from './PromptAssembler';
import { DEFAULT_TOKEN_BUDGET } from './PromptAssembler';
import type { LLMProvider, ChatChunk, ChatMessage } from './providers/LLMProvider';
import { createProvider } from './providers/LLMProvider';
import type { GlobalPromptService } from './GlobalPromptService';
import type { ProjectDirectiveService } from './ProjectDirectiveService';
import type { FeatureKey } from './modelRouting';
import { resolveProviderConfigIdForFeature } from './providerResolver';
import type { SummaryService } from '../summary/SummaryService';
import type { WorldbookRAGService } from '../worldbook/WorldbookRAGService';
import type { FullRAGService, SegmentRecall } from '../rag/FullRAGService';
import type {
  AiReference,
  Character,
  CheckParams,
  ConsistencyReport,
  ContinueParams,
  DialogueParams,
  RewriteParams,
  TypoCheckParams,
  TypoReport
} from './types';
import { docToPlainText } from '../../utils/pmdoc';
import { parseLooseJson } from '../../utils/looseJson';
import type { ProseMirrorDoc } from '../../types';

/** P1/P2 依赖（可选注入，不破坏 P0 构造签名） */
export interface OrchestratorDeps {
  summaryService?: SummaryService;
  ragService?: WorldbookRAGService;
  /** P2：全量 RAG（三路检索），可用时替代 ragService 单路 */
  fullRagService?: FullRAGService;
}

/** 最近一次 AI 调用的上下文快照（ContextPanel 展示用） */
export interface ContextSnapshot {
  bookId: string;
  mode: string;
  ctx: PromptContext;
  breakdown: TokenBreakdown[];
  totalTokens: number;
  /** P2 二期：本次调用实际使用的模型名（成本路由可见性） */
  model?: string;
  at: number;
}

export class AIOrchestrator {
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private skillLoader: SkillLoader;
  private promptAssembler: PromptAssembler;
  private bridge: NativeBridge;
  private deps: OrchestratorDeps;
  private lastContext = new Map<string, ContextSnapshot>();
  /** P2.1-M1：全局提示词（app-context 装配 setter 注入） */
  private globalPromptService?: GlobalPromptService;
  /** 项目级 agents.md 指令书（app-context 装配 setter 注入） */
  private projectDirectiveService?: ProjectDirectiveService;

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

  /** P2.1-M1：全局提示词服务装配（同 search.setChapterService 先例） */
  setGlobalPromptService(gp: GlobalPromptService): void {
    this.globalPromptService = gp;
  }

  /** 项目级指令服务装配（agents.md 注入 system 段最高优先级） */
  setProjectDirectiveService(pd: ProjectDirectiveService): void {
    this.projectDirectiveService = pd;
  }

  /** ContextPanel 用：取最近一次调用的上下文快照 */
  getLastContext(bookId: string): ContextSnapshot | null {
    return this.lastContext.get(bookId) ?? null;
  }

  /** 记录上下文快照（每次 assemble 后调用） */
  private recordContext(bookId: string, ctx: PromptContext, model?: string): void {
    const breakdown = this.promptAssembler.inspect(ctx);
    const totalTokens = breakdown.reduce((sum, b) => sum + b.tokens, 0);
    this.lastContext.set(bookId, {
      bookId,
      mode: ctx.mode,
      ctx,
      breakdown,
      totalTokens,
      model,
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

  /** P2：世界书 + 原文片段检索（优先全量 RAG 三路，失败回退 P1 世界书单路） */
  private async fetchRag(
    bookId: string,
    query: string
  ): Promise<{
    worldbookEntries: Parameters<PromptAssembler['assemble']>[0]['worldbookEntries'];
    segments: SegmentRecall[] | undefined;
  }> {
    const empty = { worldbookEntries: undefined, segments: undefined };
    if (!query.trim()) return empty;
    if (this.deps.fullRagService) {
      try {
        const rag = await this.deps.fullRagService.retrieve(query, bookId);
        return {
          worldbookEntries: rag.worldbookEntries.length > 0 ? rag.worldbookEntries : undefined,
          segments: rag.segments.length > 0 ? rag.segments : undefined
        };
      } catch (e) {
        console.warn('[AI] 全量 RAG 检索失败，回退世界书单路:', e);
      }
    }
    if (!this.deps.ragService) return empty;
    try {
      const hits = await this.deps.ragService.retrieve(query, bookId, 3);
      return { worldbookEntries: hits.length > 0 ? hits : undefined, segments: undefined };
    } catch (e) {
      console.warn('[AI] 世界书 RAG 检索失败，已跳过:', e);
      return empty;
    }
  }

  /** 读取本次调用使用的 provider（P2 二期：按功能点路由，功能绑定 -> 第一组配置） */
  private async resolveProvider(bookId: string, feature: FeatureKey): Promise<LLMProvider> {
    const configId = await resolveProviderConfigIdForFeature(this.bridge, bookId, feature);
    if (!configId) throw new Error('未配置任何模型，请先到设置页添加 Provider 配置');
    return this.providerFactory(configId);
  }

  /**
   * 批次11-6：角色卡按「当前章出场频率」降序排序（出场次数多者优先）。
   * 使超预算截断时当前章关键角色不被截掉；同频保持原有顺序（稳定排序）。仅作用于注入排序，不改选中集合。
   */
  private sortCharactersByRelevance(chars: Character[], currentContent: string): Character[] {
    if (chars.length <= 1 || !currentContent) return chars;
    const freq = new Map<string, number>();
    for (const c of chars) {
      const name = c.name?.trim();
      if (!name) continue;
      let n = 0;
      let idx = currentContent.indexOf(name);
      while (idx !== -1) {
        n++;
        idx = currentContent.indexOf(name, idx + name.length);
      }
      freq.set(name, n);
    }
    return [...chars].sort((a, b) => (freq.get(b.name ?? '') ?? 0) - (freq.get(a.name ?? '') ?? 0));
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
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(r.data ?? '{}')) as Record<string, unknown>;
      } catch {
        data = {};
      }
      let tags: string[];
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
      'SELECT id, title, category, content FROM worldbook_entries WHERE book_id = ? AND enabled = 1',
      [bookId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      category: (r.category as string) ?? null,
      content: String(r.content ?? '')
    }));
  }

  /** P2.1-M1/M2：四模式组装 PromptContext 后统一补充（globalPrompts / forcedRefs），须在 recordContext 前调用 */
  private async applyCtxExtras(
    ctx: PromptContext,
    bookId: string,
    aiReferences?: AiReference[]
  ): Promise<void> {
    if (this.projectDirectiveService) {
      try {
        ctx.projectDirective = await this.projectDirectiveService.agentsText(bookId);
      } catch (e) {
        console.warn('[AI] 读取本书 agents.md 失败，已跳过:', e);
      }
    }
    if (this.globalPromptService) {
      try {
        ctx.globalPrompts = await this.globalPromptService.enabledTexts();
      } catch (e) {
        console.warn('[AI] 读取全局提示词失败，已跳过:', e);
        ctx.globalPrompts = [];
      }
    }
    if (aiReferences && aiReferences.length > 0) {
      ctx.forcedRefs = await this.loadForcedRefs(bookId, aiReferences);
    }
  }

  /** P2.1-M2：解析引用标记为全文强制引用（失败的条目跳过，不打断生成） */
  private async loadForcedRefs(bookId: string, refs: AiReference[]): Promise<ForcedReference[]> {
    const out: ForcedReference[] = [];
    for (const r of refs) {
      try {
        if (r.refType === 'character') {
          const row = await this.bridge.db.queryOne<Record<string, unknown>>(
            'SELECT id, name, data FROM characters WHERE id = ?',
            [r.refId]
          );
          if (!row) continue;
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(String(row.data ?? '{}')) as Record<string, unknown>;
          } catch {
            data = {};
          }
          const details = Object.entries(data)
            .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
            .map(([k, v]) => `- ${k}: ${String(v)}`)
            .join('\n');
          out.push({
            refType: 'character',
            refId: r.refId,
            label: String(row.name),
            content: details || '（角色卡无字段）'
          });
        } else if (r.refType === 'worldbook') {
          const row = await this.bridge.db.queryOne<{ title: string; content: string }>(
            'SELECT title, content FROM worldbook_entries WHERE id = ? AND enabled = 1',
            [r.refId]
          );
          if (!row) continue;
          out.push({
            refType: 'worldbook',
            refId: r.refId,
            label: String(row.title),
            content: String(row.content ?? '')
          });
        } else {
          const text = await this.loadChapterPlainText(bookId, r.refId);
          if (text === null) continue;
          out.push({
            refType: 'chapter',
            refId: r.refId,
            label: r.label,
            content: text.length > 800 ? `${text.slice(0, 800)}…` : text
          });
        }
      } catch (e) {
        console.warn('[AI] 加载强制引用失败，已跳过:', r.label, e);
      }
    }
    return out;
  }

  /** 读取章节正文纯文本（从落盘 JSON），失败返回 null */
  private async loadChapterPlainText(bookId: string, chapterId: string): Promise<string | null> {
    const row = await this.bridge.db.queryOne<{ content_path: string | null }>(
      'SELECT content_path FROM chapters WHERE id = ?',
      [chapterId]
    );
    if (!row) return null;
    let path = row.content_path ?? null;
    if (!path) {
      const book = await this.bridge.db.queryOne<{ storage_dir: string }>(
        'SELECT storage_dir FROM books WHERE id = ?',
        [bookId]
      );
      if (!book) return null;
      path = `${String(book.storage_dir)}/chapters/${chapterId}.json`;
    }
    try {
      const raw = await this.bridge.fs.readFile(path);
      const doc = JSON.parse(raw) as ProseMirrorDoc;
      if (doc?.type !== 'doc') return null;
      return docToPlainText(doc);
    } catch {
      return null;
    }
  }

  /** P2.1-M7：暴露三路检索给编排层（长文节拍表初稿用），不改既有私有语义 */
  async retrieveRag(
    bookId: string,
    query: string
  ): Promise<{
    worldbookEntries?: Array<{ id: string; title: string; category: string | null; content: string }>;
    segments?: SegmentRecall[];
  }> {
    return this.fetchRag(bookId, query);
  }

  /** P2.1-M6：读取本书非豁免设定事实 + 推导链作为"时代感基线"（check 模式注入） */
  private async loadSettingBaseline(
    bookId: string
  ): Promise<PromptContext['settingBaseline'] | undefined> {
    try {
      const facts = await this.bridge.db.query<{ domain: string; fact: string; basis: string }>(
        'SELECT domain, fact, basis FROM setting_facts WHERE book_id = ? AND exempt = 0 ORDER BY created_at ASC',
        [bookId]
      );
      const chains = await this.bridge.db.query<{ premise: string; conclusion: string }>(
        `SELECT si.premise, si.conclusion FROM setting_inferences si
         JOIN setting_facts sf ON sf.id = si.fact_id
         WHERE si.book_id = ? AND sf.exempt = 0 ORDER BY si.created_at ASC`,
        [bookId]
      );
      if (facts.length === 0 && chains.length === 0) return undefined;
      return {
        facts: facts.map((f) => ({
          domain: String(f.domain),
          fact: String(f.fact),
          basis: String(f.basis)
        })),
        chains: chains.map((c) => ({
          premise: String(c.premise),
          conclusion: String(c.conclusion)
        }))
      };
    } catch (e) {
      console.warn('[AI] 读取时代感基线失败，已跳过:', e);
      return undefined;
    }
  }

  /** 续写：流式返回，支持 AbortSignal 中断 */
  async *continueWriting(params: ContinueParams): AsyncIterable<ChatChunk> {
    const provider = await this.resolveProvider(params.bookId, 'continue');
    const skills = await this.skillLoader.getEnabledForMode(params.bookId, 'continue');
    // 批次11-6：按当前章出场频率排序角色卡，使超预算截断保留当前章关键角色
    const characters = this.sortCharactersByRelevance(
      await this.loadCharacters(params.selectedCharacterIds),
      params.currentContent
    );
    // P1：摘要链 + 最近 2 章原文（失败回退滑动窗口）
    const { summaryChain, recentChapters } = await this.fetchRecentContext(
      params.bookId,
      params.chapterId,
      params.recentChapters
    );
    // P2：三路检索（默认取当前章末尾约 2000 字；长文等场景可用 ragQuery 覆盖以提升召回）
    const ragQuery = params.ragQuery?.trim() ? params.ragQuery : params.currentContent.slice(-2000);
    const { worldbookEntries, segments } = await this.fetchRag(params.bookId, ragQuery);
    const ctx: PromptContext = {
      mode: 'continue',
      systemInstruction: '',
      enabledSkills: skills,
      characters,
      worldbookEntries,
      summaryChain,
      segments,
      recentChapters,
      userInstruction: params.requirement,
      currentChapter: {
        id: params.chapterId,
        title: '',
        content: params.currentContent
      }
    };
    // 批次11-6：长文模式放大角色卡预算（承载全书角色）
    if (params.characterBudget) ctx.characterBudget = params.characterBudget;
    if (params.beat) ctx.currentBeat = params.beat;
    await this.applyCtxExtras(ctx, params.bookId, params.aiReferences);
    const model = await this.modelOf(params.bookId, 'continue');
    this.recordContext(params.bookId, ctx, model);
    const messages = this.promptAssembler.assemble(ctx);
    yield* provider.stream(messages, {
      model,
      signal: params.signal,
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.85
    });
  }

  /** 改写选中文本 */
  async *rewrite(params: RewriteParams): AsyncIterable<ChatChunk> {
    const provider = await this.resolveProvider(params.bookId, 'rewrite');
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
    await this.applyCtxExtras(ctx, params.bookId, params.aiReferences);
    const model = await this.modelOf(params.bookId, 'rewrite');
    this.recordContext(params.bookId, ctx, model);
    const messages = this.promptAssembler.assemble(ctx);
    yield* provider.stream(messages, {
      model,
      signal: params.signal,
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.7
    });
  }

  /** 生成对白 */
  async *generateDialogue(params: DialogueParams): AsyncIterable<ChatChunk> {
    const provider = await this.resolveProvider(params.bookId, 'dialogue');
    const skills = await this.skillLoader.getEnabledForMode(params.bookId, 'dialogue');
    const characters = await this.loadCharacters(params.characterIds);
    // P1：摘要链 + 最近 2 章原文
    const { summaryChain, recentChapters } = await this.fetchRecentContext(
      params.bookId,
      params.chapterId,
      params.recentChapters
    );
    // P2：三路检索（query 取场景描述）
    const { worldbookEntries, segments } = await this.fetchRag(params.bookId, params.scene);
    const ctx: PromptContext = {
      mode: 'dialogue',
      systemInstruction: '',
      enabledSkills: skills,
      characters,
      worldbookEntries,
      summaryChain,
      segments,
      recentChapters,
      userInstruction: params.scene
    };
    await this.applyCtxExtras(ctx, params.bookId, params.aiReferences);
    const model = await this.modelOf(params.bookId, 'dialogue');
    this.recordContext(params.bookId, ctx, model);
    const messages = this.promptAssembler.assemble(ctx);
    yield* provider.stream(messages, {
      model,
      signal: params.signal,
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.9
    });
  }

  /** 一致性检查：非流式，返回结构化报告（不注入文风 Skill） */
  async checkConsistency(params: CheckParams): Promise<ConsistencyReport> {
    const provider = await this.resolveProvider(params.bookId, 'check');
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
    await this.applyCtxExtras(checkCtx, params.bookId, params.aiReferences);
    checkCtx.settingBaseline = await this.loadSettingBaseline(params.bookId);
    const model = await this.modelOf(params.bookId, 'check');
    this.recordContext(params.bookId, checkCtx, model);
    const messages = this.promptAssembler.assemble(checkCtx);

    const res = await provider.chat(messages, {
      model,
      signal: params.signal,
      maxTokens: 4096,
      temperature: 0.2
    });

    return this.parseReport(res.content);
  }

  /** 错字检查：非流式，返回结构化错字列表（纯校对任务，不组装上下文、不注入 Skill） */
  async checkTypos(params: TypoCheckParams): Promise<TypoReport> {
    const provider = await this.resolveProvider(params.bookId, 'typo-check');
    const model = await this.modelOf(params.bookId, 'typo-check');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          '你是专业的中文小说校对员。找出正文中的错别字：写错的字、同音/形近的别字、明显的多字漏字。',
          '只报告有把握的错误，不涉及文风、标点偏好、主观表达，也不修改故事内容。',
          'original 必须从正文中逐字摘取 4-10 字（含错字），与正文完全一致，作为定位替换依据。',
          '输出严格 JSON，不要任何其他文字：',
          '{"typos":[{"original":"含错字的原文片段","suggestion":"修正后的完整片段","reason":"简短原因"}]}',
          '若没有错别字，输出 {"typos":[]}。'
        ].join('\n')
      },
      { role: 'user', content: `【正文】\n${params.chapterContent}` }
    ];
    const res = await provider.chat(messages, {
      model,
      signal: params.signal,
      maxTokens: 2048,
      temperature: 0.1
    });
    return this.parseTypoReport(res.content);
  }

  /** 从模型输出解析错字报告（容忍 markdown 围栏/杂文/注释，公共实现 parseLooseJson；解析失败抛错提示用户） */
  private parseTypoReport(raw: string): TypoReport {
    const parsed = parseLooseJson<{
      typos?: Array<{ original?: string; suggestion?: string; reason?: string }>;
    }>(raw);
    if (!parsed) throw new Error(`模型输出无法解析为 JSON：${raw.slice(0, 200)}`);
    return {
      typos: (parsed.typos ?? [])
        .filter(
          (t) =>
            typeof t.original === 'string' &&
            typeof t.suggestion === 'string' &&
            t.original.trim() !== '' &&
            t.suggestion.trim() !== '' &&
            t.original !== t.suggestion
        )
        .map((t) => ({
          original: String(t.original),
          suggestion: String(t.suggestion),
          reason: String(t.reason ?? '')
        })),
      checkedAt: Date.now()
    };
  }

  /** 从模型输出解析矛盾报告（容忍 markdown 围栏/杂文/注释） */
  private parseReport(raw: string): ConsistencyReport {
    const parsed = parseLooseJson<{
      contradictions?: Array<{
        severity?: string;
        description?: string;
        relatedSetting?: string;
        chapterExcerpt?: string;
      }>;
    }>(raw);
    if (parsed) {
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
    }
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

  /** 本次调用使用的模型名（P2 二期：按功能点路由） */
  private async modelOf(bookId: string, feature: FeatureKey): Promise<string> {
    const configId = await resolveProviderConfigIdForFeature(this.bridge, bookId, feature);
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
