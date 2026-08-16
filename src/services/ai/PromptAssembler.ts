/**
 * PromptAssembler：按 token 预算组装多模式 Prompt
 * 结构：system（指令 + 文风 Skill 正文）+ user（角色卡 + 前情 + 当前章 + 用户指令）
 */

import type { ChatMessage } from './providers/LLMProvider';
import type { AIMode, Character, ChapterContent, WorldbookEntryRef } from './types';
import type { SkillManifest } from '../skill/types';
import type { ChapterSummary } from '../summary/types';
import { countTokens, truncateToTokenBudget } from '../../utils/tokens';

export interface PromptContext {
  mode: AIMode;
  systemInstruction: string;
  enabledSkills: SkillManifest[]; // 已按 mode 过滤
  characters: Character[]; // 场景相关角色卡
  worldbookEntries?: WorldbookEntryRef[]; // P1：RAG 检索 top-K（check 模式为全量）
  summaryChain?: ChapterSummary[]; // P1：前 N 章摘要链（远 -> 近）
  recentChapters: ChapterContent[]; // 滑动窗口：最近 2 章原文
  currentChapter?: ChapterContent; // 续写模式用
  userInstruction?: string; // 改写/扩写时用户的要求
  selectedText?: string; // 改写/扩写选中的文本
}

export interface TokenBudget {
  system: number; // ~500
  skills: number; // ~2000
  characters: number; // ~1500
  worldbook: number; // ~1500 (P1)
  summaryChain: number; // ~4000（P1，替代部分 recentChapters）
  recentChapters: number; // ~3000（从 6000 缩减，摘要链分担）
  currentChapter: number; // ~3000
  userInstruction: number; // ~1000
  reserved: number; // 生成预留 ~8000
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  system: 500,
  skills: 2000,
  characters: 1500,
  worldbook: 1500,
  summaryChain: 4000,
  recentChapters: 3000,
  currentChapter: 3000,
  userInstruction: 1000,
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

    // ---- system：任务指令（system 预算内）----
    const task = MODE_TASK_INSTRUCTION[ctx.mode];
    systemParts.push(task);

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
      charsAll = truncateToTokenBudget(charsAll, this.budget.characters).text;
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
      userParts.push(
        [
          '【一致性检查任务】',
          '对比下方章节正文与上述角色卡/世界书设定，找出事实性矛盾（外貌、性格、关系、地点、时间线、物品、称谓等）。',
          '严格输出如下 JSON（不要 markdown 代码块），无矛盾时 contradictions 为空数组：',
          '{"contradictions":[{"severity":"high|medium|low","description":"矛盾描述","relatedSetting":"关联的角色卡或世界书条目名称","chapterExcerpt":"章节原文片段"}]}',
          '',
          '【待检查的章节正文】',
          truncateToTokenBudget(
            ctx.currentChapter?.content ?? '',
            this.budget.currentChapter
          ).text
        ].join('\n')
      );
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
    const charsFit = truncateToTokenBudget(chars, this.budget.characters);
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
