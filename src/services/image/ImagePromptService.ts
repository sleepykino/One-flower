/**
 * ImagePromptService：两段式提示词转写（P3）
 * 第一步：中文场景描述 -> 对话模型（'image-prompt' 路由，可选便宜模型）
 * 第二步：专业英文图片 prompt + negative prompt（交给生图 Provider）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { LLMProvider } from '../ai/providers/LLMProvider';
import { resolveProviderConfigIdForFeature } from '../ai/providerResolver';
import type { GenerationContextService } from '../ai/GenerationContext';
import { parseLooseJson } from '../../utils/looseJson';
import type { ImageScene } from './types';

const PROMPT_SYSTEM = `你是资深的 AI 绘画提示词工程师，为小说配图（封面 / 角色立绘 / 正文插图）撰写生图提示词。
用户会给出中文场景描述，请输出适合扩散模型的专业英文提示词。要求：
1. prompt：英文，逗号分隔的关键词与短语，包含主体、外貌细节、动作/姿态、环境场景、构图（如 full body portrait / establishing shot）、镜头视角、光影氛围、艺术风格（如 digital painting, concept art, cinematic lighting）与画质词（masterpiece, highly detailed）
2. negativePrompt：英文，逗号分隔的负面词（如 lowres, blurry, bad anatomy, extra fingers, text, watermark, ugly）
3. 忠实于用户的场景描述，不虚构与小说无关的内容；人物外貌按描述具体化
4. 严格输出 JSON：{"prompt": "...", "negativePrompt": "..."}，不要输出 JSON 之外的任何文字或代码围栏`;

/** 场景 -> 中文描述文本（对话框预填 / 直接生图兜底共用） */
export function sceneDescription(scene: ImageScene): string {
  switch (scene.kind) {
    case 'cover': {
      const { title, genre, author } = scene.book;
      const parts = [`为一部${genre ? `${genre}题材` : ''}的长篇小说《${title}》设计书籍封面插画`];
      if (author) parts.push(`作者：${author}`);
      parts.push('封面需体现小说的核心意象与氛围，具有书籍封面的构图感（主体突出、留有呼吸感），不要出现书名文字');
      return parts.join('。');
    }
    case 'character': {
      const fields = Object.entries(scene.cardData)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
        .map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('；');
      return `为小说角色「${scene.name}」生成人物立绘/头像。角色卡信息：${fields || '（未填写详细设定，请按名字气质自由发挥）'}。人物形象需符合上述设定，单人或半身构图，神态生动`;
    }
    case 'illustration': {
      const text = scene.selectedText.length > 1500 ? `${scene.selectedText.slice(0, 1500)}…` : scene.selectedText;
      return `为小说章节「${scene.chapterTitle}」中的以下场景生成一幅正文插图，忠实呈现场景中的人物、动作与环境：\n${text}`;
    }
  }
}

export class ImagePromptService {
  private bridge: NativeBridge;
  private chatProviderFactory: (configId: string) => Promise<LLMProvider>;
  /** 批次11-4：不经 orchestrator 的调用统一补充全局提示词 + 文风 Skill */
  private generation: GenerationContextService;

  constructor(
    bridge: NativeBridge,
    chatProviderFactory: (configId: string) => Promise<LLMProvider>,
    generation: GenerationContextService
  ) {
    this.bridge = bridge;
    this.chatProviderFactory = chatProviderFactory;
    this.generation = generation;
  }

  /** 两段式第一步：中文场景 -> 英文图片 prompt（风格/构图/负面词）；sceneTextOverride 覆盖默认场景描述 */
  async buildPrompt(
    bookId: string,
    scene: ImageScene,
    userHint?: string,
    sceneTextOverride?: string
  ): Promise<{ prompt: string; negativePrompt: string }> {
    const configId = await resolveProviderConfigIdForFeature(this.bridge, bookId, 'image-prompt');
    if (!configId) {
      throw new Error('未配置提示词转写模型，请先到设置页「模型接入」添加 Provider 配置');
    }
    const row = await this.bridge.db.queryOne<{ model: string }>(
      'SELECT model FROM provider_configs WHERE id = ?',
      [configId]
    );
    if (!row) throw new Error('模型配置不存在');
    const provider = await this.chatProviderFactory(configId);

    const userParts = [sceneTextOverride?.trim() ? sceneTextOverride.trim() : sceneDescription(scene)];
    if (userHint?.trim()) userParts.push(`补充要求：${userHint.trim()}`);
    // 批次11-4：不经 orchestrator 的调用统一补充「作者全局要求 + 文风 Skill」
    const extras = await this.generation.systemExtras(bookId, 'continue');
    const res = await provider.chat(
      [
        { role: 'system', content: [PROMPT_SYSTEM, ...extras].join('\n\n') },
        { role: 'user', content: userParts.join('\n') }
      ],
      { model: row.model, temperature: 0.7, maxTokens: 1200 }
    );
    return parsePromptResult(res.content);
  }
}

/** 解析模型输出的 JSON（容错：公共实现 parseLooseJson，剥围栏/杂文/注释） */
export function parsePromptResult(content: string): { prompt: string; negativePrompt: string } {
  const parsed = parseLooseJson<{ prompt?: unknown; negativePrompt?: unknown }>(content);
  if (parsed) {
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
    const negativePrompt = typeof parsed.negativePrompt === 'string' ? parsed.negativePrompt.trim() : '';
    if (prompt) return { prompt, negativePrompt };
  }
  // 兜底：整段输出直接作为 prompt
  const fallback = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!fallback) throw new Error('提示词转写失败：模型返回为空');
  return { prompt: fallback, negativePrompt: '' };
}
