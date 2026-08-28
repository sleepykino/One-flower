/**
 * CharacterInterviewService（P2.1-B M3）：角色采访
 * - 用户提问，AI 扮演该角色回答（功能键 interview）；基于角色卡设定 + 章节摘要保持角色一致性
 * - 多轮对话 + 可切换采访角度；完整对话存 interview_sessions 表（历史可回看，不污染角色卡）
 * - 结束时 AI 生成摘要预览；用户点「添加到角色卡」才写入 data.interviews
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider, ChatMessage, ChatChunk } from '../ai/providers/LLMProvider';
import { resolveProviderForFeature, resolveModelNameForFeature } from '../ai/providerResolver';
import type { GenerationContextService } from '../ai/GenerationContext';
import type { CharacterService } from '../character/CharacterService';
import type {
  InterviewAngle,
  InterviewMessage,
  InterviewSession,
  InterviewRecord
} from './types';
import { INTERVIEW_ANGLE_LABEL } from './types';

const ANGLE_INSTRUCTION: Record<InterviewAngle, string> = {
  childhood: '本次采访聚焦角色的童年往事与成长经历：家乡、家庭、童年创伤或温暖记忆、如何塑造了今天的他/她。',
  motivation: '本次采访聚焦角色的深层动机与欲望：他/她真正想要什么、害怕失去什么、愿意付出什么代价。',
  secret: '本次采访聚焦角色的秘密与隐瞒之事：藏在心底不敢说的事、对谁撒过谎、愧疚与软肋。可以回避但要有痕迹。',
  relationships: '本次采访聚焦角色的人际关系：对书中其他人物的真实看法、信任与戒备、未说出口的情感。',
  event_opinion: '本次采访聚焦角色对书中已发生事件的看法：立场、感受、以及不曾表露的真实态度。',
  free: '自由采访：不限主题，按提问自然深入。'
};

/** 活跃会话缓存（避免每轮问答全量回读 DB） */
const sessions = new Map<string, InterviewSession>();

export class CharacterInterviewService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private characterService: CharacterService;
  /** 批次11-4：不经 orchestrator 的调用统一补充全局提示词 + 文风 Skill */
  private generation: GenerationContextService;

  constructor(
    bridge: NativeBridge,
    db: Database,
    wq: WriteQueue,
    providerFactory: (configId: string) => Promise<LLMProvider>,
    characterService: CharacterService,
    generation: GenerationContextService
  ) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.providerFactory = providerFactory;
    this.characterService = characterService;
    this.generation = generation;
  }

  /** 开始采访会话 */
  async startSession(
    characterId: string,
    bookId: string,
    angle: InterviewAngle
  ): Promise<InterviewSession> {
    const character = await this.characterService.get(characterId);
    if (!character) throw new Error('角色不存在');
    const id = crypto.randomUUID();
    const session: InterviewSession = {
      id,
      bookId,
      characterId,
      angle,
      messages: [],
      startedAt: Date.now()
    };
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO interview_sessions (id, book_id, character_id, angle, messages, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, bookId, characterId, angle, JSON.stringify([]), session.startedAt]
      )
    );
    sessions.set(id, session);
    return session;
  }

  /** 取会话（缓存优先，落库兜底） */
  async getSession(sessionId: string): Promise<InterviewSession | null> {
    const cached = sessions.get(sessionId);
    if (cached) return cached;
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM interview_sessions WHERE id = ?',
      [sessionId]
    );
    if (!row) return null;
    return this.rowToSession(row);
  }

  /** 提问（流式返回角色回答；功能键 interview；回答完自动落库） */
  async *ask(
    sessionId: string,
    question: string,
    signal?: AbortSignal
  ): AsyncIterable<ChatChunk> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('采访会话不存在');
    if (session.endedAt) throw new Error('采访已结束，请开始新会话');

    const character = await this.characterService.get(session.characterId);
    if (!character) throw new Error('角色不存在');

    const provider = await resolveProviderForFeature(
      this.bridge,
      session.bookId,
      'interview',
      this.providerFactory
    );
    const model = await resolveModelNameForFeature(this.bridge, session.bookId, 'interview');

    // 记录提问
    const qMsg: InterviewMessage = {
      role: 'interviewer',
      content: question,
      timestamp: Date.now()
    };
    session.messages.push(qMsg);
    await this.persistMessages(session);

    // 组装消息：system（角色 + 摘要 + 角度）+ 历史 + 本轮提问
    const historyMessages: ChatMessage[] = session.messages.map((m): ChatMessage => ({
      role: m.role === 'interviewer' ? 'user' : 'assistant',
      content: m.content
    }));
    // 批次11-4：对白生成统一补充「作者全局要求 + 文风 Skill」（dialogue 模式）
    const extras = await this.generation.systemExtras(session.bookId, 'dialogue');
    const systemContent = [
      await this.buildSystemPrompt(session, character.data, character.name),
      ...extras
    ].join('\n\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...historyMessages
    ];

    // 流式输出；结束后把角色回答落库（中断也保留已生成部分）
    let answer = '';
    try {
      for await (const chunk of provider.stream(messages, {
        model,
        signal,
        maxTokens: 2048,
        temperature: 0.85
      })) {
        if (chunk.delta) answer += chunk.delta;
        yield chunk;
      }
    } finally {
      if (answer.trim()) {
        session.messages.push({
          role: 'character',
          content: answer,
          timestamp: Date.now()
        });
        await this.persistMessages(session);
      }
    }
  }

  /** 组装 system 提示词：角色扮演 + 角色卡 + 章节摘要 + 角度指令 */
  private async buildSystemPrompt(
    session: InterviewSession,
    characterDataJson: string,
    characterName: string
  ): Promise<string> {
    // 相关章节摘要（最近 5 章有摘要的）
    const rows = await this.db.query<{ title: string; summary: string | null }>(
      `SELECT title, summary FROM chapters
       WHERE book_id = ? AND summary IS NOT NULL AND summary != ''
       ORDER BY sort_order DESC LIMIT 5`,
      [session.bookId]
    );
    const summaries = rows
      .reverse()
      .map((r) => `- ${r.title}：${r.summary}`)
      .join('\n');

    const parts = [
      `你正在进行一场沉浸式角色采访。你扮演小说角色「${characterName}」本人，接受采访者的提问。`,
      `【角色卡设定】\n${this.formatCharacterData(characterDataJson)}`
    ];
    if (summaries) {
      parts.push(`【相关章节摘要（剧情背景，角色亲历）】\n${summaries}`);
    }
    parts.push(`【采访角度】\n${ANGLE_INSTRUCTION[session.angle]}`);
    parts.push(`要求：
- 始终以「${characterName}」的第一人称口吻回答，贴合角色的性格、用语习惯与知识范围，绝不 OOC（脱离角色）
- 超出角色知识范围的事（作者视角信息、未发生的剧情）就坦诚不知道或按性格回避
- 回答有血有肉，可带情绪、回忆与细节，长度适中（约100-400字）
- 只输出角色的回答本身，不要旁白、舞台指示或采访者的话`);
    return parts.join('\n\n');
  }

  /** 切换采访角度 */
  async switchAngle(sessionId: string, angle: InterviewAngle): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('采访会话不存在');
    session.angle = angle;
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE interview_sessions SET angle = ? WHERE id = ?', [angle, sessionId])
    );
  }

  /** 结束会话（返回记录；摘要由 summarize 单独生成供预览） */
  async endSession(sessionId: string): Promise<InterviewRecord> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('采访会话不存在');
    if (!session.endedAt) {
      session.endedAt = Date.now();
      await this.wq.enqueue(() =>
        this.db.exec('UPDATE interview_sessions SET ended_at = ? WHERE id = ?', [
          session.endedAt,
          sessionId
        ])
      );
    }
    const duration = Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000));
    return {
      sessionId,
      characterId: session.characterId,
      messageCount: session.messages.length,
      duration,
      summary: '',
      savedToCharacter: Boolean(session.savedToCharacter)
    };
  }

  /** 生成采访摘要（AI 调用；返回文本给用户预览，不写角色卡） */
  async summarize(sessionId: string, signal?: AbortSignal): Promise<string> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('采访会话不存在');
    if (session.messages.length === 0) throw new Error('采访记录为空，无法生成摘要');

    const provider = await resolveProviderForFeature(
      this.bridge,
      session.bookId,
      'interview',
      this.providerFactory
    );
    const model = await resolveModelNameForFeature(this.bridge, session.bookId, 'interview');

    const transcript = session.messages
      .map((m) => `${m.role === 'interviewer' ? '问' : '答'}：${m.content}`)
      .join('\n\n');

    const res = await provider.chat(
      [
        {
          role: 'system',
          content: `你是资深小说编辑。以下是对小说角色的采访记录，请生成一份采访摘要，用于补充角色设定。
要求：
- 提炼采访中揭示的新信息：性格细节、背景补充、动机线索、人际关系、代表性原话
- 只收录设定之外的新增信息，已有设定不重复
- 分条列出（每条一句话），保留角色的独特语气印记
- 总长 200-400 字，直接输出摘要正文，不要标题和前后缀`
        },
        {
          role: 'user',
          content: `【角色】${await this.characterNameOf(session.characterId)}\n【采访角度】${
            INTERVIEW_ANGLE_LABEL[session.angle]
          }\n\n【采访记录】\n${transcript}`
        }
      ],
      { model, temperature: 0.4, maxTokens: 1200, signal }
    );
    return res.content.trim();
  }

  /**
   * 用户点「添加到角色卡」后才调用：将摘要追加到角色卡 data.interviews
   * （完整对话留在 interview_sessions 表可回看；摘要同步存灵感库 type='interview_summary'）
   */
  async saveSummaryToCharacter(sessionId: string, summary: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('采访会话不存在');

    const character = await this.characterService.get(session.characterId);
    if (!character) throw new Error('角色不存在');

    // data.interviews 追加
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(character.data) as Record<string, unknown>;
    } catch {
      data = { name: character.name };
    }
    const interviews = Array.isArray(data.interviews)
      ? (data.interviews as Record<string, unknown>[])
      : [];
    interviews.push({
      sessionId,
      date: new Date().toISOString().slice(0, 10),
      angle: session.angle,
      summary
    });
    data.interviews = interviews;
    await this.characterService.update(character.id, {
      data,
      name: character.name
    });

    // 标记已保存
    session.savedToCharacter = true;
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE interview_sessions SET saved_to_character = 1 WHERE id = ?', [sessionId])
    );

    // 摘要存灵感库（按书绑定）
    const characterName = character.name;
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO inspirations (id, book_id, type, title, content, tags, source, favorited, metadata, created_at)
         VALUES (?, ?, 'interview_summary', ?, ?, ?, 'ai', 0, ?, ?)`,
        [
          crypto.randomUUID(),
          session.bookId,
          `采访摘要：${characterName}`,
          JSON.stringify({
            characterId: session.characterId,
            characterName,
            angle: session.angle,
            summary
          }),
          JSON.stringify([characterName, '采访']),
          JSON.stringify({ characterId: session.characterId, characterName }),
          Date.now()
        ]
      )
    );
  }

  /** 列出某角色的历史采访（时间倒序） */
  async listByCharacter(characterId: string): Promise<InterviewSession[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM interview_sessions WHERE character_id = ? ORDER BY started_at DESC',
      [characterId]
    );
    return rows.map((r) => this.rowToSession(r));
  }

  /** 删除采访会话（历史记录；不影响已写入角色卡的摘要） */
  async deleteSession(sessionId: string): Promise<void> {
    sessions.delete(sessionId);
    await this.wq.enqueue(() =>
      this.db.exec('DELETE FROM interview_sessions WHERE id = ?', [sessionId])
    );
  }

  /** 列出某书全部采访会话（时间倒序） */
  async listByBook(bookId: string): Promise<InterviewSession[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM interview_sessions WHERE book_id = ? ORDER BY started_at DESC',
      [bookId]
    );
    return rows.map((r) => this.rowToSession(r));
  }

  /** 消息数组落库 */
  private async persistMessages(session: InterviewSession): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE interview_sessions SET messages = ? WHERE id = ?', [
        JSON.stringify(session.messages),
        session.id
      ])
    );
  }

  private async characterNameOf(characterId: string): Promise<string> {
    const c = await this.characterService.get(characterId);
    return c?.name ?? '未知角色';
  }

  /** 角色卡 JSON 转可读文本（过滤空字段） */
  private formatCharacterData(dataJson: string): string {
    try {
      const data = JSON.parse(dataJson) as Record<string, unknown>;
      const lines: string[] = [];
      for (const [k, v] of Object.entries(data)) {
        if (k === 'interviews') continue; // 旧采访摘要不注入，保持新鲜视角
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'string') lines.push(`${k}：${v}`);
        else lines.push(`${k}：${JSON.stringify(v)}`);
      }
      return lines.join('\n') || '（无设定）';
    } catch {
      return dataJson;
    }
  }

  private rowToSession(r: Record<string, unknown>): InterviewSession {
    let messages: InterviewMessage[] = [];
    try {
      const parsed = JSON.parse(String(r.messages ?? '[]')) as unknown;
      if (Array.isArray(parsed)) messages = parsed as InterviewMessage[];
    } catch {
      /* 损坏降级为空 */
    }
    const session: InterviewSession = {
      id: String(r.id),
      bookId: String(r.book_id),
      characterId: String(r.character_id),
      angle: String(r.angle) as InterviewAngle,
      messages,
      startedAt: Number(r.started_at),
      endedAt: r.ended_at == null ? undefined : Number(r.ended_at),
      savedToCharacter: Number(r.saved_to_character ?? 0) === 1
    };
    sessions.set(session.id, session);
    return session;
  }
}
