/**
 * LongFormService（P2.1-M7）：章节级"规划-生成-自洽"循环编排层
 * 循环调用 orchestrator.continueWriting（不新增 AIMode），存量 Skill/预算/三路检索自动生效
 * 服务层不依赖 editorApi：流式输出经 hooks 由 LongFormPanel 桥接
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { WriteQueue } from '../../db/WriteQueue';
import type { AIOrchestrator } from '../ai/AIOrchestrator';
import type { GenerationContextService } from '../ai/GenerationContext';
import type { AiReference } from '../ai/types';
import type { TaskCenterService } from '../task/TaskCenterService';
import type { ChapterService } from '../chapter/ChapterService';
import { resolveProviderForFeature, resolveModelNameForFeature } from '../ai/providerResolver';
import type { LLMProvider } from '../ai/providers/LLMProvider';
import type { LongFormBeat, LongFormRunHooks, LongFormSession, SeamIssue } from './types';
import { countTokens, truncateToTokenBudget } from '../../utils/tokens';
import { docToPlainText } from '../../utils/pmdoc';
import { parseLooseJson } from '../../utils/looseJson';

/** 单次调用的固定上下文开销估算（token） */
const PER_CALL_OVERHEAD = 800;
/** 节拍初稿（draft）单次调用估算 token：输入（摘要+大纲+尾段+RAG）+ 输出节拍表 */
const DRAFT_TOKENS = 2000;
/** 接缝自检（seam）单批调用估算 token：输入接缝摘录 + 输出 JSON */
const SEAM_TOKENS = 1500;
/** 接缝自检每批处理的接缝数（分批防止单次 maxTokens=4096 被多接缝截断） */
const SEAM_BATCH = 4;
/** 长文模式角色卡 token 预算（批次11-6：由默认 1500 放大到 5000，承载全书角色；草稿注入与生成循环共用） */
const LONG_FORM_CHARACTER_BUDGET = 5000;

const ACTIVE_STATUSES = "('ready','running','paused','seam-review')";

const DRAFT_SYSTEM = `你是小说章节节拍规划师。基于前情摘要、本章大纲与相关设定，为本章规划连贯的节拍表（每拍 = 一个场景/事件单元）。
严格只输出 JSON 数组（不要 markdown 代码围栏、不要解释）：
[{"text":"节拍描述（一句话场景/事件）","targetWords":600}]
要求：节拍数与字数严格遵守用户指定；前后节拍因果连贯；不要输出其他字段。`;

const SEAM_SYSTEM = `你是小说接缝审校。给定同一章内相邻两拍的首尾段落（第 N 拍结尾 -> 第 N+1 拍开头），检查接缝处的问题。
严格只输出 JSON 数组（不要 markdown 代码围栏）：
[{"beatIndex":0,"kind":"tone|address|timeline|repetition|other","description":"问题描述（语气突变/称呼不一致/时间线断裂/重复描写）","excerpt":"接缝前后摘录（各约 100 字）"}
]
beatIndex 为接缝前那一拍的 0-based 序号；无问题输出 []。`;

/** 容错 JSON 解析（公共实现见 utils/looseJson） */
const parseJsonLoose = parseLooseJson;

export class LongFormService {
  private bridge: NativeBridge;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private orchestrator: AIOrchestrator;
  private tasks: TaskCenterService;
  private chapters: ChapterService;
  /** 批次11-4：不经 orchestrator 的调用统一补充全局提示词 + 文风 Skill */
  private generation: GenerationContextService;
  /** 会话 -> 任务 id（pause 经任务取消触发 abort） */
  private taskIds = new Map<string, string>();
  /** 会话 -> 接缝自检结果（内存态，UI 读取展示） */
  private seamIssues = new Map<string, SeamIssue[]>();
  private chapterTitleCache = new Map<string, string>();

  constructor(
    bridge: NativeBridge,
    db: { wq: WriteQueue },
    providerFactory: (configId: string) => Promise<LLMProvider>,
    orchestrator: AIOrchestrator,
    tasks: TaskCenterService,
    chapters: ChapterService,
    generation: GenerationContextService
  ) {
    this.bridge = bridge;
    this.wq = db.wq;
    this.providerFactory = providerFactory;
    this.orchestrator = orchestrator;
    this.tasks = tasks;
    this.chapters = chapters;
    this.generation = generation;
  }

  // ---------------- 步骤 1：节拍表初稿 ----------------

  /** 节拍表初稿：读摘要链+章大纲+RAG 检索，一次 LLM 调用出 JSON beats（严格 JSON 解析，失败重试 1 次） */
  async draftBeats(params: {
    bookId: string;
    chapterId: string;
    beatCount: number; // 3-8
    totalWords: number; // 3000-8000
    hints?: string;
    signal?: AbortSignal;
  }): Promise<LongFormBeat[]> {
    // P2 二期：节拍规划走 'longform-draft' 功能点路由（低频小任务，可绑中弱模型）
    const provider = await resolveProviderForFeature(this.bridge, params.bookId, 'longform-draft', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, params.bookId, 'longform-draft');

    // 材料：前情摘要（近 5 章摘要）+ 本章大纲 + 已有正文尾段 + RAG + 本书角色卡概要（批次11-1）
    const summaryRows = await this.bridge.db.query<{ title: string; summary: string }>(
      `SELECT title, summary FROM chapters
       WHERE book_id = ? AND id != ? AND summary IS NOT NULL
       ORDER BY sort_order DESC, created_at DESC LIMIT 5`,
      [params.bookId, params.chapterId]
    );
    const chapter = await this.chapters.get(params.chapterId);
    const outline = chapter?.outline ?? '';
    const tail = (await this.loadChapterText(params.chapterId)).slice(-800);
    const ragQuery = `${outline}\n${tail}`.trim();
    const rag = await this.orchestrator.retrieveRag(params.bookId, ragQuery).catch(() => ({
      worldbookEntries: undefined,
      segments: undefined
    }));

    const material: string[] = [];
    // 批次11-1：注入角色卡概要，让节拍规划师知晓出场角色与弧光（与后续生成循环装配对齐）
    const characters = await this.loadCharacterSummaries(params.bookId);
    if (characters) material.push('【本书角色卡概要】', characters);
    if (summaryRows.length > 0) {
      material.push(
        '【前情摘要（远 -> 近）】',
        summaryRows
          .reverse()
          .map((s) => `《${s.title}》：${s.summary}`)
          .join('\n')
      );
    }
    if (outline) material.push('【本章大纲】', outline);
    if (tail) material.push('【本章已有内容（尾段）】', tail);
    if (rag.worldbookEntries && rag.worldbookEntries.length > 0) {
      material.push(
        '【相关世界书】',
        rag.worldbookEntries.map((w) => `- ${w.title}: ${w.content}`).join('\n')
      );
    }
    if (rag.segments && rag.segments.length > 0) {
      material.push(
        '【相关原文片段】',
        rag.segments.map((s) => `- 《${s.chapterTitle}》：${s.excerpt}`).join('\n')
      );
    }
    if (params.hints?.trim()) material.push('【作者补充提示】', params.hints.trim());

    const user = [
      material.join('\n\n'),
      '',
      `【任务】规划 ${params.beatCount} 个节拍，总字数约 ${params.totalWords} 字（各拍 targetWords 合计接近该值）。`
    ].join('\n');

    // 批次11-4：统一补充作者全局要求 + 文风 Skill（节拍规划与长文风格保持感知）
    const extras = await this.generation.systemExtras(params.bookId, 'continue');
    const systemContent = [DRAFT_SYSTEM, ...extras].join('\n\n');

    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (params.signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const res = await provider.chat(
        [
          { role: 'system', content: systemContent },
          { role: 'user', content: user }
        ],
        { model, temperature: 0.6, maxTokens: 4096, signal: params.signal }
      );
      const parsed = parseJsonLoose<Array<{ text?: string; targetWords?: number }>>(res.content);
      if (Array.isArray(parsed)) {
        const beats: LongFormBeat[] = parsed
          .filter((b) => String(b.text ?? '').trim() !== '')
          .slice(0, 8)
          .map((b) => ({
            id: crypto.randomUUID(),
            text: String(b.text).trim(),
            targetWords: Math.min(
              3000,
              Math.max(100, Math.round(Number(b.targetWords ?? params.totalWords / params.beatCount)))
            ),
            status: 'pending' as const
          }));
        if (beats.length > 0) return beats;
      }
      lastErr = res.content.slice(0, 200);
    }
    throw new Error(`节拍表生成失败（模型未返回合法 JSON）：${lastErr}`);
  }

  // ---------------- 步骤 2：成本预估 ----------------

  /** 成本预估：节拍初稿 ×1 + 逐拍生成 + 接缝自检（分批）；
   *  estimatedTokens ≈ Σ(targetWords × 2.2 + 单次上下文开销) + 初稿/自检 token */
  estimate(beats: LongFormBeat[]): { calls: number; estimatedTokens: number } {
    const genCalls = beats.length;
    const seams = Math.max(0, beats.length - 1);
    const seamCalls = seams > 0 ? Math.ceil(seams / SEAM_BATCH) : 0;
    const calls = 1 + genCalls + seamCalls;
    const estimatedTokens =
      beats.reduce((sum, b) => sum + Math.round(b.targetWords * 2.2) + PER_CALL_OVERHEAD, 0) +
      DRAFT_TOKENS +
      SEAM_TOKENS * seamCalls;
    return { calls, estimatedTokens };
  }

  // ---------------- 会话持久化 ----------------

  createSession(
    chapterId: string,
    beats: LongFormBeat[],
    opts?: { hints?: string; characterIds?: string[] }
  ): Promise<LongFormSession> {
    return this.createSessionInner(chapterId, beats, opts);
  }

  private async createSessionInner(
    chapterId: string,
    beats: LongFormBeat[],
    opts?: { hints?: string; characterIds?: string[] }
  ): Promise<LongFormSession> {
    const chapter = await this.chapters.get(chapterId);
    if (!chapter) throw new Error('章节不存在');
    const active = await this.findActive(chapter.bookId);
    if (active) {
      throw new Error('本书已存在进行中的长文会话，请先恢复或丢弃');
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const est = this.estimate(beats);
    await this.wq.enqueue(() =>
      this.bridge.db.exec(
        `INSERT INTO longform_sessions (id, book_id, chapter_id, status, beats, current_beat_index, used_tokens, estimated_tokens, hints, character_ids, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', ?, 0, 0, ?, ?, ?, ?, ?)`,
        [
          id,
          chapter.bookId,
          chapterId,
          JSON.stringify(beats),
          est.estimatedTokens,
          opts?.hints?.trim() ?? '',
          JSON.stringify(opts?.characterIds ?? []),
          now,
          now
        ]
      )
    );
    return (await this.getSession(id))!;
  }

  async getSession(sessionId: string): Promise<LongFormSession | null> {
    const row = await this.bridge.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM longform_sessions WHERE id = ?',
      [sessionId]
    );
    return row ? this.rowToSession(row) : null;
  }

  /** status in ready/running/paused/seam-review 的会话（每书同时最多一个） */
  async findActive(bookId: string): Promise<LongFormSession | null> {
    const row = await this.bridge.db.queryOne<Record<string, unknown>>(
      `SELECT * FROM longform_sessions WHERE book_id = ? AND status IN ${ACTIVE_STATUSES}
       ORDER BY updated_at DESC LIMIT 1`,
      [bookId]
    );
    return row ? this.rowToSession(row) : null;
  }

  /**
   * 纠正「僵尸 active 会话」（批次4建议1）：状态要求有运行中任务（ready/running/seam-review），
   * 但任务中心（内存态）无对应 running 任务——典型为重启/杀进程后任务中心消亡，status 残留。
   * 此时 pause() 无任务可取消（taskIds 已空）、UI 只有「暂停」无「恢复/丢弃」入口，会话卡死无法处置。
   * 置为 paused 使其走既有「恢复生成 / 丢弃」控制，重启自愈不留死会话。
   * 本进程确有对应 running 任务的会话视为正常生成，跳过纠正，不误伤运行中任务。
   */
  async healZombie(session: LongFormSession): Promise<{ session: LongFormSession; wasHealed: boolean }> {
    const zombieLike =
      session.status === 'ready' || session.status === 'running' || session.status === 'seam-review';
    if (!zombieLike) return { session, wasHealed: false };
    const taskId = this.taskIds.get(session.id);
    if (taskId && this.tasks.list().some((t) => t.id === taskId && t.status === 'running')) {
      return { session, wasHealed: false }; // 确有运行中任务，非假死
    }
    const healed = await this.patchSession(session.id, (s) => {
      if (s.status === session.status) s.status = 'paused';
    });
    return { session: healed ?? session, wasHealed: true };
  }

  /** 步骤 1 编辑节拍表后保存，过 wq */
  async saveBeats(sessionId: string, beats: LongFormBeat[]): Promise<void> {
    await this.patchSession(sessionId, (s) => {
      s.beats = beats;
    });
  }

  /** 丢弃会话（直接删除记录） */
  async deleteSession(sessionId: string): Promise<void> {
    this.taskIds.delete(sessionId);
    this.seamIssues.delete(sessionId);
    this.chapterTitleCache.delete(sessionId);
    await this.wq.enqueue(() =>
      this.bridge.db.exec('DELETE FROM longform_sessions WHERE id = ?', [sessionId])
    );
  }

  private rowToSession(r: Record<string, unknown>): LongFormSession {
    let beats: LongFormBeat[] = [];
    try {
      const parsed = JSON.parse(String(r.beats ?? '[]')) as unknown;
      if (Array.isArray(parsed)) {
        beats = parsed.filter(
          (b): b is LongFormBeat =>
            typeof b === 'object' && b !== null && typeof (b as LongFormBeat).text === 'string'
        );
      }
    } catch {
      beats = [];
    }
    let characterIds: string[] = [];
    try {
      const parsed = JSON.parse(String(r.character_ids ?? '[]')) as unknown;
      if (Array.isArray(parsed)) {
        characterIds = parsed.filter((c): c is string => typeof c === 'string');
      }
    } catch {
      characterIds = [];
    }
    // 批次4建议2：seams 为可选列（旧库无）；有值才解出，用于重启后回读遗留接缝问题
    let seams: SeamIssue[] | undefined;
    try {
      const raw = r.seams;
      if (raw) {
        const parsed = JSON.parse(String(raw)) as unknown;
        if (Array.isArray(parsed)) {
          seams = parsed.filter(
            (s): s is SeamIssue =>
              typeof s === 'object' && s !== null && typeof (s as SeamIssue).beatIndex === 'number'
          );
        }
      }
    } catch {
      seams = undefined;
    }
    return {
      id: String(r.id),
      bookId: String(r.book_id),
      chapterId: String(r.chapter_id),
      status: String(r.status) as LongFormSession['status'],
      beats,
      currentBeatIndex: Number(r.current_beat_index ?? 0),
      usedTokens: Number(r.used_tokens ?? 0),
      estimatedTokens: Number(r.estimated_tokens ?? 0),
      hints: (r.hints as string) ?? '',
      characterIds,
      seams,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    };
  }

  /** 会话字段更新（读-改-写，过 wq） */
  private async patchSession(
    sessionId: string,
    patch: (s: LongFormSession) => void
  ): Promise<LongFormSession | null> {
    const s = await this.getSession(sessionId);
    if (!s) return null;
    patch(s);
    s.updatedAt = Date.now();
    await this.wq.enqueue(() =>
      this.bridge.db.exec(
        'UPDATE longform_sessions SET status = ?, beats = ?, current_beat_index = ?, used_tokens = ?, estimated_tokens = ?, hints = ?, character_ids = ?, updated_at = ? WHERE id = ?',
        [
          s.status,
          JSON.stringify(s.beats),
          s.currentBeatIndex,
          s.usedTokens,
          s.estimatedTokens,
          s.hints ?? '',
          JSON.stringify(s.characterIds ?? []),
          s.updatedAt,
          sessionId
        ]
      )
    );
    return s;
  }

  // ---------------- 步骤 3：生成循环 ----------------

  /** 启动/恢复：注册任务中心 'longform' 任务，循环逐 beat 生成 */
  start(sessionId: string, hooks: LongFormRunHooks, opts?: { aiReferences?: AiReference[] }): void {
    const runCtx = { hooks, opts };
    const exec = (): void => {
      const info = this.tasks.register({
        kind: 'longform',
        title: `长文生成 · ${this.chapterTitleCache.get(sessionId) ?? ''}`,
        cancellable: true,
        run: async ({ report, signal }) => {
          await this.runLoop(sessionId, runCtx, report, signal);
        },
        retry: exec
      });
      this.taskIds.set(sessionId, info.id);
    };
    if (this.chapterTitleCache.has(sessionId)) {
      exec();
      return;
    }
    // 预取章节标题用于任务名，然后注册
    void this.getSession(sessionId).then(async (s) => {
      if (s) {
        this.chapterTitleCache.set(sessionId, (await this.chapters.get(s.chapterId))?.title ?? '');
      }
      exec();
    });
  }

  /** 当前拍写完后停：abort -> status=paused 持久化 */
  pause(sessionId: string): void {
    const taskId = this.taskIds.get(sessionId);
    if (taskId) this.tasks.cancel(taskId);
  }

  private async runLoop(
    sessionId: string,
    runCtx: { hooks: LongFormRunHooks; opts?: { aiReferences?: AiReference[] } },
    report: (p: number, d?: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    let session = await this.getSession(sessionId);
    if (!session) throw new Error('会话不存在');
    const chapterMeta = await this.chapters.get(session.chapterId).catch(() => null);
    this.chapterTitleCache.set(sessionId, chapterMeta?.title ?? '');
    const outline = chapterMeta?.outline ?? '';
    // 参与角色：会话指定优先，未指定则默认注入本书全部角色卡
    const charIds =
      session.characterIds && session.characterIds.length > 0
        ? session.characterIds
        : await this.loadBookCharacterIds(session.bookId);
    const { hooks, opts } = runCtx;

    await this.patchSession(sessionId, (s) => {
      s.status = 'running';
    });

    const total = session.beats.length;
    if (total === 0) throw new Error('节拍表为空');

    // 服务侧章内尾段累计：初始尾段 + 已完成拍正文（当前拍 currentContent 用）
    let chapterTail = (await this.loadChapterText(session.chapterId)).slice(-1200);
    for (const b of session.beats) {
      if (b.status === 'done' && b.generatedText) {
        chapterTail = `${chapterTail}\n\n${b.generatedText}`.slice(-1500);
      }
    }
    let usedTokens = session.usedTokens;

    try {
      for (let i = 0; i < total; i++) {
        const beat = session.beats[i];
        if (beat.status === 'done') continue;
        if (signal.aborted) {
          await this.markPaused(sessionId, i, usedTokens);
          hooks.onBeatInterrupted?.(i);
          throw new DOMException('已暂停', 'AbortError');
        }
        const doneCount = session.beats.filter((b) => b.status === 'done').length;
        report(Math.round((doneCount / total) * 100), `第 ${i + 1}/${total} 拍`);

        hooks.onBeatStart?.(i, beat);
        const prev = i > 0 ? session.beats[i - 1] : null;
        const next = i < total - 1 ? session.beats[i + 1] : null;
        const hintLine = session.hints?.trim() ? `【作者补充提示】${session.hints.trim()}` : '';
        const requirement = [
          `本拍（第 ${i + 1}/${total} 拍）：${beat.text}`,
          `本拍目标字数：约 ${beat.targetWords} 字`,
          prev ? `上一拍已完成内容梗概：${prev.text}` : '',
          next ? `下一拍预告（本拍不要提前写到）：${next.text}` : '',
          hintLine,
          '请只写本拍内容，写完自然收束。'
        ]
          .filter(Boolean)
          .join('\n');

        let fullText = '';
        try {
          const stream = this.orchestrator.continueWriting({
            bookId: session.bookId,
            chapterId: session.chapterId,
            currentContent: chapterTail,
            recentChapters: [],
            selectedCharacterIds: charIds,
            requirement,
            aiReferences: opts?.aiReferences,
            beat: {
              id: beat.id,
              text: beat.text,
              targetWords: beat.targetWords,
              done: false
            },
            // 批次11-6：长文模式放大角色卡预算（承载全书角色，避免当前章关键角色被预算截掉）
            characterBudget: LONG_FORM_CHARACTER_BUDGET,
            // RAG 检索 query 并入大纲 + 当前拍文本 + 章内尾段，提升长输出的召回
            ragQuery: `${outline}\n${beat.text}\n${chapterTail}`.trim(),
            maxTokens: Math.min(8192, Math.max(512, Math.round(beat.targetWords * 2.2))),
            temperature: 0.85,
            signal
          });
          for await (const chunk of stream) {
            if (chunk.delta) {
              fullText += chunk.delta;
              usedTokens += countTokens(chunk.delta);
              hooks.onChunk?.(i, chunk.delta);
            }
          }
        } catch (e) {
          if (signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
            hooks.onBeatInterrupted?.(i);
            await this.markPaused(sessionId, i, usedTokens);
            throw new DOMException('已暂停', 'AbortError');
          }
          throw e;
        }

        // 本拍完成：落盘（恢复粒度 = 拍）
        beat.status = 'done';
        beat.usedTokens = countTokens(fullText);
        beat.generatedText = fullText;
        hooks.onBeatDone?.(i, beat, fullText);
        chapterTail = `${chapterTail}\n\n${fullText}`.slice(-1500);
        const finished = session.beats.filter((b) => b.status === 'done').length;
        report(Math.round((finished / total) * 100), `第 ${finished}/${total} 拍完成`);
        session = (await this.patchSession(sessionId, (s) => {
          s.beats = session!.beats;
          s.currentBeatIndex = i + 1;
          s.usedTokens = usedTokens;
        }))!;
      }

      // 全部完成：接缝自检
      report(100, '接缝自检中…');
      await this.patchSession(sessionId, (s) => {
        s.status = 'seam-review';
      });
      const issues = await this.reviewSeamsInternal(sessionId, signal);
      await this.saveSeamIssues(sessionId, issues);
      await this.patchSession(sessionId, (s) => {
        s.status = 'done';
      });
      report(100, '完成');
    } catch (e) {
      // 非暂停错误：会话置为 paused（重启后可恢复），任务标记失败
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        await this.patchSession(sessionId, (s) => {
          if (s.status === 'running') s.status = 'paused';
        }).catch(() => undefined);
      }
      throw e;
    }
  }

  private async markPaused(sessionId: string, beatIndex: number, usedTokens: number): Promise<void> {
    await this.patchSession(sessionId, (s) => {
      s.status = 'paused';
      s.currentBeatIndex = beatIndex;
      s.usedTokens = usedTokens;
    });
  }

  // ---------------- 步骤 4：接缝自检 ----------------

  /** 接缝自检：输入各接缝相邻两拍尾段+首段，一次调用出 SeamIssue[] */
  async reviewSeams(sessionId: string, signal?: AbortSignal): Promise<SeamIssue[]> {
    return this.reviewSeamsInternal(sessionId, signal);
  }

  private async reviewSeamsInternal(sessionId: string, signal?: AbortSignal): Promise<SeamIssue[]> {
    const session = await this.getSession(sessionId);
    if (!session) return [];
    const texts = session.beats.map((b) => b.generatedText ?? '');
    const seams: string[] = [];
    for (let i = 0; i < texts.length - 1; i++) {
      const tail = texts[i].slice(-120);
      const head = texts[i + 1].slice(0, 120);
      if (!tail || !head) continue;
      seams.push(
        `【接缝 ${i + 1}（第 ${i + 1} 拍结尾 -> 第 ${i + 2} 拍开头）】\n${tail}\n----\n${head}`
      );
    }
    if (seams.length === 0) return [];

    // P2 二期：接缝自检走 'longform-seam' 功能点路由；分批调用，防止单次 maxTokens=4096 被多接缝截断
    const provider = await resolveProviderForFeature(this.bridge, session.bookId, 'longform-seam', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, session.bookId, 'longform-seam');
    // 批次11-4：接缝自检属风格相关评估（语气/称谓/重复），注入作者全局要求 + 文风 Skill 便于识别文风偏差
    const extras = await this.generation.systemExtras(session.bookId, 'continue');
    const systemContent = [SEAM_SYSTEM, ...extras].join('\n\n');
    const KINDS = ['tone', 'address', 'timeline', 'repetition', 'other'];
    const out: SeamIssue[] = [];
    for (let off = 0; off < seams.length; off += SEAM_BATCH) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const batch = seams.slice(off, off + SEAM_BATCH);
      const res = await provider.chat(
        [
          { role: 'system', content: systemContent },
          { role: 'user', content: batch.join('\n\n') }
        ],
        { model, temperature: 0.2, maxTokens: 4096, signal }
      );
      const parsed = parseJsonLoose<
        Array<{ beatIndex?: number; kind?: string; description?: string; excerpt?: string }>
      >(res.content);
      if (!Array.isArray(parsed)) continue;
      out.push(
        ...parsed
          .filter((it) => typeof it.beatIndex === 'number')
          .map((it) => ({
            beatIndex: Number(it.beatIndex),
            kind: (KINDS.includes(String(it.kind)) ? it.kind : 'other') as SeamIssue['kind'],
            description: String(it.description ?? ''),
            excerpt: String(it.excerpt ?? '')
          }))
      );
    }
    return out;
  }

  /** 接缝自检结果：先读本进程内存 Map（热生成本次展示），未命中则回退读落库 seams 列（重启后遗留会话） */
  async getSeamIssues(sessionId: string): Promise<SeamIssue[]> {
    const inMem = this.seamIssues.get(sessionId);
    if (inMem) return inMem;
    const s = await this.getSession(sessionId);
    return s?.seams ?? [];
  }

  /** 持久化接缝自检结果（批次4建议2）：写 seams 列 + 同步本进程 Map。自检完成后调用，重启后仍可回读 */
  async saveSeamIssues(sessionId: string, issues: SeamIssue[]): Promise<void> {
    this.seamIssues.set(sessionId, issues);
    await this.wq.enqueue(() =>
      this.bridge.db.exec('UPDATE longform_sessions SET seams = ? WHERE id = ?', [
        JSON.stringify(issues),
        sessionId
      ])
    );
  }

  /** 本书最近一条 status=done 且保留接缝问题的会话（重启后展示遗留接缝审阅入口） */
  async findDoneWithSeams(bookId: string): Promise<LongFormSession | null> {
    const rows = await this.bridge.db.query<Record<string, unknown>>(
      `SELECT * FROM longform_sessions WHERE book_id = ? AND status = 'done'
       AND seams IS NOT NULL AND seams != '' ORDER BY updated_at DESC LIMIT 1`,
      [bookId]
    );
    const row = rows[0];
    return row ? this.rowToSession(row) : null;
  }

  // ---------------- 工具 ----------------

  private async loadChapterText(chapterId: string): Promise<string> {
    try {
      const doc = await this.chapters.getContent(chapterId);
      return docToPlainText(doc);
    } catch {
      return '';
    }
  }

  /** 本书全部角色卡 id（参与角色未明确指定时的默认注入） */
  private async loadBookCharacterIds(bookId: string): Promise<string[]> {
    try {
      const rows = await this.bridge.db.query<{ id: string }>(
        'SELECT id FROM characters WHERE book_id = ? ORDER BY created_at ASC',
        [bookId]
      );
      return rows.map((r) => r.id);
    } catch {
      return [];
    }
  }

  /**
   * 批次11-1：本书角色卡概要（name + 关键字段），受限预算截断。
   * 供节拍规划注入，让规划师知晓出场角色与弧光，与后续生成循环的装配对齐。
   * 仅作用在生成输入，不触碰存储/热路径。
   */
  private async loadCharacterSummaries(bookId: string): Promise<string> {
    try {
      const rows = await this.bridge.db.query<{ name: string; data: string; tags: string }>(
        'SELECT name, data, tags FROM characters WHERE book_id = ? ORDER BY created_at ASC',
        [bookId]
      );
      if (rows.length === 0) return '';
      const briefs = rows.map((r) => {
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
        const details = Object.entries(data)
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
          .map(([k, v]) => `${k}：${String(v)}`);
        const line = `- ${r.name}${details.length > 0 ? `\n  ${details.join('；')}` : ''}${
          tags.length > 0 ? `\n  标签：${tags.join('、')}` : ''
        }`;
        return line;
      });
      return truncateToTokenBudget(briefs.join('\n\n'), LONG_FORM_CHARACTER_BUDGET).text;
    } catch {
      return '';
    }
  }
}
