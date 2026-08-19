/**
 * WhatIfSimulator（P2.1-B M4）："如果…会怎样"推演器
 * - 给定假设 + 锚点章节 + 推演范围 -> AI 推演对后续剧情的影响（非流式，结构化 JSON 报告）
 * - 上下文：锚点前章节摘要链 + 角色卡 + 世界书
 * - 报告存灵感库（inspirations 表 type='whatif_report'，按书绑定）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider, ChatMessage } from '../ai/providers/LLMProvider';
import { resolveProviderForFeature, resolveModelNameForFeature } from '../ai/providerResolver';
import { rowToCharacter } from '../character/CharacterService';
import type { WhatIfParams, WhatIfReport } from './types';

const WHATIF_SYSTEM_PROMPT = `你是资深小说剧情策划顾问，擅长推演"如果…会怎样"的剧情假设对故事结构的影响。
根据给定的假设、剧情摘要、角色与世界书设定，推演出结构化的影响报告。
严格输出 JSON 对象（不要 markdown 代码围栏、不要任何解释）：
{
  "impactScope": "影响范围概述（80字内：波及哪些主线、人物关系、世界观设定）",
  "characterChanges": [
    {"characterId": "受影响角色的ID（必须从提供的角色列表中选取）", "characterName": "角色名", "originalArc": "原弧光一句话", "modifiedArc": "推演后弧光一句话"}
  ],
  "plotBranches": [
    {"chapterOffset": 1, "branchPoint": "分支点描述（一句话）", "outcome": "走向预测（一句话）"}
  ],
  "risks": ["潜在风险1（如：某角色弧光断裂）", "潜在风险2"],
  "recommendation": "结论与建议：值得尝试 / 风险过高 / 需要调整，附一句话理由"
}
要求：
- characterChanges 覆盖受影响的主要角色（2-5个），弧光对比要具体
- plotBranches 按章节推进排列（chapterOffset 为锚点后第几章，从 1 开始），数量 3-6 个
- risks 关注叙事结构风险（弧光断裂、伏笔失效、节奏崩坏、设定矛盾）
- 推演忠于已有设定，不凭空引入未铺垫的重大元素`;

export class WhatIfSimulator {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;

  constructor(
    bridge: NativeBridge,
    db: Database,
    wq: WriteQueue,
    providerFactory: (configId: string) => Promise<LLMProvider>
  ) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.providerFactory = providerFactory;
  }

  /** 推演（非流式，返回完整报告；功能键 whatif；JSON 输出 + 容错解析，解析失败抛错） */
  async simulate(params: WhatIfParams): Promise<WhatIfReport> {
    params.onStage?.('context');

    // ---- 组装上下文 ----
    const chapters = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM chapters WHERE book_id = ? ORDER BY sort_order ASC, created_at ASC',
      [params.bookId]
    );
    if (chapters.length === 0) throw new Error('本书还没有章节，无法推演');

    // 锚点章节（默认最新章）
    const anchor = params.fromChapterId
      ? chapters.find((c) => String(c.id) === params.fromChapterId)
      : chapters[chapters.length - 1];
    if (!anchor) throw new Error('锚点章节不存在');
    const anchorIdx = chapters.indexOf(anchor);

    // 摘要链：锚点及之前的章节摘要（无摘要的章节用标题占位提示）
    const chain = chapters
      .slice(0, anchorIdx + 1)
      .map((c) => {
        const title = String(c.title);
        const summary = (c.summary as string | null)?.trim();
        return summary ? `- ${title}：${summary}` : `- ${title}：（暂无摘要）`;
      })
      .join('\n');

    // 角色卡
    const charRows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM characters WHERE book_id = ? ORDER BY created_at ASC',
      [params.bookId]
    );
    const characters = charRows.map(rowToCharacter);
    const charText = characters
      .map((c) => {
        const brief = this.characterBrief(c.data);
        return `- ID: ${c.id} | 名字: ${c.name}${brief ? ` | ${brief}` : ''}`;
      })
      .join('\n');

    // 世界书（截断长内容）
    const wbRows = await this.db.query<{ title: string; category: string | null; content: string }>(
      'SELECT title, category, content FROM worldbook_entries WHERE book_id = ? ORDER BY created_at ASC LIMIT 30',
      [params.bookId]
    );
    const wbText = wbRows
      .map((r) => `- ${r.title}${r.category ? `（${r.category}）` : ''}：${r.content.slice(0, 120)}`)
      .join('\n');

    params.onStage?.('running');

    // ---- 推演（非流式 chat）----
    const provider = await resolveProviderForFeature(this.bridge, params.bookId, 'whatif', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, params.bookId, 'whatif');

    const userParts = [
      `【假设】${params.hypothesis}`,
      `【锚点章节】${String(anchor.title)}（假设发生在该章之后）`,
      `【推演范围】后续 ${params.range} 章`,
      `【截至锚点的剧情摘要】\n${chain}`
    ];
    if (charText) userParts.push(`【角色列表】\n${charText}`);
    if (wbText) userParts.push(`【世界书设定】\n${wbText}`);
    userParts.push(`请推演该假设对后续 ${params.range} 章剧情的影响，严格按 JSON 对象输出。`);

    const messages: ChatMessage[] = [
      { role: 'system', content: WHATIF_SYSTEM_PROMPT },
      { role: 'user', content: userParts.join('\n\n') }
    ];
    const res = await provider.chat(messages, {
      model,
      temperature: 0.6,
      maxTokens: 4000,
      signal: params.signal
    });

    params.onStage?.('parsing');

    // ---- 解析报告 ----
    const report = this.parseReport(res.content, params, String(anchor.title));
    return report;
  }

  /** 容错解析：剥围栏 -> 提取 JSON 对象 -> 逐字段校验与降级 */
  private parseReport(
    raw: string,
    params: WhatIfParams,
    anchorTitle: string
  ): WhatIfReport {
    let text = raw.trim();
    const fence = text.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
    if (fence) text = fence[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('推演结果无法解析为 JSON，请重试或更换模型');
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        throw new Error('推演结果无法解析为 JSON，请重试或更换模型');
      }
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('推演结果不是 JSON 对象');
    const obj = parsed as Record<string, unknown>;

    const characterChanges = Array.isArray(obj.characterChanges)
      ? obj.characterChanges
          .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
          .map((c) => ({
            characterId: String(c.characterId ?? ''),
            characterName: String(c.characterName ?? '未知角色'),
            originalArc: String(c.originalArc ?? ''),
            modifiedArc: String(c.modifiedArc ?? '')
          }))
          .filter((c) => c.characterName && c.originalArc && c.modifiedArc)
      : [];

    const plotBranches = Array.isArray(obj.plotBranches)
      ? obj.plotBranches
          .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object')
          .map((b) => ({
            chapterOffset: Number(b.chapterOffset) > 0 ? Math.floor(Number(b.chapterOffset)) : 1,
            branchPoint: String(b.branchPoint ?? ''),
            outcome: String(b.outcome ?? '')
          }))
          .filter((b) => b.branchPoint)
      : [];

    const risks = Array.isArray(obj.risks)
      ? obj.risks.map(String).filter(Boolean)
      : [];

    const impactScope = String(obj.impactScope ?? '').trim();
    const recommendation = String(obj.recommendation ?? '').trim();
    if (!impactScope && characterChanges.length === 0 && plotBranches.length === 0) {
      throw new Error('推演结果缺少有效内容，请重试');
    }

    return {
      id: crypto.randomUUID(),
      bookId: params.bookId,
      hypothesis: params.hypothesis,
      range: params.range,
      anchorChapterTitle: anchorTitle,
      impactScope: impactScope || '（未提供）',
      characterChanges,
      plotBranches,
      risks,
      recommendation: recommendation || '（未提供）',
      generatedAt: Date.now()
    };
  }

  /** 保存推演报告到灵感库（inspirations 表 type='whatif_report'，按书绑定） */
  async saveReport(report: WhatIfReport): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO inspirations (id, book_id, type, title, content, tags, source, favorited, metadata, created_at)
         VALUES (?, ?, 'whatif_report', ?, ?, ?, 'ai', 0, ?, ?)`,
        [
          crypto.randomUUID(),
          report.bookId,
          `推演：${report.hypothesis.slice(0, 24)}`,
          JSON.stringify(report),
          JSON.stringify(['推演', `后续${report.range}章`]),
          JSON.stringify({ hypothesis: report.hypothesis, range: report.range }),
          report.generatedAt || Date.now()
        ]
      )
    );
  }

  /** 列出某书的推演历史（时间倒序） */
  async listByBook(bookId: string): Promise<WhatIfReport[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM inspirations WHERE book_id = ? AND type = 'whatif_report' ORDER BY created_at DESC",
      [bookId]
    );
    return rows.map((r) => {
      try {
        return JSON.parse(String(r.content ?? '{}')) as WhatIfReport;
      } catch {
        // 损坏行降级为最小可用报告
        return {
          id: String(r.id),
          bookId,
          hypothesis: String(r.title ?? '').replace(/^推演：/, ''),
          range: 0,
          anchorChapterTitle: '',
          impactScope: '（内容损坏）',
          characterChanges: [],
          plotBranches: [],
          risks: [],
          recommendation: '',
          generatedAt: Number(r.created_at)
        };
      }
    });
  }

  /** 角色卡 JSON -> 一句话简介（性格/背景/动机字段） */
  private characterBrief(dataJson: string): string {
    try {
      const data = JSON.parse(dataJson) as Record<string, unknown>;
      const keys = ['personality', 'background', '动机', '性格', '背景'];
      const parts: string[] = [];
      for (const k of keys) {
        const v = data[k];
        if (typeof v === 'string' && v.trim()) parts.push(v.trim().slice(0, 60));
        if (parts.length >= 2) break;
      }
      return parts.join('；');
    } catch {
      return '';
    }
  }
}
