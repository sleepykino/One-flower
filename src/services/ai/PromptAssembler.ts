/**
 * PromptAssembler：按 token 预算组装多模式 Prompt
 * 结构：system（指令 + 文风 Skill 正文）+ user（角色卡 + 前情 + 当前章 + 用户指令）
 */

import type { ChatMessage } from './providers/LLMProvider';
import type { AIMode, Character, ChapterContent, WorldbookEntryRef, ChapterBeat } from './types';
import type { SkillManifest } from '../skill/types';
import type { ChapterSummary } from '../summary/types';
import type { SegmentRecall } from '../rag/FullRAGService';
import { countTokens, truncateToTokenBudget } from '../../utils/tokens';

/** P2.1-M2：强制引用（不受检索相似度影响，全文注入独立预算段） */
export interface ForcedReference {
  refType: 'character' | 'worldbook' | 'chapter';
  refId: string;
  label: string;
  content: string; // 条目全文（由 AIOrchestrator.loadForcedRefs 填充）
}

export interface PromptContext {
  mode: AIMode;
  systemInstruction: string;
  enabledSkills: SkillManifest[]; // 已按 mode 过滤
  characters: Character[]; // 场景相关角色卡
  worldbookEntries?: WorldbookEntryRef[]; // P1：RAG 检索 top-K（check 模式为全量）
  summaryChain?: ChapterSummary[]; // P1：前 N 章摘要链（远 -> 近）
  segments?: SegmentRecall[]; // P2：全量 RAG 原文片段召回
  recentChapters: ChapterContent[]; // 滑动窗口：最近 2 章原文
  currentChapter?: ChapterContent; // 续写模式用
  userInstruction?: string; // 改写/扩写时用户的要求
  selectedText?: string; // 改写/扩写选中的文本
  /** M1: 启用的全局提示词条目 */
  globalPrompts?: string[];
  /** 项目级 agents.md 全文（本书全局指令书，优先级高于 globalPrompts 与 Skill） */
  projectDirective?: string;
  /** G1：全书大纲有效正文（作者规划的故事走向，前瞻约束；四模式与长文节拍规划注入） */
  bookOutline?: string;
  /** M2: 强制引用（不受检索相似度影响） */
  forcedRefs?: ForcedReference[];
  /** M5: 当前应执行的节拍（定向续写） */
  currentBeat?: ChapterBeat;
  /** 批次11-6：角色卡注入 token 预算覆盖（默认 this.budget.characters；长文模式放大承载全书角色） */
  characterBudget?: number;
  /** M6: 时代感基线（check 模式注入：非豁免设定事实 + 推导链） */
  settingBaseline?: {
    facts: Array<{ domain: string; fact: string; basis: string }>;
    chains: Array<{ premise: string; conclusion: string }>;
  };
}

export interface TokenBudget {
  system: number; // ~500
  skills: number; // ~2000
  characters: number; // ~1500
  worldbook: number; // ~1500 (P1)
  summaryChain: number; // ~4000（P1，替代部分 recentChapters）
  segments: number; // ~1500（P2，远期相关原文片段）
  recentChapters: number; // ~3000（从 6000 缩减，摘要链分担）
  currentChapter: number; // ~3000
  userInstruction: number; // ~1000
  globalPrompts: number; // ~600（P2.1-M1，作者全局要求）
  projectDirective: number; // ~1500（项目级 agents.md 指令书）
  bookOutline: number; // ~800（G1，全书大纲前瞻约束）
  forcedRefs: number; // ~1500（P2.1-M2，作者指定引用）
  reserved: number; // 生成预留 ~8000
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  system: 500,
  skills: 2000,
  characters: 1500,
  worldbook: 1500,
  summaryChain: 4000,
  segments: 1500,
  recentChapters: 3000,
  currentChapter: 3000,
  userInstruction: 1000,
  globalPrompts: 600,
  projectDirective: 1500,
  bookOutline: 800,
  forcedRefs: 1500,
  reserved: 8000
};

export interface TokenBreakdown {
  part: string;
  tokens: number;
  truncated: boolean; // 是否因超预算被截断
}

const MODE_TASK_INSTRUCTION: Record<AIMode, string> = {
  continue: '你是一位资深小说作者。请基于前情与当前章节内容，自然地续写下文。直接输出正文，不要任何解释或标题。',
  rewrite: '你是一位资深小说编辑。请按用户要求改写给定的选中文本。直接输出改写后的文本，不要任何解释。',
  dialogue: '你是一位资深小说作者。请根据场景与参与角色，创作符合人物性格的对白。直接输出对白正文（可含必要的动作/神态描写），不要任何解释。',
  check: '你是一位严谨的小说一致性审校。请对比章节正文与角色卡、世界书设定，找出矛盾之处。仅输出 JSON。'
};

export class PromptAssembler {
  private budget: TokenBudget;

  constructor(tokenBudget: TokenBudget = DEFAULT_TOKEN_BUDGET) {
    this.budget = tokenBudget;
  }

  assemble(ctx: PromptContext): ChatMessage[] {
    const systemParts: string[] = [];
    const userParts: string[] = [];

    // ---- user：M2 作者指定引用（最前，角色卡之前；不受检索相似度影响）----
    if (ctx.forcedRefs && ctx.forcedRefs.length > 0) {
      const typeLabel: Record<ForcedReference['refType'], string> = {
        character: '角色',
        worldbook: '世界书',
        chapter: '章节'
      };
      const refsAll = ctx.forcedRefs
        .map((r) => `【${typeLabel[r.refType]}·${r.label}】\n${r.content}`)
        .join('\n\n');
      userParts.push(
        `## 作者指定引用（本次生成必须参考以下条目全文）\n${truncateToTokenBudget(refsAll, this.budget.forcedRefs).text}`
      );
    }

    // ---- system：任务指令（system 预算内）----
    const task = MODE_TASK_INSTRUCTION[ctx.mode];
    systemParts.push(task);

    // ---- system：项目级 agents.md（最高优先级，高于全局提示词与任何 Skill 指令）----
    if (ctx.projectDirective && ctx.projectDirective.trim() !== '') {
      systemParts.push(
        `## 本书创作总纲（agents.md，优先级最高，高于全局要求、Skill 与任何其他指令；冲突时一律以本节为准）\n${truncateToTokenBudget(ctx.projectDirective, this.budget.projectDirective).text}`
      );
    }

    // ---- system：M1 作者全局要求（任务指令之后、Skill 之前；优先级显式高于 Skill）----
    if (ctx.globalPrompts && ctx.globalPrompts.length > 0) {
      const gpAll = ctx.globalPrompts.map((t) => `- ${t}`).join('\n');
      systemParts.push(
        `## 作者全局要求（优先级最高，高于任何 Skill 指令；与之冲突时以本节为准）\n${truncateToTokenBudget(gpAll, this.budget.globalPrompts).text}`
      );
    }

    // ---- system：M5 本章节拍约束（任务指令之后，定向续写）----
    if (ctx.currentBeat) {
      const b = ctx.currentBeat;
      systemParts.push(
        `## 本章节拍约束\n当前节拍：${b.text}（目标约 ${b.targetWords ?? 300} 字）\n严格围绕当前节拍写作，不得跳过、不得自行增加节拍；完成当前节拍内容后自然收束，留待下一拍。`
      );
    }

    // ---- system：文风 Skill 正文（按 priority 降序已排序）----
    if (ctx.enabledSkills.length > 0) {
      const skillTexts = ctx.enabledSkills.map(
        (s) => `【文风：${s.name}】\n${s.body}`
      );
      let skillsAll = skillTexts.join('\n\n');
      const fit = truncateToTokenBudget(skillsAll, this.budget.skills);
      skillsAll = fit.text;
      systemParts.push(`以下为必须遵守的文风指令：\n${skillsAll}`);
    }

    // ---- user：角色卡 ----
    if (ctx.characters.length > 0) {
      const charTexts = ctx.characters.map((c) => {
        const details = Object.entries(c.data)
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
          .map(([k, v]) => `- ${k}: ${String(v)}`)
          .join('\n');
        return `### 角色：${c.name}${c.tags.length ? `（标签：${c.tags.join('、')}）` : ''}\n${details}`;
      });
      let charsAll = charTexts.join('\n\n');
      // 批次11-6：角色卡预算可被调用方覆盖（长文模式放大），默认取本装配器预算
      charsAll = truncateToTokenBudget(charsAll, ctx.characterBudget ?? this.budget.characters).text;
      userParts.push(`【角色设定】\n${charsAll}`);
    }

    // ---- user：世界书（P1：RAG 检索 top-K；check 模式为全量）----
    if (ctx.worldbookEntries && ctx.worldbookEntries.length > 0) {
      const wbAll = ctx.worldbookEntries
        .map((w) => `- [${w.category ?? '设定'}] ${w.title}: ${w.content}`)
        .join('\n');
      userParts.push(
        `【世界书设定】\n${truncateToTokenBudget(wbAll, this.budget.worldbook).text}`
      );
    }

    // ---- user：全书大纲（G1：前瞻约束——本章在全书计划中的定位，剧情不跑偏）----
    if (ctx.bookOutline && ctx.bookOutline.trim() !== '') {
      userParts.push(
        `【全书大纲（作者规划的故事走向，续写须与本章在大纲中的定位保持一致，不得提前展开后续剧情）】\n${truncateToTokenBudget(ctx.bookOutline, this.budget.bookOutline).text}`
      );
    }

    // ---- user：前情摘要链（P1，远 -> 近，替代部分 recentChapters）----
    if (ctx.summaryChain && ctx.summaryChain.length > 0) {
      const n = ctx.summaryChain.length;
      const budgetPer = Math.floor(this.budget.summaryChain / n);
      const parts = ctx.summaryChain.map((s, i) => {
        const fit = truncateToTokenBudget(s.summary, Math.max(budgetPer, 100));
        return `《${s.title || `第 ${n - i} 章`}》（摘要）：${fit.text}`;
      });
      userParts.push(`【前情摘要（远 -> 近）】\n${parts.join('\n')}`);
    }

    // ---- user：远期相关片段（P2：全量 RAG 原文片段召回）----
    if (ctx.segments && ctx.segments.length > 0) {
      const segAll = ctx.segments
        .map((s) => `- 《${s.chapterTitle}》：${s.excerpt}`)
        .join('\n');
      userParts.push(
        `【远期相关片段（向量召回的既往章节原文，保持事实一致）】\n${truncateToTokenBudget(segAll, this.budget.segments).text}`
      );
    }

    // ---- user：前情（滑动窗口，远 -> 近）----
    if (ctx.recentChapters.length > 0) {
      const budgetPerChapter = Math.floor(this.budget.recentChapters / ctx.recentChapters.length);
      const parts = ctx.recentChapters.map((c) => {
        const t = truncateToTokenBudget(c.content, budgetPerChapter);
        return `《${c.title}》\n${t.text}`;
      });
      userParts.push(`【前情（远 → 近）】\n${parts.join('\n\n')}`);
    }

    // ---- user：当前章节已有内容 / 选中文本 ----
    if (ctx.mode === 'continue' && ctx.currentChapter) {
      const cur = truncateToTokenBudget(
        ctx.currentChapter.content || '（当前章节暂无内容）',
        this.budget.currentChapter
      );
      userParts.push(`【当前章节《${ctx.currentChapter.title}》已有内容（接续末尾续写）】\n${cur.text}`);
    }
    if (ctx.mode === 'rewrite' && ctx.selectedText) {
      userParts.push(`【待改写的选中文本】\n${truncateToTokenBudget(ctx.selectedText, this.budget.currentChapter).text}`);
    }
    if (ctx.mode === 'dialogue' && ctx.userInstruction) {
      userParts.push(`【场景】\n${ctx.userInstruction}`);
    }

    // ---- user：用户指令 ----
    if (ctx.userInstruction && ctx.mode !== 'dialogue') {
      userParts.push(`【要求】\n${truncateToTokenBudget(ctx.userInstruction, this.budget.userInstruction).text}`);
    }

    // ---- 输出格式 ----
    if (ctx.mode === 'check') {
      const checkLines: string[] = [];
      // M6：时代感基线（非豁免事实 + 推导链）
      const baseline = ctx.settingBaseline;
      const hasBaseline = !!baseline && (baseline.facts.length > 0 || baseline.chains.length > 0);
      if (baseline && hasBaseline) {
        const lines: string[] = [];
        if (baseline.facts.length > 0) {
          lines.push('【已确认设定事实（时代感基线）】');
          for (const f of baseline.facts.slice(0, 60)) {
            lines.push(`- [${f.domain}] ${f.fact}（依据：${f.basis}）`);
          }
        }
        if (baseline.chains.length > 0) {
          lines.push('', '【由事实推导的技术/社会前提（时代感基线）】');
          for (const c of baseline.chains.slice(0, 60)) {
            lines.push(`- ${c.premise} -> ${c.conclusion}`);
          }
        }
        checkLines.push(truncateToTokenBudget(lines.join('\n'), this.budget.worldbook).text, '');
      }
      checkLines.push(
        '【一致性检查任务】',
        '对比下方章节正文与上述角色卡/世界书设定'
          + (hasBaseline ? '及时代感基线' : '')
          + '，找出事实性矛盾（外貌、性格、关系、地点、时间线、物品、称谓等）。'
          + (hasBaseline
            ? '同时检查正文是否出现基线之外的越级技术/社会元素（例如无光学工艺基础却出现望远镜），此类越级矛盾同样计入 contradictions。'
            : ''),
        '严格输出如下 JSON（不要 markdown 代码块），无矛盾时 contradictions 为空数组：',
        '{"contradictions":[{"severity":"high|medium|low","description":"矛盾描述","relatedSetting":"关联的角色卡或世界书条目名称","chapterExcerpt":"章节原文片段"}]}',
        '',
        '【待检查的章节正文】',
        truncateToTokenBudget(
          ctx.currentChapter?.content ?? '',
          this.budget.currentChapter
        ).text
      );
      userParts.push(checkLines.join('\n'));
    } else {
      userParts.push('请开始输出。');
    }

    return [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: userParts.join('\n\n') }
    ];
  }

  /** 调试用：返回组装后的各部分 token 占用 */
  inspect(ctx: PromptContext): TokenBreakdown[] {
    const out: TokenBreakdown[] = [];
    const pdFit = truncateToTokenBudget(ctx.projectDirective ?? '', this.budget.projectDirective);
    out.push({ part: 'projectDirective', tokens: countTokens(pdFit.text), truncated: pdFit.truncated });
    const boFit = truncateToTokenBudget(ctx.bookOutline ?? '', this.budget.bookOutline);
    out.push({ part: 'bookOutline', tokens: countTokens(boFit.text), truncated: boFit.truncated });
    const gpAll = (ctx.globalPrompts ?? []).join('\n');
    const gpFit = truncateToTokenBudget(gpAll, this.budget.globalPrompts);
    out.push({ part: 'globalPrompts', tokens: countTokens(gpFit.text), truncated: gpFit.truncated });
    const refsAll = (ctx.forcedRefs ?? []).map((r) => r.content).join('\n');
    const refsFit = truncateToTokenBudget(refsAll, this.budget.forcedRefs);
    out.push({ part: 'forcedRefs', tokens: countTokens(refsFit.text), truncated: refsFit.truncated });
    const skills = ctx.enabledSkills.map((s) => s.body).join('\n\n');
    out.push({
      part: 'system',
      tokens: countTokens(MODE_TASK_INSTRUCTION[ctx.mode]),
      truncated: false
    });
    const skillsFit = truncateToTokenBudget(skills, this.budget.skills);
    out.push({ part: 'skills', tokens: countTokens(skillsFit.text), truncated: skillsFit.truncated });
    const chars = ctx.characters
      .map((c) => JSON.stringify(c.data))
      .join('\n');
    const charsFit = truncateToTokenBudget(chars, ctx.characterBudget ?? this.budget.characters);
    out.push({
      part: 'characters',
      tokens: countTokens(charsFit.text),
      truncated: charsFit.truncated
    });
    const wb = (ctx.worldbookEntries ?? [])
      .map((w) => `${w.title}: ${w.content}`)
      .join('\n');
    const wbFit = truncateToTokenBudget(wb, this.budget.worldbook);
    out.push({ part: 'worldbook', tokens: countTokens(wbFit.text), truncated: wbFit.truncated });
    const chain = (ctx.summaryChain ?? []).map((s) => s.summary).join('\n');
    const chainFit = truncateToTokenBudget(chain, this.budget.summaryChain);
    out.push({
      part: 'summaryChain',
      tokens: countTokens(chainFit.text),
      truncated: chainFit.truncated
    });
    const segs = (ctx.segments ?? []).map((s) => s.excerpt).join('\n');
    const segsFit = truncateToTokenBudget(segs, this.budget.segments);
    out.push({
      part: 'segments',
      tokens: countTokens(segsFit.text),
      truncated: segsFit.truncated
    });
    const recent = ctx.recentChapters.map((c) => c.content).join('\n');
    const recentFit = truncateToTokenBudget(recent, this.budget.recentChapters);
    out.push({
      part: 'recentChapters',
      tokens: countTokens(recentFit.text),
      truncated: recentFit.truncated
    });
    const currentFit = truncateToTokenBudget(ctx.currentChapter?.content ?? '', this.budget.currentChapter);
    out.push({
      part: 'currentChapter',
      tokens: countTokens(currentFit.text),
      truncated: currentFit.truncated
    });
    return out;
  }
}
