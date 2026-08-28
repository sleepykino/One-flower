/**
 * UsageService（G4）：AI 用量流水与累计统计
 * - record：INSERT 走 WriteQueue 串行写，调用方 fire-and-forget，不影响生成主路径
 * - 记账范围：对话类 LLM 调用（chat / stream）。嵌入（embed）与生图不在账内（另一成本模型）
 * - stream 无 API usage：按字符估算（countTokens，中英文区分口径），estimated=1 标记
 * - createRecordingProvider：Provider 装饰器——在 resolveProviderForFeature / Orchestrator
 *   统一包裹，功能路由的所有调用点透明入账（书 / 功能点 / 配置 / 模型维度）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { AppSettingsService } from '../settings/AppSettingsService';
import type { ChatMessage, LLMProvider } from '../ai/providers/LLMProvider';
import { countTokens } from '../../utils/tokens';

/** 保留期设置键（天；0 = 永久保留） */
const RETENTION_KEY = 'usage.retentionDays';
/** 累计锚点：被清理明细的 token 合计并入此键，保证「累计」不随清理缩水 */
const PRUNED_BASELINE_KEY = 'usage.prunedTokens';
/** 保留期默认值（天） */
const DEFAULT_RETENTION_DAYS = 90;

export interface UsageEntry {
  bookId?: string | null;
  feature: string;
  configId?: string | null;
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

export interface UsageDayPoint {
  day: string; // YYYY-MM-DD（本地时区）
  tokens: number;
  calls: number;
}

export interface UsageGroupRow {
  key: string;
  title: string;
  tokens: number;
  calls: number;
}

export interface UsageTotals {
  today: number;
  week: number;
  total: number;
  calls: number;
}

export class UsageService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private settings: AppSettingsService;
  private recheckTimer: number | null = null;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue, settings: AppSettingsService) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.settings = settings;
  }

  /** 记账一条流水（失败仅告警，绝不影响生成主路径） */
  async record(entry: UsageEntry): Promise<void> {
    try {
      await this.wq.enqueue(() =>
        this.db.exec(
          `INSERT INTO ai_usage (ts, book_id, feature, config_id, model, prompt_tokens, completion_tokens, estimated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            Date.now(),
            entry.bookId ?? null,
            entry.feature,
            entry.configId ?? null,
            entry.model ?? null,
            Math.max(0, Math.round(entry.promptTokens)),
            Math.max(0, Math.round(entry.completionTokens)),
            entry.estimated ? 1 : 0
          ]
        )
      );
    } catch (e) {
      console.warn('[Usage] 写入用量流水失败，已跳过:', e);
    }
  }

  /** 汇总：今日 / 近 7 天 / 累计（合计 token = prompt + completion + 已清理锚点） */
  async totals(): Promise<UsageTotals> {
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const [all, today, week, pruned] = await Promise.all([
      this.db.queryOne<{ t: number; c: number }>(
        'SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t, COUNT(*) AS c FROM ai_usage'
      ),
      this.db.queryOne<{ t: number }>(
        'SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM ai_usage WHERE ts >= ?',
        [startOfDay]
      ),
      this.db.queryOne<{ t: number }>(
        'SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM ai_usage WHERE ts >= ?',
        [weekAgo]
      ),
      this.settings.get(PRUNED_BASELINE_KEY)
    ]);
    return {
      today: Number(today?.t ?? 0),
      week: Number(week?.t ?? 0),
      total: Number(all?.t ?? 0) + Number(pruned ?? 0),
      calls: Number(all?.c ?? 0)
    };
  }

  /** 近 N 天逐日合计（含空白天补齐，便于画柱状图） */
  async byDay(days = 14): Promise<UsageDayPoint[]> {
    const since = Date.now() - (days - 1) * 24 * 3600 * 1000;
    const startOfDay = new Date(since).setHours(0, 0, 0, 0);
    const rows = await this.db.query<{ d: string; t: number; c: number }>(
      `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS d,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t,
              COUNT(*) AS c
       FROM ai_usage WHERE ts >= ? GROUP BY d ORDER BY d ASC`,
      [startOfDay]
    );
    const map = new Map(rows.map((r) => [String(r.d), { tokens: Number(r.t), calls: Number(r.c) }]));
    const out: UsageDayPoint[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startOfDay + i * 24 * 3600 * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const hit = map.get(key);
      out.push({ day: key, tokens: hit?.tokens ?? 0, calls: hit?.calls ?? 0 });
    }
    return out;
  }

  /** 按功能点分组 */
  async byFeature(): Promise<UsageGroupRow[]> {
    const rows = await this.db.query<{ key: string; t: number; c: number }>(
      `SELECT feature AS key, COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t, COUNT(*) AS c
       FROM ai_usage GROUP BY feature ORDER BY t DESC`
    );
    return rows.map((r) => ({ key: String(r.key), title: String(r.key), tokens: Number(r.t), calls: Number(r.c) }));
  }

  /** 按书分组（已删除书显示占位名） */
  async byBook(limit = 10): Promise<UsageGroupRow[]> {
    const rows = await this.db.query<{ key: string | null; title: string | null; t: number; c: number }>(
      `SELECT ai_usage.book_id AS key,
              COALESCE(books.title, '已删除书籍') AS title,
              COALESCE(SUM(ai_usage.prompt_tokens + ai_usage.completion_tokens), 0) AS t,
              COUNT(*) AS c
       FROM ai_usage LEFT JOIN books ON books.id = ai_usage.book_id
       GROUP BY ai_usage.book_id ORDER BY t DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => ({ key: String(r.key ?? ''), title: String(r.title ?? '无书上下文'), tokens: Number(r.t), calls: Number(r.c) }));
  }

  // ---------------- 保留期与清理（防流水表无限增长） ----------------

  /** 保留期（天）：0 = 永久保留；未配置或非法值回退默认 90 天 */
  async getRetentionDays(): Promise<number> {
    const v = await this.settings.get(RETENTION_KEY);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
  }

  async setRetentionDays(days: number): Promise<void> {
    await this.settings.set(RETENTION_KEY, String(Math.max(0, Math.floor(days))));
  }

  /**
   * 清理保留期之前的明细：被删行的 token 合计并入累计锚点（usage.prunedTokens），
   * 保证「累计」卡片不随清理缩水。DELETE 与锚点更新分两步（锚点更新含 enqueue，
   * 不能在队列任务内嵌套调用——见优化建议批次1-6 事务内 enqueue 纪律）。
   */
  async prune(retentionDays: number): Promise<{ deleted: number; tokens: number }> {
    if (retentionDays <= 0) return { deleted: 0, tokens: 0 }; // 永久保留
    const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
    return this.pruneBefore(cutoff);
  }

  /** 清空全部明细（token 合计同样并入累计锚点） */
  async clearAll(): Promise<{ deleted: number; tokens: number }> {
    return this.pruneBefore(Date.now() + 60_000);
  }

  private async pruneBefore(cutoff: number): Promise<{ deleted: number; tokens: number }> {
    const { deleted, tokens } = await this.wq.enqueue(async () => {
      const sum = await this.db.queryOne<{ c: number; t: number }>(
        'SELECT COUNT(*) AS c, COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM ai_usage WHERE ts < ?',
        [cutoff]
      );
      const count = Number(sum?.c ?? 0);
      const sumTokens = Number(sum?.t ?? 0);
      if (count === 0) return { deleted: 0, tokens: 0 };
      await this.db.exec('DELETE FROM ai_usage WHERE ts < ?', [cutoff]);
      return { deleted: count, tokens: sumTokens };
    });
    if (tokens > 0) {
      // 基线读改写在队列外：调度器与手动按钮实际不会并发，且新写入行 ts 恒大于 cutoff，无重复计入
      const prev = Number((await this.settings.get(PRUNED_BASELINE_KEY)) ?? 0);
      await this.settings.set(PRUNED_BASELINE_KEY, String(prev + tokens));
    }
    return { deleted, tokens };
  }

  /** 启动调度：延迟首检 + 每 6 小时重检（幂等；保留期 0 = 永久时自动跳过） */
  startScheduler(): void {
    if (this.recheckTimer !== null) return;
    const PRUNE_FIRST_DELAY_MS = 15_000;
    const PRUNE_RECHECK_MS = 6 * 3600 * 1000;
    const run = async (): Promise<void> => {
      try {
        const days = await this.getRetentionDays();
        if (days > 0) await this.prune(days);
      } catch (e) {
        console.warn('[Usage] 保留期清理失败，已跳过:', e);
      }
    };
    window.setTimeout(() => void run(), PRUNE_FIRST_DELAY_MS);
    this.recheckTimer = window.setInterval(() => void run(), PRUNE_RECHECK_MS);
  }
}

// ---------------- 共享单例（providerResolver 装饰器取用） ----------------

let sharedUsageService: UsageService | null = null;

/** app-context 装配时注入；null = 不记账（单测 / 未装配） */
export function setSharedUsageService(s: UsageService | null): void {
  sharedUsageService = s;
}

export function getSharedUsageService(): UsageService | null {
  return sharedUsageService;
}

export interface UsageCallContext {
  bookId: string | null;
  feature: string;
  configId: string | null;
}

/**
 * Provider 记账装饰器：chat 取 API usage（缺失时估算），stream 按字符估算；
 * 嵌入与生图不入账。记账 fire-and-forget，失败仅告警。
 */
export function createRecordingProvider(raw: LLMProvider, ctx: UsageCallContext, service: UsageService): LLMProvider {
  const record = (messages: ChatMessage[], completion: string, apiUsage?: { promptTokens: number; completionTokens: number } | null, model?: string): void => {
    void service
      .record((() => {
        const promptEst = messages.reduce((n, m) => n + countTokens(m.content), 0);
        const completionEst = countTokens(completion);
        const hasApi = !!apiUsage && (apiUsage.promptTokens > 0 || apiUsage.completionTokens > 0);
        return {
          bookId: ctx.bookId,
          feature: ctx.feature,
          configId: ctx.configId,
          model: model ?? null,
          promptTokens: hasApi ? apiUsage.promptTokens : promptEst,
          completionTokens: hasApi ? apiUsage.completionTokens : completionEst,
          estimated: !hasApi
        };
      })())
      .catch((e) => console.warn('[Usage] 记账失败，已跳过:', e));
  };

  return {
    name: raw.name,
    countTokens: (text: string) => raw.countTokens(text),
    embed: raw.embed ? (texts, model) => raw.embed!(texts, model) : undefined,
    chat: async (messages, options) => {
      const res = await raw.chat(messages, options);
      record(messages, res.content, res.usage, options.model);
      return res;
    },
    stream: async function* (messages, options) {
      let out = '';
      for await (const chunk of raw.stream(messages, options)) {
        out += chunk.delta;
        yield chunk;
      }
      // 流式响应无 API usage：按字符估算（estimated=1）
      record(messages, out, null, options.model);
    }
  };
}
