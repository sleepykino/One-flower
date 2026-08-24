/**
 * DailyInspirationService（P2.1-B M2）：每日灵感卡片
 * - 卡片全部 AI 生成（功能键 card-gen），仅 1 张内置默认卡兜底
 * - 今日卡片与屏蔽类型存 app_settings（dailyCard.today / dailyCard.blockedTypes），不建独立表
 * - 收藏写入 inspirations 表（type='card'，全局共享）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider, ChatMessage } from '../ai/providers/LLMProvider';
import { resolveProviderForFeature, resolveModelNameForFeature } from '../ai/providerResolver';
import type { AppSettingsService } from '../settings/AppSettingsService';
import type { CardType, InspirationCard } from './types';
import { CARD_TYPE_LABEL } from './types';
import { DEFAULT_CARD } from './default-card';

const KEY_TODAY = 'dailyCard.today';
const KEY_BLOCKED = 'dailyCard.blockedTypes';

/** 书籍类型之外的题材池：每日卡缺省题材的发散来源（避免单本书书架把题材锁死） */
const TOPIC_POOL = [
  '科幻', '悬疑', '都市', '历史', '奇幻', '乡土', '废土', '蒸汽朋克',
  '志怪', '武侠', '谍战', '美食', '体育竞技', '民国传奇', '太空歌剧'
];

/** app_settings dailyCard.today 存储结构 */
interface DailyCardState {
  date: string; // YYYY-MM-DD（本地时区）
  card: InspirationCard;
}

const CARD_SYSTEM_PROMPT = `你是资深写作教练，为小说作者提供每日灵感卡片。
根据用户给定的题材提示，生成一张灵感卡片。严格输出 JSON 对象（不要 markdown 代码围栏、不要任何解释）：
{
  "type": "卡片类型（从下方可选类型中选择一种）",
  "title": "卡片标题（10字内）",
  "content": "卡片正文，Markdown 格式，150-400字。要有具体的示例或可操作的方法，不要空洞说教",
  "tags": ["标签1", "标签2"]
}
可选类型（只能从中选择）：
- technique：写作技法（具体可练的技巧，附小示例）
- scene_example：场景范例（某一类经典场景的写法拆解，如雨夜追踪、酒馆初遇）
- character_angle：人物刻画角度（冷门但有效的人物塑造切入点）
- narrative：叙事手法（结构/节奏/视角等叙事技巧）
- opening：经典开头（一类吸引人的开头写法，附范例）
- quote：写作格言（一句凝练的写作箴言，附一句阐释）
要求：内容具体、有干货、贴合题材提示（若给了题材）。`;

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** inspirations 行 -> InspirationCard */
function rowToCard(r: Record<string, unknown>): InspirationCard {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(String(r.content ?? '{}')) as Record<string, unknown>;
  } catch {
    /* 损坏行降级 */
  }
  return {
    id: String(r.id),
    type: (parsed.type as CardType) ?? 'quote',
    title: String(parsed.title ?? r.title ?? ''),
    content: String(parsed.content ?? ''),
    source: (String(r.source ?? 'ai') as 'builtin' | 'ai') ?? 'ai',
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    createdAt: Number(r.created_at),
    favorited: Number(r.favorited) === 1
  };
}

export class DailyInspirationService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private settings: AppSettingsService;

  constructor(
    bridge: NativeBridge,
    db: Database,
    wq: WriteQueue,
    providerFactory: (configId: string) => Promise<LLMProvider>,
    settings: AppSettingsService
  ) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.providerFactory = providerFactory;
    this.settings = settings;
  }

  /**
   * 今日卡片：当天已生成（app_settings dailyCard.today）则返回该卡，
   * 否则返回默认兜底卡（不触发 AI 调用）
   */
  async getToday(): Promise<InspirationCard> {
    const raw = await this.settings.get(KEY_TODAY);
    if (raw) {
      try {
        const state = JSON.parse(raw) as DailyCardState;
        if (state.date === todayStr() && state.card?.content) {
          return state.card;
        }
      } catch {
        /* 损坏则回退默认卡 */
      }
    }
    return { ...DEFAULT_CARD };
  }

  /** 今日卡片是否已生成（入口条状态标记用） */
  async hasToday(): Promise<boolean> {
    const raw = await this.settings.get(KEY_TODAY);
    if (!raw) return false;
    try {
      const state = JSON.parse(raw) as DailyCardState;
      return state.date === todayStr() && Boolean(state.card?.content);
    } catch {
      return false;
    }
  }

  /**
   * AI 生成今日卡片（功能键 card-gen；显式调用）
   * topic 缺省时：50% 取最近更新书籍的类型、50% 从内置题材池随机（randomTopic=true 则强制随机），
   * 避免单本书书架把题材锁死；卡片带 themeSource 来源标注；屏蔽类型生效；当日重复调用替换旧卡
   */
  async generateToday(
    topic?: string,
    opts?: { randomTopic?: boolean; signal?: AbortSignal }
  ): Promise<InspirationCard> {
    let theme = topic?.trim() ?? '';
    let themeSource = theme ? '自定义题材' : '';
    if (!theme) {
      const row = await this.db.queryOne<{ title: string; genre: string | null }>(
        'SELECT title, genre FROM books ORDER BY updated_at DESC LIMIT 1'
      );
      const bookGenre = row?.genre?.trim() ?? '';
      const useBookGenre = !opts?.randomTopic && bookGenre !== '' && Math.random() < 0.5;
      if (useBookGenre) {
        theme = bookGenre;
        themeSource = `取自《${String(row!.title)}》`;
      } else {
        // 从池中随机，优先避开书籍类型（保持发散）
        const pool = TOPIC_POOL.filter((t) => t !== bookGenre);
        theme = pool[Math.floor(Math.random() * pool.length)] ?? '科幻';
        themeSource = '随机题材';
      }
    }

    const blocked = await this.getBlockedTypes();
    const blockedLabels = blocked.map((t) => CARD_TYPE_LABEL[t]).filter(Boolean);

    const lines: string[] = [];
    if (theme) lines.push(`题材提示：${theme}（卡片示例与方法请贴合该题材）`);
    if (blockedLabels.length > 0) {
      lines.push(`不要生成以下类型（用户已屏蔽）：${blockedLabels.join('、')}`);
    }
    lines.push('请生成一张灵感卡片，严格按 JSON 对象输出。');

    const provider = await resolveProviderForFeature(this.bridge, '', 'card-gen', this.providerFactory);
    const model = await resolveModelNameForFeature(this.bridge, '', 'card-gen');
    const messages: ChatMessage[] = [
      { role: 'system', content: CARD_SYSTEM_PROMPT },
      { role: 'user', content: lines.join('\n') }
    ];
    const res = await provider.chat(messages, {
      model,
      temperature: 0.9,
      maxTokens: 1500,
      signal: opts?.signal
    });
    const card = this.parseCard(res.content);
    card.themeSource = themeSource;

    // 当日重复调用替换旧卡
    const state: DailyCardState = { date: todayStr(), card };
    await this.settings.set(KEY_TODAY, JSON.stringify(state));
    return card;
  }

  /** 容错解析：剥围栏 -> 提取 JSON 对象 -> 校验字段 */
  private parseCard(raw: string): InspirationCard {
    let text = raw.trim();
    const fence = text.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
    if (fence) text = fence[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('模型返回内容无法解析为 JSON 对象，请重试');
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        throw new Error('模型返回内容无法解析为 JSON 对象，请重试');
      }
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('模型返回内容不是 JSON 对象');
    const obj = parsed as Record<string, unknown>;

    const type = (
      typeof obj.type === 'string' && obj.type in CARD_TYPE_LABEL ? obj.type : 'technique'
    ) as CardType;
    const content = typeof obj.content === 'string' ? obj.content.trim() : '';
    if (!content) throw new Error('模型未返回卡片正文，请重试');

    return {
      id: crypto.randomUUID(),
      type,
      title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : CARD_TYPE_LABEL[type],
      content,
      source: 'ai',
      tags: Array.isArray(obj.tags) ? obj.tags.map(String).filter(Boolean) : [],
      createdAt: Date.now(),
      favorited: false
    };
  }

  /** 收藏：写入 inspirations 表（type='card'，全局共享） */
  async favorite(card: InspirationCard): Promise<void> {
    const id = crypto.randomUUID();
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO inspirations (id, book_id, type, title, content, tags, source, favorited, metadata, created_at)
         VALUES (?, NULL, 'card', ?, ?, ?, ?, 1, NULL, ?)`,
        [
          id,
          card.title,
          JSON.stringify({
            type: card.type,
            title: card.title,
            content: card.content,
            tags: card.tags
          }),
          JSON.stringify(card.tags),
          card.source,
          card.createdAt || Date.now()
        ]
      )
    );
  }

  /** 列出收藏的卡片（按时间倒序） */
  async listFavorites(): Promise<InspirationCard[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM inspirations WHERE type = 'card' ORDER BY created_at DESC"
    );
    return rows.map(rowToCard);
  }

  /** 不再推荐某类卡片（app_settings dailyCard.blockedTypes） */
  async blockType(type: CardType): Promise<void> {
    const blocked = await this.getBlockedTypes();
    if (!blocked.includes(type)) {
      blocked.push(type);
      await this.settings.set(KEY_BLOCKED, JSON.stringify(blocked));
    }
  }

  /** 取消屏蔽某类卡片 */
  async unblockType(type: CardType): Promise<void> {
    const blocked = (await this.getBlockedTypes()).filter((t) => t !== type);
    await this.settings.set(KEY_BLOCKED, JSON.stringify(blocked));
  }

  getBlockedTypes(): Promise<CardType[]> {
    return this.settings
      .get(KEY_BLOCKED)
      .then((raw) => {
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return [];
          return parsed.filter(
            (t): t is CardType => typeof t === 'string' && t in CARD_TYPE_LABEL
          );
        } catch {
          return [];
        }
      });
  }
}
