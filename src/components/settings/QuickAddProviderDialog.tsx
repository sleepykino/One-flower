/**
 * QuickAddProviderDialog：供应商快捷接入弹窗
 * 预填协议/baseURL/模型，只需粘贴 API Key；[获取 Key] 打开官网；[测试并保存] 落库
 * P4：本地预设（Ollama/LM Studio/ComfyUI）免 Key，模型可「拉取模型列表」
 */

import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { invoke } from '@tauri-apps/api/core';
import type { ProviderPreset } from '../../services/ai/providerPresets';
import { isLocalBaseUrl } from '../../services/ai/providers/LLMProvider';
import { listRemoteModels } from '../../services/ai/providers/modelList';

export function QuickAddProviderDialog({
  preset,
  existingId,
  onClose
}: {
  preset: ProviderPreset;
  /** 已有同名配置的 id：保存时更新而非新建重复项 */
  existingId?: string;
  onClose: () => void;
}): JSX.Element {
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const testConnection = useSettingsStore((s) => s.testConnection);
  const [model, setModel] = useState(preset.defaultModel);
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // P4：本地预设免 Key + 模型拉取
  const local = preset.provider === 'comfyui' || isLocalBaseUrl(preset.baseUrl);
  const [localModel, setLocalModel] = useState(preset.defaultModel);
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  useEffect(() => {
    if (!preset.models.includes(model)) setModel(preset.defaultModel);
  }, [preset, model]);

  const openKeyUrl = (): void => {
    void invoke('open_url', { url: preset.keyUrl }).catch((e) =>
      console.warn('打开 Key 页面失败:', e)
    );
  };

  const fetchModels = async (): Promise<void> => {
    setFetching(true);
    setFetchErr(null);
    try {
      const models = await listRemoteModels(preset.baseUrl, apiKey.trim() || undefined);
      setFetchedModels(models);
      if (models.length === 0) setFetchErr('端点已连通但未返回模型，请先拉取/加载模型后重试');
    } catch (e) {
      setFetchErr(`${e instanceof Error ? e.message : String(e)}；请确认本地服务已启动，或手动填写模型名`);
      setFetchedModels(null);
    } finally {
      setFetching(false);
    }
  };

  const finalModel = local ? localModel.trim() : model === '__custom__' ? customModel.trim() : model;

  const save = async (): Promise<void> => {
    if (!apiKey.trim() && !local) {
      setResult({ ok: false, message: '请先粘贴 API Key' });
      return;
    }
    if (!finalModel && preset.provider !== 'comfyui') {
      setResult({ ok: false, message: '请选择或填写模型名' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await saveConfig({
        id: existingId,
        name: preset.label,
        provider: preset.provider,
        baseUrl: preset.baseUrl,
        model: finalModel,
        apiKey: apiKey.trim()
      });
      // 保存后立即测试（keyStore 已写入）
      const configs = useSettingsStore.getState().configs;
      const mine = existingId
        ? configs.find((c) => c.id === existingId)
        : configs.find((c) => c.name === preset.label && c.provider === preset.provider);
      const r = mine ? await testConnection(mine.id) : { ok: true, message: '已保存' };
      setResult(r);
      if (r.ok) {
        window.setTimeout(onClose, 900);
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-[440px] rounded-lg border border-ink-200 bg-white shadow-xl">
        <div className="border-b border-ink-100 px-4 py-3">
          <div className="text-base font-medium">接入 {preset.label}</div>
          <div className="mt-0.5 text-xs text-ink-400">
            {preset.provider === 'openai_compat'
              ? 'OpenAI 兼容协议'
              : preset.provider === 'anthropic'
                ? 'Anthropic 协议'
                : preset.provider === 'google'
                  ? 'Google 协议'
                  : 'ComfyUI（本地生图）'}
            {preset.baseUrl ? ` · ${preset.baseUrl}` : ''}
          </div>
        </div>
        <div className="px-4 py-3">
          {/* API Key（本地预设免 Key） */}
          {local ? (
            <div className="rounded bg-emerald-50 px-2 py-1.5 text-[11px] leading-5 text-emerald-700">
              本地服务无需 API Key，请确保服务已启动。
            </div>
          ) : (
            <>
              <label className="mb-1 block text-xs font-medium text-ink-600">API Key</label>
              <div className="flex gap-1">
                <input
                  type="password"
                  autoFocus
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="粘贴 API Key（存入系统钥匙串，不落数据库）"
                  className="flex-1 rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
                />
                <button
                  type="button"
                  className="shrink-0 rounded border border-ink-200 px-2 py-1 text-xs text-violet-600 hover:bg-ink-50"
                  onClick={openKeyUrl}
                  title={preset.keyUrl}
                >
                  获取 Key ↗
                </button>
              </div>
            </>
          )}

          {/* 模型：本地预设 = 输入 + 拉取；云端预设 = 下拉 */}
          {local ? (
            <>
              <label className="mb-1 mt-3 block text-xs font-medium text-ink-600">
                {preset.provider === 'comfyui' ? '模型（Checkpoint 名，可选）' : '模型'}
              </label>
              <div className="flex gap-1">
                <input
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  placeholder={
                    preset.provider === 'comfyui'
                      ? 'Checkpoint 文件名，如 flux1-dev.safetensors（留空用工作流默认）'
                      : '点击右侧「拉取」或手动填写，如 qwen3:8b'
                  }
                  className="flex-1 rounded border border-ink-200 px-2 py-1.5 font-mono text-sm outline-none focus:border-violet-400"
                />
                {preset.provider !== 'comfyui' && (
                  <button
                    type="button"
                    disabled={fetching}
                    className="shrink-0 rounded border border-ink-200 px-2 py-1 text-xs text-violet-600 hover:bg-ink-50 disabled:opacity-40"
                    onClick={() => void fetchModels()}
                  >
                    {fetching ? '拉取中…' : '拉取模型列表'}
                  </button>
                )}
              </div>
              {fetchedModels && fetchedModels.length > 0 && (
                <select
                  value={fetchedModels.includes(localModel) ? localModel : ''}
                  onChange={(e) => setLocalModel(e.target.value)}
                  className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 font-mono text-sm"
                >
                  <option value="">选择已拉取的模型（{fetchedModels.length}）…</option>
                  {fetchedModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              {fetchErr && (
                <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] leading-5 text-amber-700">
                  {fetchErr}
                </div>
              )}
            </>
          ) : (
            <>
              <label className="mb-1 mt-3 block text-xs font-medium text-ink-600">模型</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded border border-ink-200 px-2 py-1.5 text-sm"
              >
                {preset.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__custom__">自定义模型名…</option>
              </select>
              {model === '__custom__' && (
                <input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="填写模型名，如 doubao-seed-2-1-pro-260628 或接入点 ep-xxx"
                  className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
                />
              )}
            </>
          )}

          {preset.note && (
            <div className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-5 text-amber-700">
              {preset.note}
            </div>
          )}
          {existingId && (
            <div className="mt-2 text-[11px] text-ink-400">
              该供应商已有配置，保存将更新其 API Key 与模型。
            </div>
          )}

          {result && (
            <div
              className={`mt-2 break-all rounded px-2 py-1.5 text-xs ${
                result.ok
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border border-red-200 bg-red-50 text-red-600'
              }`}
            >
              {result.ok ? '✅ ' : '❌ '}
              {result.message}
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t border-ink-100 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            className="flex-1 rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
            onClick={() => void save()}
          >
            {busy ? '测试中…' : '测试并保存'}
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-4 py-1.5 text-sm hover:bg-ink-100"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
