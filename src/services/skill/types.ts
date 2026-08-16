/** Skill（SKILL.md 声明式文风指令包）类型定义 */

export type AIMode = 'continue' | 'rewrite' | 'dialogue' | 'check';

export interface SkillManifest {
  name: string;
  description: string;
  trigger: 'manual' | 'auto' | 'keyword'; // P0 只实现 manual
  appliesTo: AIMode[]; // 在哪些 AI 模式下生效
  priority: number; // 多 Skill 冲突时排序，数字大优先
  keywords?: string[]; // 预留，P0 不用
  body: string; // SKILL.md 正文（frontmatter 之后的 Markdown）
  dirPath: string; // Skill 目录绝对路径
  loadedAt: number;
}
