/**
 * 角色卡模板可视化构建器（P1 Phase9）
 * 左侧：字段类型调色板（拖拽/点击添加）+ 字段列表编辑（key/标题/类型/必填/排序）
 * 右侧：实时预览表单效果
 * 顶部：JSON 视图（手改 / 应用）、模板导入导出（.json 文件）、保存到本书模板
 */

import { useMemo, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { toast } from '../common/toast';
import type { CharacterSchema } from '../../types';
import {
  FIELD_KINDS,
  KIND_LABEL,
  fieldsToSchemaJson,
  parseSchemaFields,
  type CardField,
  type FieldKind
} from './schemaFields';

const isKind = (v: string): v is FieldKind => (FIELD_KINDS as string[]).includes(v);

export function SchemaBuilder({
  schema,
  onClose,
  onSaved
}: {
  schema: CharacterSchema;
  onClose: () => void;
  onSaved: (schemaJson: string) => void;
}): JSX.Element {
  const [fields, setFields] = useState<CardField[]>(() => parseSchemaFields(schema.schemaJson));
  const [tab, setTab] = useState<'build' | 'json'>('build');
  const [jsonText, setJsonText] = useState(schema.schemaJson);
  const [error, setError] = useState<string | null>(null);
  const [ioBusy, setIoBusy] = useState(false);

  const schemaJson = useMemo(() => fieldsToSchemaJson(fields), [fields]);

  const addField = (kind: FieldKind): void => {
    setFields((prev) => {
      let n = prev.length + 1;
      while (prev.some((f) => f.key === `field${n}`)) n += 1;
      return [
        ...prev,
        { key: `field${n}`, title: KIND_LABEL[kind], kind, required: false, options: [] }
      ];
    });
  };

  const patchField = (idx: number, patch: Partial<CardField>): void => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const moveField = (idx: number, dir: -1 | 1): void => {
    setFields((prev) => {
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  };

  const removeField = (idx: number): void => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  /** JSON 文本 -> 构建器字段（导入 / 手改应用） */
  const applyJson = (text: string): boolean => {
    try {
      const obj = JSON.parse(text) as { properties?: unknown };
      if (typeof obj !== 'object' || obj === null || !obj.properties) {
        setError('JSON 须为含 properties 的对象');
        return false;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JSON 解析失败');
      return false;
    }
    setFields(parseSchemaFields(text));
    setJsonText(text);
    setError(null);
    return true;
  };

  const saveTemplate = async (): Promise<void> => {
    const json = tab === 'json' ? jsonText : schemaJson;
    if (tab === 'json' && !applyJson(jsonText)) return;
    try {
      await getAppContext().characterService.saveSchema(schema.id, json);
      onSaved(json);
    } catch (e) {
      void toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const exportFile = async (): Promise<void> => {
    setIoBusy(true);
    try {
      const path = await save({
        title: '导出 Schema 模板',
        filters: [{ name: 'Schema 模板', extensions: ['json'] }]
      });
      if (!path) return;
      await getAppContext().bridge.fs.writeFile(path, tab === 'json' ? jsonText : schemaJson);
    } catch (e) {
      void toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIoBusy(false);
    }
  };

  const importFile = async (): Promise<void> => {
    setIoBusy(true);
    try {
      const path = await open({
        title: '导入 Schema 模板',
        multiple: false,
        filters: [{ name: 'Schema 模板', extensions: ['json'] }]
      });
      if (!path || Array.isArray(path)) return;
      const text = await getAppContext().bridge.fs.readFile(path);
      if (applyJson(text)) setTab('build');
    } catch (e) {
      void toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIoBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[86vh] w-[min(980px,94vw)] flex-col rounded-lg bg-white shadow-xl">
        {/* 头部：模板名 + 视图切换 + 操作 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-3 py-2">
          <span className="text-sm font-medium">模板构建器 · {schema.name}</span>
          <div className="flex rounded border border-ink-200 text-[11px]">
            <button
              type="button"
              className={`px-2 py-0.5 ${tab === 'build' ? 'bg-violet-100 text-violet-700' : 'text-ink-500'}`}
              onClick={() => setTab('build')}
            >
              构建
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 ${tab === 'json' ? 'bg-violet-100 text-violet-700' : 'text-ink-500'}`}
              onClick={() => {
                setJsonText(schemaJson);
                setError(null);
                setTab('json');
              }}
            >
              JSON
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <button
              type="button"
              disabled={ioBusy}
              className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-100 disabled:opacity-50"
              onClick={() => void importFile()}
            >
              导入模板
            </button>
            <button
              type="button"
              disabled={ioBusy}
              className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-100 disabled:opacity-50"
              onClick={() => void exportFile()}
            >
              导出模板
            </button>
            <button
              type="button"
              className="rounded bg-violet-600 px-2.5 py-1 text-white hover:bg-violet-700"
              onClick={() => void saveTemplate()}
            >
              保存到本书
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-100"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>

        {tab === 'build' ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
            {/* 左：构建器 */}
            <div
              className="flex min-h-0 flex-col border-r border-ink-100"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const k = e.dataTransfer.getData('application/x-field-kind');
                if (isKind(k)) addField(k);
              }}
            >
              <div className="border-b border-ink-100 px-3 py-2">
                <div className="mb-1 text-[11px] text-ink-400">
                  拖拽类型到下方字段区，或直接点击添加
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FIELD_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/x-field-kind', k)}
                      onClick={() => addField(k)}
                      className="cursor-grab rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-700 hover:bg-violet-100 active:cursor-grabbing"
                    >
                      ＋ {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {fields.length === 0 && (
                  <div className="rounded border border-dashed border-ink-200 p-6 text-center text-xs text-ink-400">
                    暂无字段。拖拽上方类型到此区域添加。
                  </div>
                )}
                {fields.map((f, i) => (
                  <div key={`${f.key}-${i}`} className="mb-1.5 rounded border border-ink-100 bg-white p-1.5">
                    <div className="flex items-center gap-1">
                      <span className="cursor-grab text-ink-300" title="可用 ↑↓ 排序">
                        ≡
                      </span>
                      <input
                        value={f.key}
                        onChange={(e) => patchField(i, { key: e.target.value })}
                        placeholder="key（英文）"
                        spellCheck={false}
                        className="w-24 shrink-0 rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-violet-400"
                      />
                      <input
                        value={f.title}
                        onChange={(e) => patchField(i, { title: e.target.value })}
                        placeholder="显示标题"
                        className="min-w-0 flex-1 rounded border border-ink-200 px-1.5 py-0.5 text-xs outline-none focus:border-violet-400"
                      />
                      <select
                        value={f.kind}
                        onChange={(e) => patchField(i, { kind: e.target.value as FieldKind })}
                        className="shrink-0 rounded border border-ink-200 px-1 py-0.5 text-[11px]"
                      >
                        {FIELD_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      <label className="flex shrink-0 cursor-pointer items-center gap-0.5 text-[11px] text-ink-500">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) => patchField(i, { required: e.target.checked })}
                        />
                        必填
                      </label>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-ink-400 hover:text-violet-600 disabled:opacity-30"
                        disabled={i === 0}
                        onClick={() => moveField(i, -1)}
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-ink-400 hover:text-violet-600 disabled:opacity-30"
                        disabled={i === fields.length - 1}
                        onClick={() => moveField(i, 1)}
                        title="下移"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-ink-400 hover:text-red-600"
                        onClick={() => removeField(i)}
                        title="删除字段"
                      >
                        ×
                      </button>
                    </div>
                    {f.kind === 'select' && (
                      <input
                        value={f.options.join('、')}
                        onChange={(e) =>
                          patchField(i, { options: e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) })
                        }
                        placeholder="候选项（顿号分隔），如：主角、配角、反派"
                        className="mt-1 w-full rounded border border-ink-200 px-1.5 py-0.5 text-[11px] outline-none focus:border-violet-400"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* 右：实时预览 */}
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-ink-100 px-3 py-2 text-[11px] text-ink-400">
                实时预览（角色卡表单效果）
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-ink-50/50 p-3">
                {fields.length === 0 && (
                  <div className="text-center text-xs text-ink-400">添加字段后此处显示表单预览。</div>
                )}
                {fields.map((f, i) => (
                  <div key={`${f.key}-${i}`} className="mb-3">
                    <label className="mb-1 block text-xs font-medium text-ink-600">
                      {f.title || f.key}
                      {f.required && <span className="text-red-500"> *</span>}
                    </label>
                    {f.kind === 'textarea' ? (
                      <textarea
                        disabled
                        rows={3}
                        placeholder="多行文本…"
                        className="w-full resize-none rounded border border-ink-200 bg-white px-2 py-1 text-sm"
                      />
                    ) : f.kind === 'select' ? (
                      <select disabled className="w-full rounded border border-ink-200 bg-white px-2 py-1 text-sm">
                        {f.options.length === 0 && <option>请先配置候选项</option>}
                        {f.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : f.kind === 'tags' ? (
                      <input
                        disabled
                        placeholder="标签1、标签2（顿号分隔）"
                        className="w-full rounded border border-ink-200 bg-white px-2 py-1 text-sm"
                      />
                    ) : f.kind === 'number' ? (
                      <input
                        disabled
                        type="number"
                        placeholder="数字"
                        className="w-full rounded border border-ink-200 bg-white px-2 py-1 text-sm"
                      />
                    ) : (
                      <input
                        disabled
                        placeholder="单行文本…"
                        className="w-full rounded border border-ink-200 bg-white px-2 py-1 text-sm"
                      />
                    )}
                    <div className="mt-0.5 text-[10px] text-ink-300">
                      key: {f.key} · {KIND_LABEL[f.kind]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* JSON 视图：手改 + 应用 */
          <div className="flex min-h-0 flex-1 flex-col p-3">
            {error && <div className="mb-1 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{error}</div>}
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded border border-ink-200 p-2 font-mono text-xs outline-none focus:border-violet-400"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded bg-violet-600 px-2.5 py-1 text-xs text-white hover:bg-violet-700"
                onClick={() => {
                  if (applyJson(jsonText)) setTab('build');
                }}
              >
                应用到构建器
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
                onClick={() => {
                  setJsonText(schemaJson);
                  setError(null);
                }}
              >
                从构建器刷新
              </button>
              <span className="ml-auto text-[11px] text-ink-400">
                「保存到本书」会把当前 JSON 直接写入模板
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
