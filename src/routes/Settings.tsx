/**
 * Settings 页：Provider 配置 CRUD + API Key（keytar）+ 连接测试
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../store/settingsStore';
import { getAppContext } from '../context/app-context';
import { alertDialog, confirmDialog } from '../native/dialog';
import type { GlobalPromptItem } from '../services/ai/GlobalPromptService';
import { countTokens } from '../utils/tokens';
import type { UpdateInfo } from '../services/update/UpdateService';
import { UpdateDialog } from '../components/update/UpdateDialog';
import type { ProviderConfig } from '../types';

type ProviderType = ProviderConfig['provider'];

const PROVIDER_LABEL: Record<ProviderType, string> = {
  openai_compat: 'OpenAI 兼容（OpenAI / DeepSeek / Kimi / 智谱 / 通义…）',
  anthropic: 'Anthropic（Claude）',
  google: 'Google（Gemini）'
};

export function Settings(): JSX.Element {
  const navigate = useNavigate();
  const configs = useSettingsStore((s) => s.configs);
  const loadConfigs = useSettingsStore((s) => s.loadConfigs);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const removeConfig = useSettingsStore((s) => s.removeConfig);
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
  const [embedConfigId, setEmbedConfigId] = useState('');
  const [embedModel, setEmbedModel] = useState('');
  const [embedSaved, setEmbedSaved] = useState(false);
  // P2.1-M1：全局提示词（总开关 + 条目增删/排序/启停，预算 600 token）
  const GP_BUDGET = 600;
  const [gpItems, setGpItems] = useState<GlobalPromptItem[]>([]);
  const [gpEnabled, setGpEnabled] = useState(true);
  const [gpDraft, setGpDraft] = useState('');

  useEffect(() => {
    void (async () => {
      const { globalPrompts } = getAppContext();
      setGpItems(await globalPrompts.list());
      setGpEnabled(await globalPrompts.isEnabled());
    })();
  }, []);

  const gpPersist = async (items: GlobalPromptItem[]): Promise<void> => {
    setGpItems(items);
    await getAppContext().globalPrompts.save(items);
  };

  const gpAdd = async (): Promise<void> => {
    const text = gpDraft.trim();
    if (!text) {
      void alertDialog('请输入提示词内容');
      return;
    }
    await gpPersist([...gpItems, { id: crypto.randomUUID(), text, enabled: true }]);
    setGpDraft('');
  };

  const gpMove = async (index: number, dir: -1 | 1): Promise<void> => {
    const target = index + dir;
    if (target < 0 || target >= gpItems.length) return;
    const next = [...gpItems];
    [next[index], next[target]] = [next[target], next[index]];
    await gpPersist(next);
  };

  const gpUsed = gpItems.filter((i) => i.enabled).reduce((sum, i) => sum + countTokens(i.text), 0);

  // ============ 客户端更新（方案 A）============
  const [appVersion, setAppVersion] = useState('');
  const [autoCheck, setAutoCheck] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void (async () => {
      const { updateService } = getAppContext();
      setAppVersion(await updateService.getCurrentVersion());
      setAutoCheck(await updateService.isAutoCheckEnabled());
    })();
  }, []);

  /** 手动检查：发现新版弹下载窗；无更新/失败仅提示 */
  const checkUpdate = async (): Promise<void> => {
    const { updateService } = getAppContext();
    setChecking(true);
    setUpdateMsg('检查中…');
    try {
      const info = await updateService.findNewer();
      await updateService.markChecked();
      if (info) {
        setUpdateInfo(info);
        setUpdateMsg(`发现新版本 v${info.version}`);
      } else {
        setUpdateMsg(`已是最新版本（v${appVersion || await updateService.getCurrentVersion()}）`);
      }
    } catch (e) {
      setUpdateMsg(`检查失败：${e instanceof Error ? e.message : String(e)}（GitHub 访问受限时可配置网络后重试）`);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  // 读取向量嵌入配置（app_settings）
  useEffect(() => {
    void (async () => {
      const { appSettings } = getAppContext();
      const [cid, model] = await Promise.all([
        appSettings.get('embedding.providerConfigId'),
        appSettings.get('embedding.model')
      ]);
      setEmbedConfigId(cid ?? '');
      setEmbedModel(model ?? '');
    })();
  }, []);

  const saveEmbedding = async (): Promise<void> => {
    const { appSettings } = getAppContext();
    await appSettings.set('embedding.providerConfigId', embedConfigId || null);
    await appSettings.set('embedding.model', embedModel.trim() || null);
    setEmbedSaved(true);
    setTimeout(() => setEmbedSaved(false), 2000);
  };

  const submit = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.model.trim()) {
      void alertDialog('名称与模型必填');
      return;
    }
    if (editing.provider === 'openai_compat' && !editing.baseUrl.trim()) {
      void alertDialog('OpenAI 兼容协议需填写 baseURL');
      return;
    }
    await saveConfig(editing);
    setEditing(null);
  };

  const test = async (id: string): Promise<void> => {
    setTesting(id);
    setTestResult((r) => ({ ...r, [id]: '' }));
    const r = await testConnection(id);
    setTestResult((prev) => ({ ...prev, [id]: `${r.ok ? '✅' : '❌'} ${r.message}` }));
    setTesting(null);
  };

  return (
    <div className="h-full overflow-y-auto">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <h1 className="text-xl font-bold">设置</h1>
        <button
          type="button"
          className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
          onClick={() => navigate('/')}
        >
          返回书架
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-10">
        <section className="rounded-lg border border-ink-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-medium">模型 Provider 配置</h2>
              <p className="text-xs text-ink-400">
                API Key 存于系统钥匙串（Windows 凭据管理器），不落数据库。
              </p>
            </div>
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
              onClick={() =>
                setEditing({ name: '', provider: 'openai_compat', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' })
              }
            >
              新建配置
            </button>
          </div>

          {editing && (
            <div className="mb-3 rounded border border-violet-200 bg-violet-50/40 p-3">
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
                  placeholder={editing.provider === 'openai_compat' ? 'baseURL *，如 https://api.deepseek.com/v1' : 'baseURL（可选）'}
                  className={editing.provider === 'openai_compat' ? 'col-span-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400' : 'col-span-2 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400'}
                />
                <input
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  placeholder="模型名，如 deepseek-chat / gpt-4o / claude-3-5-sonnet"
                  className="rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
                />
                <input
                  type="password"
                  value={editing.apiKey}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  placeholder={editing.id ? 'API Key（留空保持不变）' : 'API Key *'}
                  className="col-span-2 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
                />
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

          {configs.length === 0 && !editing && (
            <div className="rounded border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">
              暂无配置。AI 功能需要至少一组 Provider 配置。
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
                  <span className="rounded bg-ink-100 px-1.5 text-[10px] text-ink-500">
                    {c.provider}
                  </span>
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
        </section>

        <section className="mt-4 rounded-lg border border-ink-200 bg-white p-4">
          <h2 className="mb-1 font-medium">向量嵌入（世界书 RAG）</h2>
          <p className="mb-3 text-xs text-ink-400">
            用于世界书条目向量化与检索。Anthropic 无 embeddings 接口，请选择 OpenAI 兼容或 Google 配置。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-ink-500">Provider 配置</label>
              <select
                value={embedConfigId}
                onChange={(e) => setEmbedConfigId(e.target.value)}
                className="w-full rounded border border-ink-200 px-2 py-1 text-sm"
              >
                <option value="">跟随书籍 / 首组配置</option>
                {configs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.provider}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-500">嵌入模型</label>
              <input
                value={embedModel}
                onChange={(e) => setEmbedModel(e.target.value)}
                placeholder="text-embedding-3-small"
                className="w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700"
              onClick={() => void saveEmbedding()}
            >
              保存
            </button>
            {embedSaved && <span className="text-xs text-emerald-600">已保存</span>}
          </div>
        </section>

        {/* P2.1-M1：全局提示词 */}
        <section className="mt-4 rounded-lg border border-ink-200 bg-white p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-medium">全局提示词</h2>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={gpEnabled}
                onChange={(e) => {
                  const v = e.target.checked;
                  setGpEnabled(v);
                  void getAppContext().globalPrompts.setEnabled(v);
                }}
              />
              总开关
            </label>
          </div>
          <p className="mb-3 text-xs text-ink-400">
            注入所有 AI 模式 system 段，优先级高于任何 Skill。预算 {GP_BUDGET} token，超出部分会被截断。
          </p>

          <div className="flex gap-2">
            <input
              value={gpDraft}
              onChange={(e) => setGpDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void gpAdd();
              }}
              placeholder="新增提示词，如：避免使用'仿佛'"
              className="flex-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700"
              onClick={() => void gpAdd()}
            >
              添加
            </button>
          </div>

          {gpItems.length > 0 && (
            <ul className="mt-2 space-y-1">
              {gpItems.map((item, i) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded border border-ink-100 bg-white px-2 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => {
                      void gpPersist(
                        gpItems.map((it) =>
                          it.id === item.id ? { ...it, enabled: e.target.checked } : it
                        )
                      );
                    }}
                    title="单条启停"
                  />
                  <span className={`min-w-0 flex-1 truncate ${item.enabled ? '' : 'text-ink-400 line-through'}`}>
                    {item.text}
                  </span>
                  <span className="text-[10px] text-ink-400">{countTokens(item.text)} tok</span>
                  <button type="button" className="px-1 text-xs text-ink-400 hover:text-ink-700 disabled:opacity-30" disabled={i === 0} onClick={() => void gpMove(i, -1)} title="上移">↑</button>
                  <button type="button" className="px-1 text-xs text-ink-400 hover:text-ink-700 disabled:opacity-30" disabled={i === gpItems.length - 1} onClick={() => void gpMove(i, 1)} title="下移">↓</button>
                  <button
                    type="button"
                    className="px-1 text-xs text-ink-400 hover:text-red-600"
                    onClick={() => {
                      void confirmDialog('删除该条提示词？').then((ok) => {
                        if (ok) void gpPersist(gpItems.filter((it) => it.id !== item.id));
                      });
                    }}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={`mt-2 text-xs ${gpUsed > GP_BUDGET ? 'text-red-500' : 'text-ink-400'}`}>
            已启用条目合计约 {gpUsed} / {GP_BUDGET} token
          </div>
        </section>

        {/* 客户端更新（方案 A） */}
        <section className="mt-4 rounded-lg border border-ink-200 bg-white p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-medium">软件更新</h2>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={autoCheck}
                onChange={(e) => {
                  const v = e.target.checked;
                  setAutoCheck(v);
                  void getAppContext().updateService.setAutoCheckEnabled(v);
                }}
              />
              自动检查更新
            </label>
          </div>
          <p className="mb-3 text-xs text-ink-400">
            当前版本 v{appVersion || '…'} · 新版本发布于 GitHub Releases，检查到新版本时会弹出下载提示。
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={checking}
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void checkUpdate()}
            >
              {checking ? '检查中…' : '立即检查更新'}
            </button>
            {updateMsg && <span className="min-w-0 truncate text-xs text-ink-500">{updateMsg}</span>}
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-600">
          <h2 className="mb-2 font-medium">数据与 Skill</h2>
          <ul className="list-disc space-y-1 pl-5 text-xs text-ink-500">
            <li>数据库与书籍文件存于应用数据目录（SQLite WAL 模式，单写队列）。</li>
            <li>Skill 目录：~/.novelagent/skills/，放入 SKILL.md 后在书籍 Skill 面板勾选启用。</li>
            <li>每本书可在 Skill 面板指定启用的文风；书籍默认模型取第一组配置或在书籍设置中指定。</li>
          </ul>
        </section>
      </main>

      {/* 发现新版本：下载弹窗 */}
      {updateInfo && (
        <UpdateDialog
          info={updateInfo}
          currentVersion={appVersion}
          onClose={() => setUpdateInfo(null)}
        />
      )}
    </div>
  );
}
