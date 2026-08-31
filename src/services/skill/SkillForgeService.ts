/**
 * SkillForgeService（P7.4「一把炼化」）：从文本 / 书籍提炼文风 Skill 的一站式独立服务。
 * - 纯函数（导出供单测）：采样（三段配比 / 等距抽章）、分片、JSON 契约解析、落盘 Markdown 构建
 * - 实例方法：modelName 探测、estimate 预估、forge 执行链（单次 / 分片 map-reduce / 解析降级）
 * 定位与灵感库一致——「激发而非替代」：提炼风格指令，不复制内容。
 * 硬边界：不触碰 PromptAssembler / AIOrchestrator 热路径，无新数据表、无迁移、无新 Provider。
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { LLMProvider, ChatMessage } from '../ai/providers/LLMProvider';
import type { ChapterService } from '../chapter/ChapterService';
import type { AIMode } from './types';
import { resolveProviderForFeature, resolveModelNameForFeature } from '../ai/providerResolver';
import { countTokens, truncateToTokenBudget } from '../../utils/tokens';
import { parseLooseJson } from '../../utils/looseJson';
import { docToPlainText } from '../../utils/pmdoc';

/* ------------------------------ 常量（集中导出） ------------------------------ */

/** 粘贴文本上限（10 万字） */
export const MAX_PASTE_CHARS = 100_000;
/** 上传文件上限（5MB） */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 单次调用输入上限，超过且未采样则分片 */
export const SINGLE_CALL_MAX_TOKENS = 16_000;
/** 采样目标预算（10 万 token 输入可省 80%+） */
export const SAMPLE_BUDGET_TOKENS = 16_000;
/** 分片目标（段落边界浮动 8k–16k） */
export const CHUNK_TARGET_TOKENS = 12_000;
/** 粘贴·上传采样的三段配比（头 / 中 / 尾） */
export const HEAD = 0.2;
export const MID = 0.5;
export const TAIL = 0.3;
/** Skill 正文长度硬约束 */
export const BODY_MAX_CHARS = 1_500;
/** 「提炼侧重」上限 */
export const FOCUS_MAX_CHARS = 300;
/** 超量强提示阈值 */
export const HEAVY_INPUT_TOKENS = 100_000;
/** 分片观测笔记上限 */
export const NOTE_MAX_CHARS = 400;

/** 预览弹窗空白模板正文（与 SkillCreateDialog 起始结构同风格） */
export const DEFAULT_FORGE_BODY = `# 文风指令

## 用词偏好
- 在此描述用词偏好，例如：对白半文半白、动词具象化

## 句式
- 在此描述句式特征，例如：短句为主、段落首句即立场

## 禁忌
- 在此列出应避免的表达，例如：不出现现代科技词汇、不使用网络流行语
`;

/* ------------------------------ 类型契约 ------------------------------ */

export type SkillForgeSource =
  | { kind: 'text'; text: string } // 粘贴 / 上传（UI 层已读为纯文本）
  | { kind: 'book'; bookId: string; title: string }; // 库内书籍（服务内读章拼全文）

export interface SkillForgeParams {
  source: SkillForgeSource;
  focus?: string; // 提炼侧重（≤300 字，可选）
  sample: boolean; // 采样开关（默认 true）
  signal?: AbortSignal;
  onProgress?: (p: SkillForgeProgress) => void;
}

export interface SkillForgeProgress {
  phase: 'reading' | 'sampling' | 'forging' | 'observing' | 'synthesizing';
  current?: number; // 分片序号（1 起，observing 阶段用）
  total?: number;
}

export interface SkillForgeDraft {
  name: string;
  description: string;
  appliesTo: AIMode[];
  priority: number;
  body: string;
  bodyOverlong: boolean; // body > 1500 字
  parseMode: 'json' | 'regex'; // 命中的解析层级（manual 由 UI 兜底）
}

export interface SkillForgeEstimate {
  inputTokens: number; // 预估输入（采样后 / 分片合计）
  calls: number; // 1 或 分片数 + 1
  outputTokens: number; // 预估输出
  sampled: boolean;
  chunked: boolean;
  model: string; // resolveModelNameForFeature 结果
}

/** 素材读取结果（book 来源附带逐章纯文本，供等距抽章） */
interface SourceText {
  text: string;
  bookId: string;
  chapters: string[] | null;
}

/* ------------------------------ 纯函数 ------------------------------ */

/** 取段落序列中自 start 起、方向 direction、累计 token 不超 budget 的段落（段落边界对齐，不超发） */
function collectParagraphs(
  paragraphs: string[],
  start: number,
  budget: number,
  direction: 1 | -1
): number[] {
  const idxs: number[] = [];
  let used = 0;
  let i = start;
  while (i >= 0 && i < paragraphs.length) {
    const t = countTokens(paragraphs[i]);
    if (used + t > budget) break;
    idxs.push(i);
    used += t;
    i += direction;
  }
  return direction === 1 ? idxs : idxs.reverse();
}

/** 素材内给定预算内截取（段落边界对齐，预算用尽即止）；预算不足返回空串 */
function truncateAtParagraphs(text: string, budget: number): string {
  if (budget <= 0) return '';
  const paragraphs = text.split('\n\n').map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let used = 0;
  for (const p of paragraphs) {
    const t = countTokens(p);
    if (used + t <= budget) {
      out.push(p);
      used += t;
    } else if (used < budget) {
      const fit = truncateToTokenBudget(p, budget - used);
      out.push(fit.text);
      break;
    } else {
      break;
    }
  }
  return out.join('\n\n');
}

/**
 * 1. 粘贴 / 上传采样：素材 token ≤ budget 时原样返回；
 * 否则按 头 20% / 中段 50% / 尾 30% 的预算配比从素材头 / 中 / 尾三区各取一段，
 * 三段均在段落边界（\n\n）对齐，段间以 `……（略）` 分隔。
 * 中段权重最大的理由：开头多为设定铺陈、结尾情绪浓度失真，中段风格最稳定。
 */
export function sampleByProportion(text: string, budget: number): string {
  const total = countTokens(text);
  if (total <= budget) return text;
  const paragraphs = text.split('\n\n').map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return '';
  // 三段配比预算扣掉分隔符「……（略）」的 token 预留，保证最终结果不超预算
  const sepTokens = countTokens('……（略）');
  const zoneBudget = Math.max(1, budget - sepTokens * 2);
  const headBudget = Math.floor(zoneBudget * HEAD);
  const midBudget = Math.floor(zoneBudget * MID);
  const tailBudget = Math.floor(zoneBudget * TAIL);

  // 中段起始：全文字符几何中位附近所在段落
  const totalChars = paragraphs.reduce((s, p) => s + p.length, 0);
  let midStart = 0;
  let acc = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    acc += paragraphs[i].length;
    if (acc >= totalChars / 2) {
      midStart = i;
      break;
    }
  }

  const headIdx = collectParagraphs(paragraphs, 0, headBudget, 1);
  const midIdx = collectParagraphs(paragraphs, midStart, midBudget, 1);
  const tailIdx = collectParagraphs(paragraphs, paragraphs.length - 1, tailBudget, -1);

  // 去重保序（短文本三段可能重叠），确保不超预算
  const seen = new Set<number>();
  const order: number[] = [];
  for (const idx of [...headIdx, ...midIdx, ...tailIdx]) {
    if (!seen.has(idx)) {
      seen.add(idx);
      order.push(idx);
    }
  }
  order.sort((a, b) => a - b);

  // 重排：头 / 中 / 尾 三区仍以「……（略）」分隔（区间相邻时不重复分隔）
  const zoneHas = (arr: number[], idx: number): boolean => arr.includes(idx);
  const parts: string[] = [];
  let prevZone = -1;
  for (const idx of order) {
    const zone = zoneHas(headIdx, idx) ? 0 : zoneHas(midIdx, idx) ? 1 : 2;
    if (parts.length > 0 && zone !== prevZone) parts.push('……（略）');
    parts.push(paragraphs[idx]);
    prevZone = zone;
  }
  return parts.join('\n\n');
}

/**
 * 2. 库内书籍采样：全书 token ≤ budget 时全保留；
 * 否则按各章 token 累计等距游标抽 k 章（必含首章与末章，覆盖风格演变），
 * 单章超剩余配额时在该章段落边界截断。
 */
export function sampleChapters(chapters: string[], budget: number): string[] {
  const tokens = chapters.map((c) => countTokens(c));
  const total = tokens.reduce((s, t) => s + t, 0);
  if (total <= budget) return chapters;
  const n = chapters.length;
  if (n === 0) return [];

  // 按预算占比估算期望抽样章节数（至少 2、至多全量）
  let k = Math.max(2, Math.round((n * budget) / total));
  k = Math.min(k, n);

  // 等距游标：target = j * total / k 落在 token 累计哪个章节
  const cumulative: number[] = [0];
  for (let i = 0; i < n; i++) cumulative.push(cumulative[i] + tokens[i]);
  const selected = new Set<number>([0, n - 1]);
  for (let j = 0; j < k; j++) {
    const target = (j * total) / k;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumulative[mid + 1] < target) lo = mid + 1;
      else hi = mid;
    }
    selected.add(lo);
  }

  const ordered = [...selected].sort((a, b) => a - b);
  const out: string[] = [];
  let used = 0;

  // 首章必含：整章能放下则整章，否则段落边界截断
  const first = ordered[0];
  const firstText =
    tokens[first] <= budget - used
      ? chapters[first]
      : truncateAtParagraphs(chapters[first], budget - used);
  if (firstText) {
    out.push(firstText);
    used += countTokens(firstText);
  }

  // 中间章：完整能放下则放，放不下跳过（等距抽样的近似取舍，保证覆盖不断档）
  const last = ordered[ordered.length - 1];
  for (const idx of ordered.slice(1, -1)) {
    if (idx === last) continue;
    if (used + tokens[idx] <= budget) {
      out.push(chapters[idx]);
      used += tokens[idx];
    }
  }

  // 末章必含：用剩余配额段落边界截断，覆盖风格演变收尾
  if (last !== first && used < budget) {
    const fit = truncateAtParagraphs(chapters[last], budget - used);
    if (fit) out.push(fit);
  }
  return out;
}

/**
 * 3. 分片：按 `\n\n` 段落累积切片，达到 target 即断；
 * 单段超 SINGLE_CALL_MAX_TOKENS 时硬切。任何情况不产生空片。
 */
export function chunkByParagraph(text: string, target = CHUNK_TARGET_TOKENS): string[] {
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];
  let cur: string[] = [];
  let curTokens = 0;
  const flush = (): void => {
    if (cur.length > 0) {
      const joined = cur.join('\n\n');
      if (joined.trim()) chunks.push(joined);
      cur = [];
      curTokens = 0;
    }
  };
  for (const p of paragraphs) {
    if (!p.trim()) continue;
    const t = countTokens(p);
    if (t > SINGLE_CALL_MAX_TOKENS) {
      flush();
      for (const piece of hardSplit(p, SINGLE_CALL_MAX_TOKENS)) {
        const pieceTokens = countTokens(piece);
        if (curTokens + pieceTokens > target && cur.length > 0) flush();
        cur.push(piece);
        curTokens += pieceTokens;
      }
      continue;
    }
    if (curTokens + t > target && cur.length > 0) flush();
    cur.push(p);
    curTokens += t;
  }
  flush();
  return chunks.filter((c) => c.trim() !== '');
}

/** 长段硬切：切成 token 均不超过 maxTokens 的连续块（二分取前缀） */
function hardSplit(text: string, maxTokens: number): string[] {
  const out: string[] = [];
  let rest = text;
  let guard = 0;
  while (rest && countTokens(rest) > maxTokens && guard++ < 10_000) {
    let lo = 0;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (countTokens(rest.slice(0, mid)) <= maxTokens) lo = mid;
      else hi = mid - 1;
    }
    const piece = rest.slice(0, lo);
    if (!piece) break;
    out.push(piece);
    rest = rest.slice(lo);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

/** 合法 AIMode（契约 applies_to 过滤用） */
const VALID_MODES: AIMode[] = ['continue', 'rewrite', 'dialogue', 'check'];

/** name slug 化：小写、非法字符转 `-`、去首尾 `-`，空则 'forged-style' */
function slugifyName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'forged-style';
}

/** JSON 字符串反转义（正则抽取的 body / description 用） */
function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
}

/** 契约字段归一化（JSON 与正则两条解析层级共用） */
function normalizeForgeDraft(raw: {
  name: unknown;
  description: unknown;
  appliesTo: unknown;
  priority: unknown;
  body: unknown;
  parseMode: 'json' | 'regex';
}): SkillForgeDraft | null {
  const name = slugifyName(String(raw.name ?? '').trim());
  const description = String(raw.description ?? '').trim() || '由一把炼化生成的文风 Skill';

  let appliesTo: AIMode[] = [];
  if (Array.isArray(raw.appliesTo)) {
    appliesTo = raw.appliesTo.map(String).filter((x): x is AIMode => (VALID_MODES as string[]).includes(x));
  } else if (typeof raw.appliesTo === 'string') {
    appliesTo = raw.appliesTo
      .split(',')
      .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
      .filter((x): x is AIMode => (VALID_MODES as string[]).includes(x));
  }
  if (appliesTo.length === 0) appliesTo = ['continue', 'rewrite', 'dialogue'];

  const p = Number(raw.priority);
  const priority = Number.isFinite(p) ? Math.max(1, Math.min(99, Math.floor(p))) : 5;

  const body = String(raw.body ?? '').trim();
  if (!name || !body) return null;

  return {
    name,
    description,
    appliesTo,
    priority,
    body,
    bodyOverlong: body.length > BODY_MAX_CHARS,
    parseMode: raw.parseMode
  };
}

/** 正则逐字段抽取（一级 JSON 失败后的二级降级） */
function extractByRegex(raw: string): SkillForgeDraft | null {
  const grab = (re: RegExp): string | undefined => {
    const m = raw.match(re);
    return m ? m[1] : undefined;
  };
  const nameRaw =
    grab(/"name"\s*[:：]\s*"([^"]*)"/i) ?? grab(/"name"\s*[:：]\s*([^\s",}]+)/i);
  const descriptionRaw = grab(/"description"\s*[:：]\s*"((?:[^"\\]|\\.)*)"/i);
  const appliesToRaw = grab(/"applies_to"\s*[:：]\s*\[([^\]]*)\]/i);
  const priorityRaw = grab(/"priority"\s*[:：]\s*(\d+)/i);
  const bodyRaw = grab(/"body"\s*[:：]\s*"((?:[^"\\]|\\.)*)"/i);
  if (nameRaw === undefined && bodyRaw === undefined) return null;
  return normalizeForgeDraft({
    name: nameRaw ?? '',
    description: descriptionRaw !== undefined ? unescapeJsonString(descriptionRaw) : '',
    appliesTo: appliesToRaw,
    priority: priorityRaw !== undefined ? Number(priorityRaw) : NaN,
    body: bodyRaw !== undefined ? unescapeJsonString(bodyRaw) : '',
    parseMode: 'regex'
  });
}

/**
 * 4. 解析 AI 返回的炼化结果：
 * 一级 parseLooseJson（剥 think / 围栏 / 注释 / 尾逗号）；一级失败或字段不可救时
 * 二级正则逐字段抽取；归一化后任一必填字段（name / body）不可救返回 null。
 */
export function parseForgeResult(raw: string): SkillForgeDraft | null {
  const json = parseLooseJson<Record<string, unknown>>(raw);
  if (json && typeof json === 'object') {
    const draft = normalizeForgeDraft({
      name: json.name,
      description: json.description,
      appliesTo: json.applies_to,
      priority: json.priority,
      body: json.body,
      parseMode: 'json'
    });
    if (draft) return draft;
  }
  return extractByRegex(raw);
}

/**
 * 5. 构建 SKILL.md：与 SkillCreateDialog 落盘格式逐字符同构
 * （--- / name / description / trigger: manual / applies_to / priority / --- / 空行 / body，join('\n')）。
 * description 不含换行（来源书名后缀在保存前拼接）。
 */
export function buildSkillMarkdown(draft: {
  name: string;
  description: string;
  appliesTo: AIMode[];
  priority: number;
  body: string;
}): string {
  return [
    '---',
    `name: ${draft.name}`,
    `description: ${draft.description}`,
    'trigger: manual',
    `applies_to: [${draft.appliesTo.join(', ')}]`,
    `priority: ${draft.priority}`,
    '---',
    '',
    draft.body.trim(),
    ''
  ].join('\n');
}

/** 单次 / 合成共用 system 契约（用户侧重仅作限定段追加） */
function buildSystemPrompt(focus?: string): string {
  const base = `你是一位文学文风分析师。任务：从用户提供的小说文本中提炼「文风 Skill」——一组可复用的风格指令，
供 AI 写作助手在续写 / 改写 / 对白时遵循。提炼风格指令，不要复述或复制原文内容。

提炼维度（逐项观察，样本中不明显的维度可省略）：
1. 用词偏好：词汇域、文白程度、修辞密度、动词 / 形容词风格
2. 句式与节奏：长短句比、标点习惯、段落长度与断行
3. 叙事视角：人称、时态、视角距离（贴近 / 抽离）
4. 对白风格：引号习惯、口语化程度、对白与动作穿插（样本含对白时才提炼）
5. 意象与母题：反复出现的意象、题材气质
6. 禁忌：基于样本推断「不会出现」的表达；必须固定附加「避免 AI 腔 / 翻译腔」

输出要求（严格遵守）：
- 仅输出一个 JSON 对象，不含任何其他文字或代码围栏
- name：英文小写短横线命名（kebab-case），概括该文风，如 keigo-style
- description：一句话中文描述
- applies_to：从 ["continue", "rewrite", "dialogue"] 中选择
- priority：整数 1-99，默认 5
- body：Markdown 正文，以「# 文风指令」开头，按「## 用词偏好 / ## 句式与节奏 / ## 叙事视角 /
  ## 对白风格 / ## 意象与母题 / ## 禁忌」组织（不适用维度省略）；总长不超过 1500 字；
  写「指令」而非「描述」（写「多用短句」，不写「本文多用短句」）`;
  const f = focus?.trim();
  if (f) return `${base}\n\n## 用户补充要求（仅作提炼侧重限定，不改变以上输出格式）：${f}`;
  return base;
}

/* ------------------------------ 服务 ------------------------------ */

export class SkillForgeService {
  private bridge: NativeBridge;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private chapterService: ChapterService;
  /** 素材读取缓存（estimate 与 forge 复用，避免全书双读） */
  private cache: { key: string; value: SourceText } | null = null;

  constructor(
    bridge: NativeBridge,
    providerFactory: (configId: string) => Promise<LLMProvider>,
    chapterService: ChapterService
  ) {
    this.bridge = bridge;
    this.providerFactory = providerFactory;
    this.chapterService = chapterService;
  }

  /** 探测本功能当前路由的模型名；未配置 / 路由缺失时抛错（页面禁用态依据） */
  async modelName(): Promise<string> {
    return resolveModelNameForFeature(this.bridge, '', 'skill-forge');
  }

  /** 读取素材文本（book 来源：树序逐章读正文拼全文），按来源缓存一次 */
  async readSource(source: SkillForgeSource): Promise<SourceText> {
    const key = source.kind === 'text' ? `text:${source.text.length}` : `book:${source.bookId}`;
    if (this.cache && this.cache.key === key) return this.cache.value;
    let value: SourceText;
    if (source.kind === 'text') {
      value = { text: source.text, bookId: '', chapters: null };
    } else {
      const chapters: string[] = [];
      const list = await this.chapterService.listTreeOrder(source.bookId);
      for (const ch of list) {
        const doc = await this.chapterService.getContent(ch.id);
        const plain = docToPlainText(doc).trim();
        if (plain) chapters.push(plain);
      }
      value = { text: chapters.join('\n\n'), bookId: source.bookId, chapters };
    }
    this.cache = { key, value };
    return value;
  }

  /** 按来源选择采样方式：库内书籍等距抽章，粘贴 / 上传三段配比 */
  private sampleText(source: SkillForgeSource, text: string, chapters: string[] | null, budget: number): string {
    if (source.kind === 'book' && chapters && chapters.length > 0) {
      return sampleChapters(chapters, budget).join('\n\n');
    }
    return sampleByProportion(text, budget);
  }

  /** 预估（纯 countTokens 估算，不调模型） */
  async estimate(source: SkillForgeSource, sample: boolean): Promise<SkillForgeEstimate> {
    const { text, chapters } = await this.readSource(source);
    const fullTokens = countTokens(text);
    const model = await resolveModelNameForFeature(
      this.bridge,
      source.kind === 'book' ? source.bookId : '',
      'skill-forge'
    );

    let inputTokens = fullTokens;
    let sampled = false;
    let chunked = false;
    let calls = 1;

    if (sample && fullTokens > SAMPLE_BUDGET_TOKENS) {
      sampled = true;
      inputTokens = countTokens(this.sampleText(source, text, chapters, SAMPLE_BUDGET_TOKENS));
    } else if (!sample && fullTokens > SINGLE_CALL_MAX_TOKENS) {
      chunked = true;
      const chunks = chunkByParagraph(text);
      calls = chunks.length + 1; // 每片观测 + 1 次汇总
    }

    // 输出预估：单次 / 合成约 2000，分片另加每片约 600
    const outputTokens = chunked ? 2000 + (calls - 1) * 600 : 2000;

    return { inputTokens, calls, outputTokens, sampled, chunked, model };
  }

  /**
   * 提炼管线：素材归一 -> 采样或分片 -> 非流式 LLM 调用 -> 契约解析（含纠错重试一次）。
   * G4 记账装饰器自动入账（feature='skill-forge'，bookId 供归账）；中断即抛出且无任何中间产物落盘。
   * 返回 null 表示解析降级链全失败（UI 打开空白模板手动填写兜底）。
   */
  async forge(params: SkillForgeParams): Promise<SkillForgeDraft | null> {
    const { source, focus, sample = true, signal, onProgress } = params;
    const bookId = source.kind === 'book' ? source.bookId : '';
    const provider = await resolveProviderForFeature(this.bridge, bookId, 'skill-forge', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, bookId, 'skill-forge');

    onProgress?.({ phase: 'reading' });
    const { text, chapters } = await this.readSource(source);
    const fullTokens = countTokens(text);
    const system = buildSystemPrompt(focus);

    // 单次提炼调用（含解析降级链）
    const singleForge = async (userContent: string): Promise<SkillForgeDraft | null> => {
      onProgress?.({ phase: 'forging' });
      const res = await provider.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: userContent }
        ],
        { model, temperature: 0.3, maxTokens: 3000, signal }
      );
      return this.parseWithRetry(provider, model, system, userContent, res.content, signal);
    };

    if (sample && fullTokens > SAMPLE_BUDGET_TOKENS) {
      // 采样 -> 单次提炼
      onProgress?.({ phase: 'sampling' });
      const sampleText = this.sampleText(source, text, chapters, SAMPLE_BUDGET_TOKENS);
      return singleForge(`【素材开始】\n${sampleText}\n【素材结束】`);
    }

    if (!sample && fullTokens > SINGLE_CALL_MAX_TOKENS) {
      // 分片 map-reduce：逐片风格观测笔记 -> 汇总合成
      const chunks = chunkByParagraph(text);
      const notes: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        onProgress?.({ phase: 'observing', current: i + 1, total: chunks.length });
        const mapRes = await provider.chat(
          [
            {
              role: 'system',
              content: `你是文风分析助手。以下是长文本的第 ${i + 1}/${chunks.length} 片，请输出本片段的风格观测笔记（中文，不超过 ${NOTE_MAX_CHARS} 字），覆盖用词、句式节奏、视角、对白（若有）、意象、禁忌。只输出笔记本身。`
            },
            { role: 'user', content: chunks[i] }
          ],
          { model, temperature: 0.3, maxTokens: 1000, signal }
        );
        notes.push(mapRes.content.trim());
      }
      onProgress?.({ phase: 'synthesizing' });
      let notesAll = notes.map((n, i) => `【片段 ${i + 1} 观测】\n${n}`).join('\n\n');
      if (countTokens(notesAll) > SINGLE_CALL_MAX_TOKENS) {
        notesAll = truncateToTokenBudget(notesAll, SINGLE_CALL_MAX_TOKENS).text;
      }
      return singleForge(`${notesAll}\n【素材结束】`);
    }

    // 常规单次（素材 ≤ 16k 或已采样后仍在预算内）
    return singleForge(`【素材开始】\n${text}\n【素材结束】`);
  }

  /** 解析降级链：一级 JSON 解析 -> 失败追加纠错消息重试一次（二级正则已内置于 parseForgeResult） */
  private async parseWithRetry(
    provider: LLMProvider,
    model: string,
    system: string,
    userContent: string,
    raw: string,
    signal?: AbortSignal
  ): Promise<SkillForgeDraft | null> {
    const first = parseForgeResult(raw);
    if (first) return first;
    const res = await provider.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content: '上次输出无法解析为 JSON。请重新输出，仅输出一个 JSON 对象，不要任何其他文字与代码围栏。'
        }
      ],
      { model, temperature: 0.3, maxTokens: 3000, signal }
    );
    return parseForgeResult(res.content);
  }
}
