/**
 * StorySeedService（P2.1-B M1）：故事种子生成器
 * - 题材 + 元素组合 + 语气 + 数量 -> AI 生成故事钩子（JSON 数组 + 容错解析）
 * - 存入灵感库（inspirations 表 type='seed'，book_id 为 NULL 全局共享）
 * - 从种子创建新书：建书（复用 BookService）+ 种子内容写入新书世界书（分类"故事种子"）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider, ChatMessage } from '../ai/providers/LLMProvider';
import { resolveProviderForFeature, resolveModelNameForFeature } from '../ai/providerResolver';
import type { BookService } from '../book/BookService';
import type { WorldbookRAGService } from '../worldbook/WorldbookRAGService';
import type { StorySeed, SeedGenParams, RandomSeedParams } from './types';

const SEED_SYSTEM_PROMPT = `你是资深故事策划与创意顾问，精通各题材的小说创意孵化。
根据用户给定的题材、元素组合与语气，生成有商业潜力与文学深度的故事种子。
严格输出 JSON 数组格式（不要 markdown 代码围栏、不要任何解释）：
[
  {
    "title": "种子标题（2-8字，如：轮回剑客）",
    "logline": "一句话钩子（30字内，制造核心悬念）",
    "expansion": "3-5句话的故事扩展，交代设定、主角处境与核心张力",
    "conflictPoints": ["关键冲突点1", "关键冲突点2", "关键冲突点3"],
    "possibleEndings": ["结局方向1", "结局方向2"]
  }
]
要求：
- 每个种子都要把给定元素有机融合进故事逻辑，而不是简单堆砌
- 冲突点 2-4 条，具体可写；结局方向 2-3 条，方向差异明显
- 标题凝练有记忆点，logline 有悬念钩子
- 避开高频套路：核心创意不要依赖时空穿越、时间循环、重生、系统金手指等常见梗
- 若用户消息给出「已探索方向」，生成的种子必须避开这些条目的核心设定`;

const RANDOM_SYSTEM_PROMPT = `你是小说创意策划。请随机给出一组故事种子的生成参数：一个题材 + 三个元素组合。
严格输出 JSON 对象（不要 markdown 代码围栏、不要任何解释）：
{
  "genre": "题材（2-6字）",
  "elements": ["元素1", "元素2", "元素3"],
  "reason": "一句话说明这组搭配的火花（30字内）"
}
要求：
- 元素取材于具体的人/物/场景/事件（职业、地点、旧物、悬案、行当等），每个 2-8 字
- 三个元素至少一个制造反差或冲突；避免同义重复（不要给"复仇+报仇+仇恨"）
- 不要输出时空穿越、时间循环、重生、系统流等高频套路设定`;

/** 骰子本地发散提示：每次注入随机参考项，强制偏离模型默认输出分布 */
const RANDOM_HINTS = [
  '市井烟火', '手艺传承', '边疆戍堡', '深海渔村', '旧书店', '铁路小站', '戏班后台',
  '荒漠绿洲', '雪山驿站', '江南梅雨', '工厂家属院', '深夜食堂', '古籍修复',
  '气象观测站', '渡口码头', '山村小学', '老式理发店', '长途客运'
];
const RANDOM_TWISTS = [
  '身份错位', '一桩旧案', '意外的遗产', '失而复得的手艺', '两代人的隔阂',
  '一场误会的代价', '一份迟到的信', '被掩盖的善意的谎言'
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const TONE_LABEL: Record<string, string> = {
  serious: '严肃正剧',
  absurd: '荒诞黑色幽默',
  warm: '温暖治愈',
  dark: '黑暗深沉'
};

/** inspiration 行 -> StorySeed */
function rowToSeed(r: Record<string, unknown>): StorySeed {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(String(r.content ?? '{}')) as Record<string, unknown>;
  } catch {
    /* 损坏行降级为空对象 */
  }
  return {
    id: String(r.id),
    title: String(parsed.title ?? r.title ?? '未命名种子'),
    logline: String(parsed.logline ?? ''),
    expansion: String(parsed.expansion ?? ''),
    conflictPoints: Array.isArray(parsed.conflictPoints)
      ? parsed.conflictPoints.map(String)
      : [],
    possibleEndings: Array.isArray(parsed.possibleEndings)
      ? parsed.possibleEndings.map(String)
      : [],
    genre: String(parsed.genre ?? ''),
    elements: Array.isArray(parsed.elements) ? parsed.elements.map(String) : [],
    tone: String(parsed.tone ?? 'serious'),
    createdAt: Number(r.created_at),
    favorited: Number(r.favorited) === 1
  };
}

export class StorySeedService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private bookService: BookService;
  private ragService: WorldbookRAGService;

  constructor(
    bridge: NativeBridge,
    db: Database,
    wq: WriteQueue,
    providerFactory: (configId: string) => Promise<LLMProvider>,
    bookService: BookService,
    ragService: WorldbookRAGService
  ) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.providerFactory = providerFactory;
    this.bookService = bookService;
    this.ragService = ragService;
  }

  /** 生成故事种子（功能键 seed-gen；JSON 数组输出 + 容错解析，解析失败抛错不静默） */
  async generate(params: SeedGenParams): Promise<StorySeed[]> {
    const provider = await resolveProviderForFeature(this.bridge, '', 'seed-gen', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, '', 'seed-gen');

    const tone = params.tone ?? 'serious';
    const lines = [
      `题材：${params.genre}`,
      `元素组合：${params.elements.join(' + ')}`,
      `语气基调：${TONE_LABEL[tone] ?? tone}`,
      `生成数量：${params.count} 个`
    ];
    if (params.hints?.trim()) {
      lines.push(`其他要求：${params.hints.trim()}`);
    }
    // 注入最近已生成的种子方向：让模型主动避开重复套路
    try {
      const rows = await this.db.query<{ title: string; content: string }>(
        "SELECT title, content FROM inspirations WHERE type = 'seed' ORDER BY created_at DESC LIMIT 8"
      );
      const recentLines: string[] = [];
      for (const r of rows) {
        let logline = '';
        try {
          logline = String((JSON.parse(r.content) as { logline?: unknown }).logline ?? '');
        } catch {
          /* 损坏行跳过 logline */
        }
        if (r.title) recentLines.push(`-《${r.title}》${logline}`);
      }
      if (recentLines.length > 0) {
        lines.push('已探索方向（新种子的核心创意须避开以下条目的设定）：', ...recentLines);
      }
    } catch {
      /* 历史读取失败不影响生成 */
    }
    lines.push(`请生成 ${params.count} 个故事种子，严格按 JSON 数组输出。`);

    const messages: ChatMessage[] = [
      { role: 'system', content: SEED_SYSTEM_PROMPT },
      { role: 'user', content: lines.join('\n') }
    ];

    const res = await provider.chat(messages, {
      model,
      temperature: 0.95,
      maxTokens: Math.min(params.count * 600, 6000),
      signal: params.signal
    });
    return this.parseSeeds(res.content, params);
  }

  /**
   * 随机生成参数（骰子按钮）：AI 提供随机题材 + 元素组合 + 搭配理由
   * 功能键同 seed-gen；每次注入本地随机发散参考项，避免模型输出分布固化；解析失败抛错
   */
  async randomize(signal?: AbortSignal): Promise<RandomSeedParams> {
    const provider = await resolveProviderForFeature(this.bridge, '', 'seed-gen', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, '', 'seed-gen');

    const hintA = pick(RANDOM_HINTS);
    const hintB = pick(RANDOM_HINTS.filter((h) => h !== hintA));
    const twist = pick(RANDOM_TWISTS);
    const res = await provider.chat(
      [
        { role: 'system', content: RANDOM_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `请随机给出一组题材与元素组合。本次发散参考（尽量围绕，可自由发挥）：「${hintA}」「${hintB}」，并带一点「${twist}」。严格按 JSON 对象输出。`
        }
      ],
      { model, temperature: 1.1, maxTokens: 400, signal }
    );
    return this.parseRandomParams(res.content);
  }

  /** 随机参数容错解析 */
  private parseRandomParams(raw: string): RandomSeedParams {
    let text = raw.trim();
    const fence = text.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
    if (fence) text = fence[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('随机结果无法解析，请重试');
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        throw new Error('随机结果无法解析，请重试');
      }
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('随机结果不是 JSON 对象');
    const obj = parsed as Record<string, unknown>;

    const genre = typeof obj.genre === 'string' ? obj.genre.trim() : '';
    const elements = Array.isArray(obj.elements)
      ? obj.elements.map((e) => String(e).trim()).filter(Boolean)
      : [];
    if (!genre || elements.length === 0) {
      throw new Error('随机结果缺少题材或元素，请重试');
    }
    return {
      genre,
      elements,
      reason: typeof obj.reason === 'string' ? obj.reason.trim() : ''
    };
  }

  /** 容错解析：剥代码围栏 -> 正则提取 JSON 数组 -> 逐项校验 */
  private parseSeeds(raw: string, params: SeedGenParams): StorySeed[] {
    let text = raw.trim();
    const fence = text.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
    if (fence) text = fence[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('模型返回内容无法解析为 JSON 数组，请重试或更换模型');
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        throw new Error('模型返回内容无法解析为 JSON 数组，请重试或更换模型');
      }
    }
    if (!Array.isArray(parsed)) throw new Error('模型返回内容不是 JSON 数组');

    const seeds: StorySeed[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const title = typeof obj.title === 'string' ? obj.title.trim() : '';
      const logline = typeof obj.logline === 'string' ? obj.logline.trim() : '';
      if (!title || !logline) continue;
      seeds.push({
        id: crypto.randomUUID(),
        title,
        logline,
        expansion: typeof obj.expansion === 'string' ? obj.expansion.trim() : '',
        conflictPoints: Array.isArray(obj.conflictPoints) ? obj.conflictPoints.map(String) : [],
        possibleEndings: Array.isArray(obj.possibleEndings) ? obj.possibleEndings.map(String) : [],
        genre: params.genre,
        elements: params.elements,
        tone: params.tone ?? 'serious',
        createdAt: Date.now(),
        favorited: false
      });
    }
    if (seeds.length === 0) throw new Error('模型未返回有效的故事种子，请重试');
    return seeds;
  }

  /** 存入灵感库（inspirations 表 type='seed'，book_id 为 NULL 全局共享） */
  async saveToInspirations(seed: StorySeed): Promise<string> {
    const id = crypto.randomUUID();
    const content = JSON.stringify({
      title: seed.title,
      logline: seed.logline,
      expansion: seed.expansion,
      conflictPoints: seed.conflictPoints,
      possibleEndings: seed.possibleEndings,
      genre: seed.genre,
      elements: seed.elements,
      tone: seed.tone
    });
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO inspirations (id, book_id, type, title, content, tags, source, favorited, metadata, created_at)
         VALUES (?, NULL, 'seed', ?, ?, ?, 'ai', 1, ?, ?)`,
        [
          id,
          seed.title,
          content,
          JSON.stringify([seed.genre, ...seed.elements]),
          JSON.stringify({ genre: seed.genre, elements: seed.elements, tone: seed.tone }),
          Date.now()
        ]
      )
    );
    return id;
  }

  /** 列出灵感库中的种子（按收藏优先 + 时间倒序） */
  async listInspirations(): Promise<StorySeed[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM inspirations WHERE type = 'seed' ORDER BY favorited DESC, created_at DESC"
    );
    return rows.map(rowToSeed);
  }

  /** 按 id 取单个种子（从灵感库） */
  async getSeed(seedId: string): Promise<StorySeed | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      "SELECT * FROM inspirations WHERE id = ? AND type = 'seed'",
      [seedId]
    );
    return row ? rowToSeed(row) : null;
  }

  /**
   * 从种子创建新书：确认由 UI 弹窗完成 -> 建书（复用 BookService）
   * -> 种子内容写入新书世界书（分类"故事种子"，AI 上下文立即可用）
   * @param seedOrId 灵感库种子 id，或生成结果中的种子对象（未入库）
   * @param input 书名/类型覆盖（UI 确认框中可编辑，默认取种子）
   */
  async createBookFromSeed(
    seedOrId: string | StorySeed,
    input?: { title?: string; genre?: string }
  ): Promise<string> {
    const seed =
      typeof seedOrId === 'string' ? await this.getSeed(seedOrId) : seedOrId;
    if (!seed) throw new Error('种子不存在或已被删除');

    // 建书
    const book = await this.bookService.create({
      title: input?.title?.trim() || seed.title,
      genre: input?.genre?.trim() || seed.genre || null
    });

    // 种子内容写入新书世界书（分类"故事种子"）
    const content = [
      `【一句话钩子】${seed.logline}`,
      `【故事扩展】${seed.expansion}`,
      seed.conflictPoints.length > 0
        ? `【关键冲突】\n${seed.conflictPoints.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
        : '',
      seed.possibleEndings.length > 0
        ? `【潜在结局】\n${seed.possibleEndings.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
        : '',
      `【元素】${seed.elements.join(' / ')}`
    ]
      .filter(Boolean)
      .join('\n\n');
    const entryId = crypto.randomUUID();
    const now = Date.now();
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO worldbook_entries (id, book_id, title, category, content, tags, created_at, updated_at)
         VALUES (?, ?, ?, '故事种子', ?, ?, ?, ?)`,
        [
          entryId,
          book.id,
          `故事种子：${seed.title}`,
          content,
          JSON.stringify(['种子', seed.genre, ...seed.elements]),
          now,
          now
        ]
      )
    );
    // 尝试向量化（失败静默，不阻塞建书流程；未配置嵌入模型时 RAG 检索跳过该条目）
    void this.ragService.embedEntry(entryId).catch(() => undefined);
    return book.id;
  }

  /** 收藏/取消收藏 */
  async toggleFavorite(seedId: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec(
        'UPDATE inspirations SET favorited = CASE WHEN favorited = 1 THEN 0 ELSE 1 END WHERE id = ?',
        [seedId]
      )
    );
  }
}
