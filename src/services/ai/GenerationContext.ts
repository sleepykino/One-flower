/**
 * GenerationContextService：不经 orchestrator 的生成类调用统一补充
 * 作者全局要求 + 文风 Skill。
 *
 * 语义与 PromptAssembler 保持一致：
 * - 作者全局要求（GlobalPromptService.enabledTexts）优先级高于 Skill；
 * - 两者均按 DEFAULT_TOKEN_BUDGET 对应预算截断；
 * - 客观任务（摘要/错字/事实抽取）不接入本服务，保持现状。
 */

import type { GlobalPromptService } from './GlobalPromptService';
import type { SkillLoader } from '../skill/SkillLoader';
import type { AIMode } from '../skill/types';
import { DEFAULT_TOKEN_BUDGET } from './PromptAssembler';
import { truncateToTokenBudget } from '../../utils/tokens';

export class GenerationContextService {
  private globalPrompts: GlobalPromptService;
  private skillLoader: SkillLoader;

  constructor(globalPrompts: GlobalPromptService, skillLoader: SkillLoader) {
    this.globalPrompts = globalPrompts;
    this.skillLoader = skillLoader;
  }

  /**
   * 生成类调用统一补充：返回可拼接到 system 段的文本数组
   * （作者全局要求 + 文风 Skill；任一部分失败或为空则跳过，不打断生成）。
   * @param bookId 无书上下文（全局灵感类入口）传 ''，此时 Skill 自然为空、仅全局要求生效
   */
  async systemExtras(bookId: string, mode: AIMode): Promise<string[]> {
    const parts: string[] = [];
    try {
      const gps = await this.globalPrompts.enabledTexts();
      if (gps.length > 0) {
        const gpAll = gps.map((t) => `- ${t}`).join('\n');
        const fit = truncateToTokenBudget(gpAll, DEFAULT_TOKEN_BUDGET.globalPrompts);
        parts.push(
          `## 作者全局要求（优先级最高，高于任何 Skill 指令；与之冲突时以本节为准）\n${fit.text}`
        );
      }
    } catch (e) {
      console.warn('[AI] 读取全局提示词失败，已跳过:', e);
    }
    try {
      const skills = await this.skillLoader.getEnabledForMode(bookId, mode);
      if (skills.length > 0) {
        const skillTexts = skills.map((s) => `【文风：${s.name}】\n${s.body}`);
        const fit = truncateToTokenBudget(skillTexts.join('\n\n'), DEFAULT_TOKEN_BUDGET.skills);
        parts.push(`以下为必须遵守的文风指令：\n${fit.text}`);
      }
    } catch (e) {
      console.warn('[AI] 读取文风 Skill 失败，已跳过:', e);
    }
    return parts;
  }
}
