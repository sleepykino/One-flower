/**
 * 模型接入子页：供应商快捷接入卡片 + 自定义 Provider 配置 CRUD + 连接测试
 * P4：本地模型（Ollama/LM Studio）拉取模型列表；ComfyUI 生图配置 + 自定义工作流导入
 */

import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import { PROVIDER_PRESETS, type ProviderPreset } from '../../services/ai/providerPresets';
import { QuickAddProviderDialog } from './QuickAddProviderDialog';
import { isLocalBaseUrl } from '../../services/ai/providers/LLMProvider';
import { listRemoteModels } from '../../services/ai/providers/modelList';
import { KEY_COMFY_WORKFLOW } from '../../services/ai/providers/ImageProvider';
import type { ComfyWorkflow } from '../../services/ai/providers/ComfyUIImageProvider';
import type { ProviderConfig } from '../../types';

type ProviderType = ProviderConfig['provider'];

const PROVIDER_LABEL: Record<ProviderType, string> = {
  openai_compat: 'OpenAI 兼容（OpenAI / DeepSeek / Kimi / 智谱 / 通义…）',
  anthropic: 'Anthropic（Claude）',
  google: 'Google（Gemini）',
  comfyui: 'ComfyUI（本地生图）'
};

export function ModelsSection(): JSX.Element {
  const configs = useSettingsStore((s) => s.configs);
  const loadConfigs = useSettingsStore((s) => s.loadConfigs);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const removeConfig = useSettingsStore((s) => s.removeConfig);
  const setDefaultConfig = useSettingsStore((s) => s.setDefaultConfig);
  const testConnection = useSettingsStore((s) => s.testConnection);

  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    provider: ProviderType;
    baseUrl: string;
    model: string;
    apiKey: string;
  } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [quickAdd, setQuickAdd] = useState<ProviderPreset | null>(null);
  // P4：编辑表单的模型拉取 + 自定义工作流状态
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [customWfNodes, setCustomWfNodes] = useState<number | null>(null);
  const wfFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  // 已导入的自定义 ComfyUI 工作流（全局，app_settings）
  useEffect(() => {
    void (async () => {
      const raw = await getAppContext().appSettings.get(KEY_COMFY_WORKFLOW);
      if (!raw) return;
      try {
        const wf = JSON.parse(raw) as ComfyWorkflow;
        if (wf && typeof wf === 'object') setCustomWfNodes(Object.keys(wf).length);
      } catch {
        /* 损坏则视为未导入 */
      }
    })();
  }, []);

  const fetchModels = async (): Promise<void> => {
    if (!editing?.baseUrl.trim()) {
      void toast.info('请先填写 baseURL 再拉取');
      return;
    }
    setFetching(true);
    setFetchErr(null);
    try {
      const models = await listRemoteModels(editing.baseUrl, editing.apiKey.trim() || undefined);
      setFetchedModels(models);
      if (models.length === 0) setFetchErr('端点已连通但未返回模型列表');
    } catch (e) {
      setFetchedModels(null);
      setFetchErr(`${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFetching(false);
    }
  };

  /** 导入自定义 ComfyUI 工作流 JSON（校验为 API 格式 graph 后存 app_settings） */
  const importWorkflow = (file: File): void => {
    void (async () => {
      try {
        const text = await file.text();
        const wf = JSON.parse(text) as ComfyWorkflow;
        if (!wf || typeof wf !== 'object' || Array.isArray(wf)) {
          throw new Error('不是有效的 ComfyUI 工作流（需要 API 格式的节点对象 JSON）');
        }
        for (const node of Object.values(wf)) {
          if (!node || typeof node !== 'object' || typeof node.class_type !== 'string') {
            throw new Error('节点缺少 class_type，请用 ComfyUI 的「导出（API 格式）」保存的 JSON');
          }
        }
        await getAppContext().appSettings.set(KEY_COMFY_WORKFLOW, JSON.stringify(wf));
        setCustomWfNodes(Object.keys(wf).length);
      } catch (e) {
        void toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  const clearWorkflow = (): void => {
    void confirmDialog('清除已导入的自定义工作流？（生图将回到内置默认工作流）').then((ok) => {
      if (!ok) return;
      void getAppContext()
        .appSettings.set(KEY_COMFY_WORKFLOW, null)
        .then(() => setCustomWfNodes(null))
        .catch((e) => void toast.error(`清除失败：${e instanceof Error ? e.message : String(e)}`));
    });
  };

  /** 该预设是否已添加过（按名称+协议判断） */
  const presetAdded = (p: ProviderPreset): boolean =>
    configs.some((c) => c.name === p.label && c.provider === p.provider);

  const submit = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.name.trim()) {
      void toast.info('名称必填');
      return;
    }
    if (!editing.model.trim() && editing.provider !== 'comfyui') {
      void toast.info('模型必填');
      return;
    }
    if (
      (editing.provider === 'openai_compat' || editing.provider === 'comfyui') &&
      !editing.baseUrl.trim()
    ) {
      void toast.info('该协议需填写 baseURL');
      return;
    }
    await saveConfig(editing);
    setEditing(null);
    setFetchedModels(null);
    setFetchErr(null);
  };

  const test = async (id: string): Promise<void> => {
    setTesting(id);
    setTestResult((r) => ({ ...r, [id]: '' }));
    const r = await testConnection(id);
    setTestResult((prev) => ({ ...prev, [id]: `${r.ok ? '✅' : '❌'} ${r.message}` }));
    setTesting(null);
  };

  return (
    <div>
      {/* 快捷接入 */}
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-medium">快捷接入</h2>
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
          onClick={() =>
            setEditing({ name: '', provider: 'openai_compat', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' })
          }
        >
          + 自定义配置
        </button>
      </div>
      <p className="mb-2 text-xs text-ink-400">
        选择常用供应商，预填地址与推荐模型，只需粘贴 API Key 即可完成接入。
      </p>
      <div className="grid grid-cols-3 gap-2">
        {PROVIDER_PRESETS.map((p) => {
          const added = presetAdded(p);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setQuickAdd(p)}
              className={`relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
                added
                  ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                  : 'border-ink-200 bg-white hover:border-violet-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">{p.label}</span>
                {added && (
                  <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">已添加</span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-ink-400">{p.defaultModel}</div>
            </button>
          );
        })}
      </div>

      {/* 自定义编辑表单 */}
      {editing && (
        <div className="mt-4 rounded border border-violet-200 bg-violet-50/40 p-3">
          <div className="mb-2 text-sm font-medium">{editing.id ? '编辑配置' : '新建自定义配置'}</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="配置名称，如「我的 DeepSeek」"
              className="rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <select
              value={editing.provider}
              onChange={(e) => setEditing({ ...editing, provider: e.target.value as ProviderType })}
              className="rounded border border-ink-200 px-2 py-1 text-sm"
            >
              {(Object.keys(PROVIDER_LABEL) as ProviderType[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
            <input
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
              placeholder={
                editing.provider === 'comfyui'
                  ? 'baseURL *，如 http://127.0.0.1:8188'
                  : editing.provider === 'openai_compat'
                    ? 'baseURL *，如 https://api.deepseek.com'
                    : 'baseURL（可选）'
              }
              className={editing.provider === 'anthropic' || editing.provider === 'google' ? 'col-span-2 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400' : 'col-span-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400'}
            />
            <div className="col-span-1 flex gap-1">
              <input
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                placeholder={
                  editing.provider === 'comfyui'
                    ? 'Checkpoint 名（可选）'
                    : '模型名，如 deepseek-v4-pro / gpt-5.5'
                }
                className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 font-mono text-sm outline-none focus:border-violet-400"
              />
              {editing.provider === 'openai_compat' && (
                <button
                  type="button"
                  disabled={fetching}
                  className="shrink-0 rounded border border-ink-200 px-2 text-xs text-violet-600 hover:bg-ink-50 disabled:opacity-40"
                  onClick={() => void fetchModels()}
                >
                  {fetching ? '…' : '拉取'}
                </button>
              )}
            </div>
            {fetchedModels && fetchedModels.length > 0 && (
              <select
                value={fetchedModels.includes(editing.model) ? editing.model : ''}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                className="col-span-2 rounded border border-ink-200 px-2 py-1 font-mono text-sm"
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
              <div className="col-span-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                {fetchErr}
              </div>
            )}
            {editing.provider !== 'comfyui' && (
              <input
                type="password"
                value={editing.apiKey}
                onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                placeholder={editing.id ? 'API Key（留空保持不变）' : 'API Key *'}
                className="col-span-2 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
            )}
            {editing.provider === 'comfyui' && (
              <div className="col-span-2 flex items-center gap-2 rounded border border-ink-100 bg-ink-50/60 px-2 py-1.5 text-xs text-ink-600">
                <span className="text-ink-400">工作流</span>
                {customWfNodes !== null ? (
                  <span className="text-emerald-600">已导入自定义（{customWfNodes} 节点）</span>
                ) : (
                  <span>使用内置默认 txt2img 工作流</span>
                )}
                <button
                  type="button"
                  className="text-violet-600 hover:underline"
                  onClick={() => wfFileRef.current?.click()}
                >
                  导入工作流 JSON
                </button>
                {customWfNodes !== null && (
                  <button type="button" className="text-ink-400 hover:text-red-600" onClick={clearWorkflow}>
                    清除
                  </button>
                )}
                <input
                  ref={wfFileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importWorkflow(f);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700"
              onClick={() => void submit()}
            >
              保存
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 已添加配置列表 */}
      <h2 className="mb-2 mt-5 font-medium">已添加配置（{configs.length}）</h2>
      {configs.length === 0 && !editing && (
        <div className="rounded border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">
          暂无配置。AI 功能需要至少一组 Provider 配置，可从上方快捷接入开始。
        </div>
      )}
      {configs.map((c) => (
        <div
          key={c.id}
          className="mb-2 flex items-center gap-3 rounded border border-ink-100 bg-white px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              {c.isDefault && (
                <span className="rounded bg-violet-100 px-1.5 text-[10px] text-violet-700">默认</span>
              )}
              <span className="rounded bg-ink-100 px-1.5 text-[10px] text-ink-500">
                {c.provider === 'openai_compat'
                  ? 'OpenAI 兼容'
                  : c.provider === 'comfyui'
                    ? 'ComfyUI 生图'
                    : c.provider}
              </span>
              {isLocalBaseUrl(c.baseUrl) && (
                <span className="rounded bg-sky-100 px-1.5 text-[10px] text-sky-700">本地</span>
              )}
            </div>
            <div className="truncate text-xs text-ink-400">
              {c.model} · {c.baseUrl ?? '默认地址'}
            </div>
            {testResult[c.id] && (
              <div className={`mt-1 text-xs ${testResult[c.id].startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>
                {testResult[c.id]}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={testing === c.id}
            className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100 disabled:opacity-40"
            onClick={() => void test(c.id)}
          >
            {testing === c.id ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="text-xs text-violet-600 hover:underline"
            onClick={() =>
              setEditing({
                id: c.id,
                name: c.name,
                provider: c.provider,
                baseUrl: c.baseUrl ?? '',
                model: c.model,
                apiKey: ''
              })
            }
          >
            编辑
          </button>
          {!c.isDefault && (
            <button
              type="button"
              className="text-xs text-ink-500 hover:text-violet-600"
              onClick={() => void setDefaultConfig(c.id)}
            >
              设为默认
            </button>
          )}
          <button
            type="button"
            className="text-xs text-ink-400 hover:text-red-600"
            onClick={() => {
              void confirmDialog(`删除配置「${c.name}」？`).then((ok) => {
                if (ok) void removeConfig(c.id);
              });
            }}
          >
            删除
          </button>
        </div>
      ))}

      <p className="mt-3 text-[11px] leading-5 text-ink-400">
        API Key 存于系统钥匙串（Windows 凭据管理器），不落数据库。书籍未在「模型分工」绑定模型时，使用「默认」配置；未设置默认则回退到第一组配置。
      </p>

      {/* 快捷接入弹窗（已添加过则传入 existingId 走更新） */}
      {quickAdd && (
        <QuickAddProviderDialog
          preset={quickAdd}
          existingId={
            configs.find((c) => c.name === quickAdd.label && c.provider === quickAdd.provider)?.id
          }
          onClose={() => setQuickAdd(null)}
        />
      )}
    </div>
  );
}
