/**
 * AI 模型分工子页（PR-A 重构）：按功能域（domain）分组指定 Provider 配置
 * 强度建议（cost）以徽章呈现、自动任务（trigger）以文案标记，均不做分组
 * 两级路由：功能绑定 -> 第一组配置；向量嵌入并入本表格（沿用 embedding.* 存储键）
 */

import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import {
  AI_FEATURES,
  FEATURE_DOMAINS,
  type FeatureCost,
  type FeatureKey
} from '../../services/ai/modelRouting';

const FOLLOW_DEFAULT = '__follow__';

const COST_BADGE: Record<FeatureCost, { label: string; cls: string; hint: string }> = {
  premium: { label: '强', cls: 'bg-violet-100 text-violet-700', hint: '建议强模型' },
  standard: { label: '中', cls: 'bg-sky-100 text-sky-700', hint: '中档模型即可' },
  economy: { label: '省', cls: 'bg-emerald-100 text-emerald-700', hint: '省钱优先' }
};

export function FeatureModelsSection(): JSX.Element {
  const configs = useSettingsStore((s) => s.configs);
  const loadConfigs = useSettingsStore((s) => s.loadConfigs);
  const [bindings, setBindings] = useState<Partial<Record<FeatureKey, string>>>({});
  const [embedModel, setEmbedModel] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  // P7.6：生成安全网（单次回复 token 兜底上下限，设置页可配；字符串存取沿用 app_settings 约定）
  const [genCap, setGenCap] = useState('8192');
  const [genFloor, setGenFloor] = useState('512');

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    void (async () => {
      const { modelRouting, appSettings } = getAppContext();
      setBindings(await modelRouting.getBindings());
      setEmbedModel(await modelRouting.getEmbeddingModel());
      // P7.6：读取安全网限值（非法值交由读侧兜底，此处原样展示）
      const [cap, floor] = await Promise.all([
        appSettings.get('ai.gen.maxTokensCap'),
        appSettings.get('ai.gen.maxTokensFloor')
      ]);
      if (cap !== null) setGenCap(cap);
      if (floor !== null) setGenFloor(floor);
    })();
  }, []);

  const configById = useMemo(() => new Map(configs.map((c) => [c.id, c])), [configs]);

  // "已保存"标记 2 秒后自动消失
  useEffect(() => {
    if (savedAt === 0) return;
    const t = window.setTimeout(() => setSavedAt(0), 2000);
    return () => window.clearTimeout(t);
  }, [savedAt]);
  /** 默认配置 = 第一组对话可用配置（comfyui 生图专用不参与，与运行时路由守卫一致） */
  const defaultConfig = configs.find((c) => c.provider !== 'comfyui') ?? null;

  /** 某功能当前实际会用的模型（未绑定或绑定不可用时显示默认配置的模型，路由透明可见） */
  const effectiveModel = (feature: FeatureKey): string => {
    const bound = bindings[feature];
    const boundConfig = bound ? configById.get(bound) : undefined;
    if (boundConfig && (feature === 'image' || boundConfig.provider !== 'comfyui')) {
      return boundConfig.model;
    }
    return defaultConfig ? `${defaultConfig.model}（默认）` : '未配置任何模型';
  };

  /** 保存绑定：失败立即弹错（不再静默），成功显示已保存标记 */
  const setBinding = async (feature: FeatureKey, configId: string | null): Promise<void> => {
    setBindings((s) => {
      const next = { ...s };
      if (configId) next[feature] = configId;
      else delete next[feature];
      return next;
    });
    try {
      await getAppContext().modelRouting.setBinding(feature, configId);
      setSavedAt(Date.now());
    } catch (e) {
      void toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
      // 回滚本地状态，避免 UI 与存储不一致
      try {
        setBindings(await getAppContext().modelRouting.getBindings());
      } catch {
        /* 忽略回滚失败 */
      }
    }
  };

  const clearAll = (): void => {
    void confirmDialog('清空全部功能绑定？所有功能恢复使用第一组配置。').then((ok) => {
      if (!ok) return;
      void getAppContext()
        .modelRouting.clearAll()
        .then(() => setBindings({}))
        .catch((e) => void toast.error(`清空失败：${e instanceof Error ? e.message : String(e)}`));
    });
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-medium">AI 模型分工</h2>
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
          onClick={clearAll}
        >
          全部用默认配置
        </button>
      </div>
      <p className="mb-3 text-xs leading-5 text-ink-400">
        为每类功能指定模型，控制成本与质量。未指定的功能使用第一组配置
        {defaultConfig ? `（当前：${defaultConfig.name} · ${defaultConfig.model}）` : ''}。
        建议搭配：续写用强模型、章节摘要等后台任务用弱模型。
      </p>

      {configs.length === 0 && (
        <div className="mb-3 rounded border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400">
          暂无 Provider 配置，请先到「模型接入」添加。
        </div>
      )}

      {FEATURE_DOMAINS.map((g) => {
        const features = AI_FEATURES.filter((f) => f.domain === g.key);
        if (features.length === 0) return null;
        return (
          <div key={g.key} className="mb-4">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-xs font-medium text-ink-700">{g.label}</span>
              <span className="text-[10px] text-ink-400">{g.desc}</span>
            </div>
            <div className="rounded border border-ink-100 bg-white">
              {features.map((f) => {
                const bound = bindings[f.key];
                const isEmbedding = f.key === 'embedding';
                const badge = COST_BADGE[f.cost];
                return (
                  <div
                    key={f.key}
                    className="flex items-center gap-2 border-b border-ink-50 px-2.5 py-2 last:border-b-0"
                  >
                    <div className="w-36 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1 py-px text-[10px] font-medium ${badge.cls}`}
                          title={badge.hint}
                        >
                          {badge.label}
                        </span>
                        <span className="text-xs font-medium">{f.label}</span>
                        {f.trigger === 'auto' && (
                          <span className="rounded bg-ink-100 px-1 py-px text-[10px] text-ink-500">
                            后台自动
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] leading-4 text-ink-400">{f.desc}</div>
                    </div>
                    <select
                      value={bound ?? FOLLOW_DEFAULT}
                      onChange={(e) =>
                        void setBinding(f.key, e.target.value === FOLLOW_DEFAULT ? null : e.target.value)
                      }
                      className="w-56 shrink-0 rounded border border-ink-200 px-1.5 py-1 text-xs"
                    >
                      <option value={FOLLOW_DEFAULT}>用默认配置（第一组）</option>
                      {/* comfyui 为生图专用协议，仅「图片生成」可选，避免误绑对话功能运行时才报错 */}
                      {configs
                        .filter((c) => f.key === 'image' || c.provider !== 'comfyui')
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}（{c.model}）
                          </option>
                        ))}
                    </select>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-ink-400" title={effectiveModel(f.key)}>
                      实际使用：{effectiveModel(f.key)}
                    </span>
                    {isEmbedding && (
                      <input
                        value={embedModel}
                        onChange={(e) => setEmbedModel(e.target.value)}
                        onBlur={() =>
                          void getAppContext()
                            .modelRouting.setEmbeddingModel(embedModel)
                            .then(() => setSavedAt(Date.now()))
                            .catch((e) =>
                              void toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
                            )
                        }
                        placeholder="嵌入模型名，如 text-embedding-3-small"
                        className="w-52 shrink-0 rounded border border-ink-200 px-1.5 py-1 text-[11px] outline-none focus:border-violet-400"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-400">
        {savedAt > 0 && <span className="text-emerald-600">已保存 ✓</span>}
        <span>说明：Anthropic 无 embeddings 接口，向量嵌入请选 OpenAI 兼容或 Google 配置；AI 上下文面板会显示每次调用实际使用的模型。</span>
      </div>

      {/* P7.6：生成安全网（高级项）——AI 单次回复 token 兜底上下限，目标字数 ×2.2 后被夹在此区间 */}
      <div className="mt-6 border-t border-ink-100 pt-4">
        <div className="mb-1 text-xs font-medium text-ink-700">生成安全网</div>
        <p className="mb-2 text-[11px] leading-4 text-ink-400">
          AI 单次回复的 token 兜底上下限，目标字数 ×2.2 后被夹在此区间；一般无需修改
        </p>
        <div className="flex items-center gap-4 text-xs text-ink-600">
          <label className="flex items-center gap-1">
            单次回复上限
            <input
              type="number"
              min={256}
              step={256}
              value={genCap}
              onChange={(e) => setGenCap(e.target.value)}
              onBlur={() =>
                void getAppContext()
                  .appSettings.set('ai.gen.maxTokensCap', genCap)
                  .then(() => setSavedAt(Date.now()))
                  .catch((e) =>
                    void toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
                  )
              }
              className="w-24 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
            />
          </label>
          <label className="flex items-center gap-1">
            单次回复下限
            <input
              type="number"
              min={256}
              step={256}
              value={genFloor}
              onChange={(e) => setGenFloor(e.target.value)}
              onBlur={() =>
                void getAppContext()
                  .appSettings.set('ai.gen.maxTokensFloor', genFloor)
                  .then(() => setSavedAt(Date.now()))
                  .catch((e) =>
                    void toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`)
                  )
              }
              className="w-24 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
