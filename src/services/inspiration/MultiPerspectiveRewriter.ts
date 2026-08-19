/**
 * MultiPerspectiveRewriter（P2.1-B M5）：多视角重写
 * - 列出可用视角：本书全部角色卡 + 固定非角色视角（上帝/旁观者/未来回望）
 * - 从指定视角流式重写选中文本；角色视角注入角色卡设定保持一致性
 * - 功能键复用 rewrite（模型分工不新增条目），结果由 AIPanel 写入临时节点
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider, ChatMessage, ChatChunk } from '../ai/providers/LLMProvider';
import { resolveProviderForFeature, resolveModelNameForFeature } from '../ai/providerResolver';
import type { SkillLoader } from '../skill/SkillLoader';
import { rowToCharacter } from '../character/CharacterService';
import type { PerspectiveRewriteParams, AvailablePerspective } from './types';

/** 固定非角色视角 */
const NARRATOR_PERSPECTIVES: Array<{ label: string; instruction: string }> = [
  {
    label: '上帝视角',
    instruction:
      '上帝视角（全知叙述者）：洞悉所有人物的内心与命运，叙述从容俯瞰，可预埋伏笔与命运感。'
  },
  {
    label: '旁观者视角',
    instruction:
      '旁观者视角（有限视角）：叙述者只呈现可观察的动作、对话与环境，不进入任何人物内心，靠细节留白让读者自行推断。'
  },
  {
    label: '未来回望视角',
    instruction:
      '未来回望视角：以事件结束后的口吻回顾当下，带有追忆、感慨与宿命感，可透露后续走向的暗示。'
  }
];

const SYSTEM_BASE = `你是一位资深小说编辑，精通叙事视角转换。
任务：将给定的选中文本改写为指定视角的叙述。要求：
- 情节事实、人物、场景保持不变，只转换叙述视角
- 人称、时态、信息可见范围随视角调整
- 角色视角只呈现该角色能感知与知晓的信息，语气贴合角色性格
- 篇幅与原文大致相当
直接输出改写后的文本，不要任何解释。`;

export class MultiPerspectiveRewriter {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private skillLoader: SkillLoader;

  constructor(
    bridge: NativeBridge,
    db: Database,
    wq: WriteQueue,
    providerFactory: (configId: string) => Promise<LLMProvider>,
    skillLoader: SkillLoader
  ) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.providerFactory = providerFactory;
    this.skillLoader = skillLoader;
  }

  /** 列出可用视角：本书全部角色卡 + 固定非角色视角（不做章节角色出现分析，简化） */
  async listPerspectives(bookId: string): Promise<AvailablePerspective[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM characters WHERE book_id = ? ORDER BY created_at ASC',
      [bookId]
    );
    const characters = rows.map(rowToCharacter);
    return [
      ...characters.map((c) => ({
        label: `${c.name}的视角`,
        type: 'character' as const,
        characterId: c.id,
        characterName: c.name
      })),
      ...NARRATOR_PERSPECTIVES.map((p) => ({
        label: p.label,
        type: 'narrator' as const
      }))
    ];
  }

  /** 从指定视角重写（流式；功能键复用 rewrite；结果由 AIPanel 写入临时节点，service 不管 UI） */
  async *rewrite(params: PerspectiveRewriteParams): AsyncIterable<ChatChunk> {
    const provider = await resolveProviderForFeature(
      this.bridge,
      params.bookId,
      'rewrite',
      this.providerFactory
    );
    const model = await resolveModelNameForFeature(this.bridge, params.bookId, 'rewrite');

    // 视角指令：非角色视角查固定表，角色视角由角色名 + 角色卡描述
    let perspectiveInstruction = '';
    if (params.characterId) {
      const row = await this.db.queryOne<Record<string, unknown>>(
        'SELECT * FROM characters WHERE id = ?',
        [params.characterId]
      );
      if (row) {
        const character = rowToCharacter(row);
        perspectiveInstruction = `${character.name}的第一人称/贴身视角：叙述语气、用词、关注点贴合该角色性格与身份，只呈现该角色能感知与知晓的信息。\n【角色卡设定】\n${this.formatCharacterData(character.data)}`;
      }
    } else {
      const fixed = NARRATOR_PERSPECTIVES.find((p) => p.label === params.perspective);
      perspectiveInstruction = fixed
        ? fixed.instruction
        : `${params.perspective}：以该视角叙述，信息可见范围与人称随之调整。`;
    }

    // 文风 Skill（rewrite 模式启用项）
    const skills = await this.skillLoader.getEnabledForMode(params.bookId, 'rewrite');

    const systemParts = [SYSTEM_BASE, `【目标视角】\n${perspectiveInstruction}`];
    if (skills.length > 0) {
      const skillTexts = skills.map((s) => `【文风：${s.name}】\n${s.body}`);
      systemParts.push(`以下为必须遵守的文风指令：\n${skillTexts.join('\n\n')}`);
    }

    const userParts = [`【待改写的选中文本】\n${params.selectedText}`];
    if (params.tone?.trim()) {
      userParts.push(`【改写要求】\n${params.tone.trim()}`);
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: userParts.join('\n\n') }
    ];

    yield* provider.stream(messages, {
      model,
      signal: params.signal,
      maxTokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.7
    });
  }

  /** 角色卡 JSON 转可读文本（过滤空字段） */
  private formatCharacterData(dataJson: string): string {
    try {
      const data = JSON.parse(dataJson) as Record<string, unknown>;
      const lines: string[] = [];
      for (const [k, v] of Object.entries(data)) {
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'string') lines.push(`${k}：${v}`);
        else lines.push(`${k}：${JSON.stringify(v)}`);
      }
      return lines.join('\n') || '（无设定）';
    } catch {
      return dataJson;
    }
  }
}
