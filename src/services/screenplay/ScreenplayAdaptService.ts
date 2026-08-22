/**
 * ScreenplayAdaptService（P5-M2）：小说→剧本两阶段转化编排
 * 照抄 LongFormService 模式：任务中心托管 kind 'screenplay'、恢复粒度 = 场（scene.status='done' 跳过）、
 * 服务层不碰 React（hooks 桥接 UI）；agents.md 经 ProjectDirectiveService 注入
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { LLMProvider } from '../ai/providers/LLMProvider';
import {
  resolveModelNameForFeature,
  resolveProviderForFeature
} from '../ai/providerResolver';
import type { TaskCenterService } from '../task/TaskCenterService';
import type { ProjectDirectiveService } from '../ai/ProjectDirectiveService';
import type { ScreenplayService } from './ScreenplayService';
import type { DialogueLine, Scene, ScreenplayEpisode, Shot, ShotSize } from './types';
import { SHOT_SIZES } from './types';

/** 角色卡概要（转化取材用，仅需 name + 结构化字段） */
interface CharBrief {
  name: string;
  data: Record<string, unknown>;
}

export interface OutlineParams {
  bookId: string;
  screenplayId: string;
  fromChapterId: string;
  toChapterId: string;
  episodeCount: number;
  scenesPerEpisode?: number;
  hints?: string;
  signal?: AbortSignal;
}

export interface SceneGenHooks {
  onSceneStart?: (epNumber: number, sceneIndex: number) => void;
  onSceneDone?: (scene: Scene) => void;
  onInterrupted?: (reason: string) => void;
}

interface ChapterMeta {
  id: string;
  title: string;
  summary: string | null;
}

/** 容错 JSON 对象解析（剥 think 段/围栏/首尾杂文/尾逗号） */
function parseJsonObject<T>(raw: string): T | null {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let text = s.slice(start, end + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    try {
      return JSON.parse(
        text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:"'\\])\/\/[^\n\r]*/g, '$1')
          .replace(/,(\s*[}\]])/g, '$1')
      ) as T;
    } catch {
      return null;
    }
  }
}

const OUTLINE_SYSTEM = `你是资深影视编剧策划。把小说章节素材改编为剧集大纲。
严格只输出 JSON（不要 markdown 围栏、不要解释）：
{"episodes":[{"number":1,"title":"集标题","logline":"一句话梗概","scenes":[{"interior":"INT","location":"地点","timeOfDay":"日|夜|黄昏|清晨","synopsis":"本场概要（一句话，含关键冲突）","sourceChapterId":"素材中给出的章节 id"}]}]}
要求：
- interior 只用 INT（内景）或 EXT（外景）
- sourceChapterId 必须从素材【章节列表】给出的 id 中选取
- 每场聚焦单一地点与时间，冲突推进明确`;

const SCENE_SYSTEM = `你是资深影视编剧。把单场大纲扩写为完整剧本场（镜头与对白）。
严格只输出 JSON（不要 markdown 围栏、不要解释）：
{"interior":"INT","location":"地点","timeOfDay":"日","synopsis":"本场概要","shots":[{"size":"MS","camera":"推|拉|摇|移|跟|固定","description":"画面描述（视觉化，含人物动作与空间）","durationSec":4,"dialogue":[{"character":"角色名","parenthetical":"（语气提示，可省）","line":"台词"}]}]}
要求：
- size 只用 ELS/LS/MS/MCU/CU/ECU（远/全/中/中近/近/特写）
- 每场 3-8 个镜头；对白符合角色设定与 agents.md 的称谓/禁令
- 对白角色名必须与素材中的角色名一致`;

export class ScreenplayAdaptService {
  private bridge: NativeBridge;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private screenplays: ScreenplayService;
  private tasks: TaskCenterService;
  private directives: ProjectDirectiveService;
  private taskIds = new Map<string, string>();

  constructor(
    bridge: NativeBridge,
    providerFactory: (configId: string) => Promise<LLMProvider>,
    screenplays: ScreenplayService,
    tasks: TaskCenterService,
    directives: ProjectDirectiveService
  ) {
    this.bridge = bridge;
    this.providerFactory = providerFactory;
    this.screenplays = screenplays;
    this.tasks = tasks;
    this.directives = directives;
  }

  // ---------------- 阶段一：大纲 ----------------

  /** 生成大纲并写入剧本（status='review'，等待用户编辑确认）；材料 = 章节摘要/节选 + 角色卡 + 世界书 + agents.md */
  async draftOutline(params: OutlineParams): Promise<ScreenplayEpisode[]> {
    const sp = await this.screenplays.get(params.screenplayId);
    if (!sp) throw new Error('剧本不存在');
    const provider = await resolveProviderForFeature(this.bridge, params.bookId, 'script-outline', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, params.bookId, 'script-outline');

    const chapters = await this.chaptersInRange(params.bookId, params.fromChapterId, params.toChapterId);
    if (chapters.length === 0) throw new Error('章节范围内没有章节');

    const material: string[] = [];
    material.push('【章节列表（id · 标题）】', chapters.map((c) => `${c.id} · ${c.title}`).join('\n'));
    const excerpts: string[] = [];
    for (const c of chapters) {
      const summary = c.summary?.trim();
      const excerpt = summary && summary.length >= 40 ? summary : await this.screenplays.chapterExcerpt(c.id, 500);
      excerpts.push(`《${c.title}》（${c.id}）：${excerpt || '（无正文）'}`);
    }
    material.push('【章节素材】', excerpts.join('\n'));
    const chars = await this.loadCharacters(params.bookId);
    if (chars.length > 0) {
      material.push('【主要角色】', chars.map((c) => `- ${c.name}：${cardBrief(c)}`).join('\n'));
    }
    const worldbook = await this.bridge.db
      .query<{ title: string; content: string }>(
        'SELECT title, content FROM worldbook_entries WHERE book_id = ? ORDER BY updated_at DESC LIMIT 10',
        [params.bookId]
      )
      .catch(() => []);
    if (worldbook.length > 0) {
      material.push('【世界书要点】', worldbook.map((w) => `- ${w.title}: ${w.content.slice(0, 120)}`).join('\n'));
    }
    const agents = await this.directives.agentsText(params.bookId).catch(() => undefined);
    if (agents) material.push('【本书创作总纲（最高优先级，称谓/禁令对剧本对白同样生效）】', agents);
    if (params.hints?.trim()) material.push('【作者补充提示】', params.hints.trim());

    const scenesPer = params.scenesPerEpisode ?? 6;
    const user = [
      material.join('\n\n'),
      '',
      `【任务】改编为 ${params.episodeCount} 集剧集大纲，每集约 ${scenesPer} 场（可上下浮动 1-2 场）。`
    ].join('\n');

    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (params.signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const res = await provider.chat(
        [
          { role: 'system', content: OUTLINE_SYSTEM },
          { role: 'user', content: user }
        ],
        { model, temperature: 0.6, maxTokens: 4096, signal: params.signal }
      );
      const parsed = parseJsonObject<{ episodes?: Array<Record<string, unknown>> }>(res.content);
      const episodes = normalizeEpisodes(parsed, chapters);
      if (episodes.length > 0) {
        sp.data.episodes = episodes;
        sp.sourceRange = { fromChapterId: params.fromChapterId, toChapterId: params.toChapterId };
        sp.status = 'review';
        await this.screenplays.save(sp);
        return episodes;
      }
      lastErr = res.content.slice(0, 200);
    }
    throw new Error(`大纲生成失败（模型未返回合法 JSON）：${lastErr}`);
  }

  /** 成本预估：每场一次调用 */
  estimateOutline(episodes: ScreenplayEpisode[]): { calls: number; estimatedTokens: number } {
    const calls = episodes.reduce((n, ep) => n + ep.scenes.length, 0);
    return { calls, estimatedTokens: calls * 2400 };
  }

  // ---------------- 阶段二：逐场生成 ----------------

  /** 注册任务中心 'screenplay' 任务，逐场生成（恢复粒度 = 场）；进度"第 N 集 · 第 M 场" */
  generateScenes(screenplayId: string, hooks: SceneGenHooks = {}): void {
    const exec = (): void => {
      const info = this.tasks.register({
        kind: 'screenplay',
        title: '剧本逐场生成',
        cancellable: true,
        run: async ({ report, signal }) => {
          await this.sceneLoop(screenplayId, hooks, report, signal);
        },
        retry: exec
      });
      this.taskIds.set(screenplayId, info.id);
    };
    exec();
  }

  /** 当前场写完后停 */
  pause(screenplayId: string): void {
    const taskId = this.taskIds.get(screenplayId);
    if (taskId) this.tasks.cancel(taskId);
  }

  private async sceneLoop(
    screenplayId: string,
    hooks: SceneGenHooks,
    report: (p: number, d?: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    const sp = await this.screenplays.get(screenplayId);
    if (!sp) throw new Error('剧本不存在');
    await this.setStatus(sp, 'generating');

    const all = sp.data.episodes.flatMap((ep) => ep.scenes.map((sc) => ({ ep, sc })));
    const total = all.length;
    if (total === 0) throw new Error('大纲为空，请先生成并确认大纲');

    const chars = await this.loadCharacters(sp.bookId);
    const agents = await this.directives.agentsText(sp.bookId).catch(() => undefined);

    for (let i = 0; i < all.length; i++) {
      const { ep, sc } = all[i];
      if (sc.status === 'done') continue;
      if (signal.aborted) {
        hooks.onInterrupted?.('paused');
        throw new DOMException('已暂停', 'AbortError');
      }
      const done = all.filter((x) => x.sc.status === 'done').length;
      const sceneIdx = ep.scenes.findIndex((s) => s.id === sc.id);
      report(Math.round((done / total) * 100), `第 ${ep.number} 集 · 第 ${sceneIdx + 1} 场`);

      hooks.onSceneStart?.(ep.number, sceneIdx);

      const scene = await this.generateOneScene(sp.bookId, ep, sc, chars, agents, signal);
      // 写回（重新载入防并发编辑丢失）
      const fresh = await this.screenplays.get(screenplayId);
      if (!fresh) throw new Error('剧本不存在');
      const epF = fresh.data.episodes.find((e) => e.id === ep.id);
      const scF = epF?.scenes.find((s) => s.id === sc.id);
      if (!epF || !scF) continue; // 用户中途删了该场：跳过
      scF.interior = scene.interior;
      scF.location = scene.location;
      scF.timeOfDay = scene.timeOfDay;
      scF.synopsis = scene.synopsis || scF.synopsis;
      scF.shots = scene.shots;
      scF.status = 'done';
      await this.screenplays.save(fresh);
      hooks.onSceneDone?.(scF);
    }

    // 全部完成
    const fresh = await this.screenplays.get(screenplayId);
    if (fresh) {
      fresh.status = 'done';
      await this.screenplays.save(fresh);
    }
  }

  /** 单场生成（JSON 容错解析，失败重试 1 次；彻底失败抛错终止任务） */
  private async generateOneScene(
    bookId: string,
    ep: ScreenplayEpisode,
    scene: Scene,
    chars: CharBrief[],
    agents: string | undefined,
    signal?: AbortSignal
  ): Promise<{ interior: 'INT' | 'EXT'; location: string; timeOfDay: string; synopsis: string; shots: Shot[] }> {
    const provider = await resolveProviderForFeature(this.bridge, bookId, 'script-gen', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, bookId, 'script-gen');

    const excerpt = scene.sourceChapterId
      ? await this.screenplays.chapterExcerpt(scene.sourceChapterId, 900)
      : '';
    // 出场角色：名字出现在概要或节选中的角色卡；无匹配取前 3 个
    const hay = `${scene.synopsis}\n${excerpt}`;
    const appearing = chars.filter((c) => hay.includes(c.name));
    const cast = (appearing.length > 0 ? appearing : chars.slice(0, 3)).slice(0, 6);

    const material: string[] = [];
    material.push(`【本集】第 ${ep.number} 集${ep.title ? `：${ep.title}` : ''}${ep.logline ? `（${ep.logline}）` : ''}`);
    material.push('【本场大纲】', `${scene.interior}.${scene.location} ${scene.timeOfDay} —— ${scene.synopsis}`);
    if (excerpt) material.push('【溯源章节节选】', excerpt);
    if (cast.length > 0) material.push('【出场角色】', cast.map((c) => `- ${c.name}：${cardBrief(c)}`).join('\n'));
    if (agents) material.push('【本书创作总纲（最高优先级）】', agents);

    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const res = await provider.chat(
        [
          { role: 'system', content: SCENE_SYSTEM },
          { role: 'user', content: material.join('\n\n') }
        ],
        { model, temperature: 0.8, maxTokens: 4096, signal }
      );
      const parsed = parseJsonObject<{
        interior?: string;
        location?: string;
        timeOfDay?: string;
        synopsis?: string;
        shots?: Array<Record<string, unknown>>;
      }>(res.content);
      if (parsed && Array.isArray(parsed.shots)) {
        const shots = parsed.shots
          .map((s, i) => normalizeShot(s, i + 1))
          .filter((s): s is Shot => s !== null);
        if (shots.length > 0) {
          return {
            interior: parsed.interior === 'EXT' ? 'EXT' : 'INT',
            location: String(parsed.location || scene.location || '未命名地点'),
            timeOfDay: String(parsed.timeOfDay || scene.timeOfDay || '日'),
            synopsis: String(parsed.synopsis || scene.synopsis || ''),
            shots
          };
        }
      }
      lastErr = res.content.slice(0, 200);
    }
    throw new Error(`场「${scene.synopsis.slice(0, 30)}」生成失败（模型未返回合法 JSON）：${lastErr}`);
  }

  // ---------------- 辅助 ----------------

  private async setStatus(sp: import('./types').Screenplay, status: import('./types').ScreenplayStatus): Promise<void> {
    sp.status = status;
    await this.screenplays.save(sp);
  }

  private async chaptersInRange(bookId: string, fromId: string, toId: string): Promise<ChapterMeta[]> {
    const rows = await this.bridge.db.query<{ id: string; title: string; summary: string | null }>(
      'SELECT id, title, summary FROM chapters WHERE book_id = ? ORDER BY sort_order ASC, created_at ASC',
      [bookId]
    );
    const from = rows.findIndex((r) => r.id === fromId);
    const to = rows.findIndex((r) => r.id === toId);
    if (from < 0 || to < 0) return rows;
    return rows.slice(Math.min(from, to), Math.max(from, to) + 1);
  }

  private async loadCharacters(bookId: string): Promise<CharBrief[]> {
    const rows = await this.bridge.db
      .query<Record<string, unknown>>('SELECT * FROM characters WHERE book_id = ?', [bookId])
      .catch(() => []);
    return rows.map((r) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(String(r.data ?? '{}')) as Record<string, unknown>;
      } catch {
        data = {};
      }
      return { name: String(r.name), data };
    });
  }
}

/** 角色卡概要：外貌/性别/年龄/服饰等关键字段（分镜与对白一致性用） */
function cardBrief(c: CharBrief): string {
  const keys = ['性别', '年龄', '外貌', ' appearance', 'gender', 'age', '服饰', '身份', '性格'];
  const parts: string[] = [];
  for (const [k, v] of Object.entries(c.data)) {
    if (v === null || v === undefined || String(v).trim() === '') continue;
    if (keys.some((kk) => k.toLowerCase().includes(kk.trim().toLowerCase())) || parts.length < 3) {
      parts.push(`${k}: ${String(v).slice(0, 60)}`);
    }
    if (parts.length >= 5) break;
  }
  return parts.join('；') || '（角色卡无关键字段）';
}

/** 大纲解析结果规整（含 sourceChapterId 校验与比例回填） */
function normalizeEpisodes(
  parsed: { episodes?: Array<Record<string, unknown>> } | null,
  chapters: ChapterMeta[]
): ScreenplayEpisode[] {
  if (!parsed || !Array.isArray(parsed.episodes)) return [];
  const validIds = new Set(chapters.map((c) => c.id));
  const out: ScreenplayEpisode[] = [];
  parsed.episodes.forEach((ep, epIdx) => {
    const scenesRaw = Array.isArray(ep.scenes) ? ep.scenes : [];
    const scenes: Scene[] = scenesRaw
      .map((sc, scIdx) => {
        const srcId = String((sc as Record<string, unknown>).sourceChapterId ?? '');
        const sourceChapterId = validIds.has(srcId)
          ? srcId
          : chapters.length > 0
            ? chapters[Math.min(chapters.length - 1, Math.floor(((scIdx + 1) / Math.max(scenesRaw.length, 1)) * chapters.length))]?.id
            : undefined;
        return {
          id: crypto.randomUUID(),
          interior: (sc as Record<string, unknown>).interior === 'EXT' ? ('EXT' as const) : ('INT' as const),
          location: String((sc as Record<string, unknown>).location ?? '未命名地点'),
          timeOfDay: String((sc as Record<string, unknown>).timeOfDay ?? '日'),
          synopsis: String((sc as Record<string, unknown>).synopsis ?? ''),
          sourceChapterId,
          shots: [],
          status: 'outline' as const
        };
      })
      .filter((s) => s.synopsis.trim() !== '');
    if (scenes.length === 0) return;
    out.push({
      id: crypto.randomUUID(),
      number: Number(ep.number) > 0 ? Number(ep.number) : epIdx + 1,
      title: String(ep.title ?? `第 ${epIdx + 1} 集`),
      logline: ep.logline ? String(ep.logline) : undefined,
      scenes
    });
  });
  return out;
}

/** 镜头解析结果规整 */
function normalizeShot(s: Record<string, unknown>, number: number): Shot | null {
  const size = String(s.size ?? '').toUpperCase() as ShotSize;
  const dialogueRaw = Array.isArray(s.dialogue) ? s.dialogue : [];
  const dialogue: DialogueLine[] = [];
  for (const raw of dialogueRaw) {
    const d = raw as Record<string, unknown>;
    const character = String(d.character ?? '').trim();
    const line = String(d.line ?? '').trim();
    if (!character || !line) continue;
    const entry: DialogueLine = { character, line };
    if (d.parenthetical) entry.parenthetical = String(d.parenthetical);
    dialogue.push(entry);
  }
  const description = String(s.description ?? '').trim();
  if (!description && dialogue.length === 0) return null;
  return {
    id: crypto.randomUUID(),
    number,
    size: (SHOT_SIZES.includes(size) ? size : 'MS') as ShotSize,
    camera: s.camera ? String(s.camera) : undefined,
    description,
    durationSec: Number(s.durationSec) > 0 ? Math.round(Number(s.durationSec)) : undefined,
    dialogue
  };
}
