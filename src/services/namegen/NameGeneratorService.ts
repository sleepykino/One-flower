/**
 * NameGeneratorService：命名生成器（P2）
 * - 按类型（角色/地点/招式/势力）+ 题材批量生成中文名字（LLM，严格 JSON 输出）
 * - 收藏夹持久化（name_favorites 表）
 * - Provider 在服务内部解析（app-context 的 providerFactory 未导出，故按同样方式在私有方法内组装）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider, ChatMessage } from '../ai/providers/LLMProvider';
import { createProvider, isLocalBaseUrl } from '../ai/providers/LLMProvider';
import { resolveProviderConfigIdForFeature } from '../ai/providerResolver';
import type { NameGenParams, GeneratedName, NameFavorite, NameType, Gender } from './types';
import { TYPE_LABEL } from './types';

const NAMEGEN_SYSTEM_PROMPT = `你是中文命名大师，精通各题材小说的角色、地点、招式、势力命名。
按用户要求输出名字列表，严格输出 JSON 数组格式：
[{"name": "名字", "meaning": "含义与寓意说明"}]
- name：名字本身（角色名按姓氏习惯，地点/招式/势力名符合题材气质）
- meaning：一到两句话解释名字的寓意、出处或韵味
不要输出 JSON 之外的任何文字、注释或代码围栏。`;

const GENDER_LABEL: Record<Gender, string> = {
  male: '男性',
  female: '女性',
  neutral: '中性'
};

export class NameGeneratorService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
  }

  /**
   * 按配置 ID 组装 Provider（与 app-context.ts 的 providerFactory 同实现），
   * 同时返回该配置的模型名（chat 的 model 必填）
   */
  private async resolveProvider(
    configId: string
  ): Promise<{ provider: LLMProvider; model: string }> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM provider_configs WHERE id = ?',
      [configId]
    );
    if (!row) throw new Error('模型配置不存在');
    const baseUrl = (row.base_url as string) ?? '';
    const apiKey = (await this.bridge.keyStore.getSecret(`provider_${String(row.id)}`)) ?? '';
    // 本地端点（Ollama 等localhost 服务）允许无 API Key
    if (!apiKey && !isLocalBaseUrl(baseUrl)) {
      throw new Error(`配置「${String(row.name)}」未设置 API Key`);
    }
    const model = String(row.model);
    const provider = createProvider(
      {
        id: String(row.id),
        name: String(row.name),
        provider: String(row.provider),
        baseUrl: (row.base_url as string) ?? undefined,
        model
      },
      apiKey
    );
    return { provider, model };
  }

  /** 组装用户提示词 */
  private buildUserPrompt(params: NameGenParams): string {
    const typeLabel = TYPE_LABEL[params.type];
    const lines = [
      `命名类型：${typeLabel}`,
      `题材风格：${params.genre}`,
      `数量：${params.count} 个`
    ];
    if (params.type === 'character' && params.gender) {
      lines.push(`性别倾向：${GENDER_LABEL[params.gender]}`);
    }
    if (params.hints?.trim()) {
      lines.push(`其他要求：${params.hints.trim()}`);
    }
    lines.push(`请生成 ${params.count} 个${params.genre}题材的${typeLabel}名，严格按 JSON 数组输出。`);
    return lines.join('\n');
  }

  /** 解析模型输出（容错：剥代码围栏、正则提取 JSON 数组、逐项校验 name 字段） */
  private parseNames(raw: string, type: NameType): GeneratedName[] {
    let text = raw.trim();
    const fence = text.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
    if (fence) text = fence[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('模型返回内容无法解析为 JSON 数组');
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        throw new Error('模型返回内容无法解析为 JSON 数组');
      }
    }
    if (!Array.isArray(parsed)) throw new Error('模型返回内容不是 JSON 数组');

    const names: GeneratedName[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name.trim() : '';
      if (!name) continue;
      names.push({
        name,
        meaning: typeof obj.meaning === 'string' ? obj.meaning.trim() : '',
        type
      });
    }
    if (names.length === 0) throw new Error('模型未返回有效的名字列表');
    return names;
  }

  /** 批量生成名字 */
  async generate(bookId: string, params: NameGenParams): Promise<GeneratedName[]> {
    // P2 二期：命名生成走 'namegen' 功能点路由
    const configId = await resolveProviderConfigIdForFeature(this.bridge, bookId, 'namegen');
    if (!configId) throw new Error('未配置任何模型，请先到设置页添加 Provider 配置');
    const { provider, model } = await this.resolveProvider(configId);

    const messages: ChatMessage[] = [
      { role: 'system', content: NAMEGEN_SYSTEM_PROMPT },
      { role: 'user', content: this.buildUserPrompt(params) }
    ];

    const res = await provider.chat(messages, {
      model,
      temperature: 0.9,
      maxTokens: 2000
    });
    return this.parseNames(res.content, params.type);
  }

  /** 收藏名字 */
  async saveFavorite(bookId: string, item: GeneratedName, genre: string | null): Promise<void> {
    const id = crypto.randomUUID();
    await this.wq.enqueue(() =>
      this.db.exec(
        'INSERT INTO name_favorites (id, book_id, name, meaning, type, genre, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, bookId, item.name, item.meaning, item.type, genre, Date.now()]
      )
    );
  }

  /** 收藏夹列表（按收藏时间倒序） */
  async listFavorites(bookId: string): Promise<NameFavorite[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM name_favorites WHERE book_id = ? ORDER BY created_at DESC',
      [bookId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      meaning: (r.meaning as string) ?? '',
      type: r.type as NameType,
      genre: (r.genre as string) ?? null,
      createdAt: Number(r.created_at)
    }));
  }

  /** 取消收藏 */
  async removeFavorite(id: string): Promise<void> {
    await this.wq.enqueue(() => this.db.exec('DELETE FROM name_favorites WHERE id = ?', [id]));
  }
}
