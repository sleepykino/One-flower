/**
 * AI 模型分工（P2 二期，PR-A 属性化重构）：按功能点路由到不同 Provider 配置，控制成本与质量
 * 存储 app_settings key 'ai.featureModels'：{ [featureKey]: configId }
 * 向量嵌入沿用旧 key（embedding.providerConfigId / embedding.model），仅 UI 并入统一表格
 *
 * 分类学（PR-A 定稿）：domain 是唯一的 UI 分组维度（用户按"我在配置什么"找功能）；
 * cost（模型强度建议）以徽章呈现、trigger（自动/手动）以文案呈现，二者永远不做分组。
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
  | 'embedding'
  | 'seed-gen'
  | 'card-gen'
  | 'interview'
  | 'whatif'
  | 'image'
  | 'image-prompt'
  | 'script-outline'
  | 'script-gen'
  | 'skill-forge';

/** 功能域：唯一的 UI 分组维度 */
export type FeatureDomain =
  | 'writing' // 写作生成
  | 'review' // 规划与校验
  | 'brainstorm' // 灵感与素材
  | 'visual' // 视觉生成
  | 'speech' // 语音（Pn1 stt 接入，已推迟）
  | 'background'; // 向量与后台

/** 模型强度建议：徽章呈现，不做分组 */
export type FeatureCost = 'premium' | 'standard' | 'economy';

/** 触发方式：auto = 后台自动运行（描述文案提示频率） */
export type FeatureTrigger = 'manual' | 'auto';

export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  desc: string;
  domain: FeatureDomain;
  cost: FeatureCost;
  trigger: FeatureTrigger;
}

export const FEATURE_DOMAINS: Array<{ key: FeatureDomain; label: string; desc: string }> = [
  { key: 'writing', label: '写作生成', desc: '直接影响正文质量，建议强模型' },
  { key: 'review', label: '规划与校验', desc: '结构化分析任务，中档模型即可' },
  { key: 'brainstorm', label: '灵感与素材', desc: '种子 / 卡片 / 采访 / 推演 / 命名' },
  { key: 'visual', label: '视觉生成', desc: '图片生成、提示词转写与地图' },
  { key: 'speech', label: '语音', desc: '语音转写（Pn1 接入，已推迟）' },
  { key: 'background', label: '向量与后台', desc: '自动运行的高频任务，省钱优先' }
];

export const AI_FEATURES: FeatureMeta[] = [
  { key: 'continue', label: '续写', desc: '长文模式正文生成同此配置', domain: 'writing', cost: 'premium', trigger: 'manual' },
  { key: 'rewrite', label: '改写', desc: '选中段落按指令改写', domain: 'writing', cost: 'premium', trigger: 'manual' },
  { key: 'dialogue', label: '对白', desc: '场景对白生成', domain: 'writing', cost: 'premium', trigger: 'manual' },
  { key: 'longform-draft', label: '长文节拍规划', desc: '长文模式第一步的节拍表初稿', domain: 'writing', cost: 'premium', trigger: 'manual' },
  { key: 'check', label: '一致性检查', desc: '角色卡/世界书/时代感基线比对', domain: 'review', cost: 'standard', trigger: 'manual' },
  { key: 'typo-check', label: '错字检查', desc: '当前章节错别字校对', domain: 'review', cost: 'standard', trigger: 'manual' },
  { key: 'longform-seam', label: '接缝审阅', desc: '长文完成后的接缝自检', domain: 'review', cost: 'standard', trigger: 'manual' },
  { key: 'fact-extract', label: '设定事实抽取', desc: '从世界书/角色/章节抽取事实', domain: 'review', cost: 'standard', trigger: 'manual' },
  { key: 'inference', label: '推导链', desc: '按领域推导技术/社会前提', domain: 'review', cost: 'standard', trigger: 'manual' },
  { key: 'baseline-check', label: '越级校验', desc: '独立入口的越级矛盾检查', domain: 'review', cost: 'standard', trigger: 'manual' },
  { key: 'seed-gen', label: '故事种子', desc: '题材+元素组合生成故事钩子', domain: 'brainstorm', cost: 'standard', trigger: 'manual' },
  { key: 'card-gen', label: '灵感卡片', desc: '每日灵感卡片生成', domain: 'brainstorm', cost: 'standard', trigger: 'manual' },
  { key: 'interview', label: '角色采访', desc: 'AI 扮演角色回答提问', domain: 'brainstorm', cost: 'standard', trigger: 'manual' },
  { key: 'whatif', label: '假设推演', desc: '"如果…会怎样"剧情影响推演', domain: 'brainstorm', cost: 'standard', trigger: 'manual' },
  { key: 'namegen', label: '命名生成', desc: '角色/地点/招式/势力命名', domain: 'brainstorm', cost: 'standard', trigger: 'manual' },
  { key: 'image', label: '图片生成', desc: '生图模型（需绑定模型为图片模型的配置）', domain: 'visual', cost: 'standard', trigger: 'manual' },
  { key: 'image-prompt', label: '图片提示词转写', desc: '中文场景描述转写为专业图片 prompt（可选便宜对话模型）', domain: 'visual', cost: 'standard', trigger: 'manual' },
  { key: 'script-gen', label: '剧本逐场生成', desc: '小说→剧本转化：逐场生成镜头与对白（P5）', domain: 'writing', cost: 'premium', trigger: 'manual' },
  { key: 'script-outline', label: '剧本大纲', desc: '转化第一阶段：集与场次大纲规划（P5）', domain: 'review', cost: 'standard', trigger: 'manual' },
  { key: 'map', label: '地图生成', desc: '世界地图 AI 生成', domain: 'visual', cost: 'standard', trigger: 'manual' },
  { key: 'summary', label: '章节摘要', desc: '保存章节后自动生成（高频）', domain: 'background', cost: 'economy', trigger: 'auto' },
  { key: 'embedding', label: '向量嵌入', desc: '世界书条目与章节片段向量化', domain: 'background', cost: 'economy', trigger: 'auto' },
  { key: 'skill-forge', label: '一把炼化', desc: '从文本 / 书籍提炼文风 Skill', domain: 'brainstorm', cost: 'standard', trigger: 'manual' }
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
