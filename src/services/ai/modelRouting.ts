/**
 * AI 模型分工（P2 二期）：按功能点路由到不同 Provider 配置，控制成本与质量
 * 存储 app_settings key 'ai.featureModels'：{ [featureKey]: configId }
 * 向量嵌入沿用旧 key（embedding.providerConfigId / embedding.model），仅 UI 并入统一表格
 */

import type { AppSettingsService } from '../settings/AppSettingsService';

export type FeatureKey =
  | 'continue'
  | 'rewrite'
  | 'dialogue'
  | 'check'
  | 'typo-check'
  | 'longform-draft'
  | 'longform-seam'
  | 'fact-extract'
  | 'inference'
  | 'baseline-check'
  | 'summary'
  | 'namegen'
  | 'map'
  | 'embedding';

export type FeatureGroup = 'generate' | 'review' | 'assist' | 'vector';

export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  desc: string;
  group: FeatureGroup;
}

export const FEATURE_GROUPS: Array<{ key: FeatureGroup; label: string; desc: string }> = [
  { key: 'generate', label: '生成（影响正文质量）', desc: '建议使用强模型' },
  { key: 'review', label: '规划与校验', desc: '中频任务，中档模型即可' },
  { key: 'assist', label: '后台辅助（量大）', desc: '每章自动运行，建议弱模型省钱' },
  { key: 'vector', label: '向量', desc: '世界书与章节片段向量化检索' }
];

export const AI_FEATURES: FeatureMeta[] = [
  { key: 'continue', label: '续写', desc: '长文模式正文生成同此配置', group: 'generate' },
  { key: 'rewrite', label: '改写', desc: '选中段落按指令改写', group: 'generate' },
  { key: 'dialogue', label: '对白', desc: '场景对白生成', group: 'generate' },
  { key: 'check', label: '一致性检查', desc: '角色卡/世界书/时代感基线比对', group: 'review' },
  { key: 'typo-check', label: '错字检查', desc: '当前章节错别字校对', group: 'review' },
  { key: 'longform-draft', label: '长文节拍规划', desc: '长文模式第一步的节拍表初稿', group: 'review' },
  { key: 'longform-seam', label: '接缝审阅', desc: '长文完成后的接缝自检', group: 'review' },
  { key: 'fact-extract', label: '设定事实抽取', desc: '从世界书/角色/章节抽取事实', group: 'review' },
  { key: 'inference', label: '推导链', desc: '按领域推导技术/社会前提', group: 'review' },
  { key: 'baseline-check', label: '越级校验', desc: '独立入口的越级矛盾检查', group: 'review' },
  { key: 'summary', label: '章节摘要', desc: '保存章节后自动生成（高频）', group: 'assist' },
  { key: 'namegen', label: '命名生成', desc: '角色/地点/招式/势力命名', group: 'assist' },
  { key: 'map', label: '地图生成', desc: '世界地图 AI 生成', group: 'assist' },
  { key: 'embedding', label: '向量嵌入', desc: '世界书条目与章节片段向量化', group: 'vector' }
];

const KEY_BINDINGS = 'ai.featureModels';
const KEY_EMBED_CONFIG = 'embedding.providerConfigId';
const KEY_EMBED_MODEL = 'embedding.model';

export class ModelRoutingService {
  private settings: AppSettingsService;

  constructor(settings: AppSettingsService) {
    this.settings = settings;
  }

  /** 功能点 -> configId 绑定表（含 embedding，embedding 绑定存独立 key 但并入返回，UI 统一展示） */
  async getBindings(): Promise<Partial<Record<FeatureKey, string>>> {
    const out: Partial<Record<FeatureKey, string>> = {};
    const raw = await this.settings.get(KEY_BINDINGS);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v) out[k as FeatureKey] = v;
        }
      } catch {
        /* 解析失败则视为空绑定 */
      }
    }
    const embed = await this.settings.get(KEY_EMBED_CONFIG);
    if (embed) out.embedding = embed;
    return out;
  }

  async setBinding(feature: FeatureKey, configId: string | null): Promise<void> {
    if (feature === 'embedding') {
      await this.settings.set(KEY_EMBED_CONFIG, configId);
      return;
    }
    const map = await this.getBindings();
    delete map.embedding; // embedding 存独立 key，不写入 ai.featureModels
    if (configId) map[feature] = configId;
    else delete map[feature];
    await this.settings.set(KEY_BINDINGS, JSON.stringify(map));
  }

  /** 清空全部功能绑定（含 embedding） */
  async clearAll(): Promise<void> {
    await this.settings.set(KEY_BINDINGS, null);
    await this.settings.set(KEY_EMBED_CONFIG, null);
  }

  async getEmbeddingModel(): Promise<string> {
    return (await this.settings.get(KEY_EMBED_MODEL)) ?? '';
  }

  async setEmbeddingModel(model: string): Promise<void> {
    await this.settings.set(KEY_EMBED_MODEL, model.trim() || null);
  }
}
