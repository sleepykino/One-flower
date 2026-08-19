/**
 * 全局提示词子区块（从原设置页迁移，P2.1-M1）
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { alertDialog, confirmDialog } from '../../native/dialog';
import type { GlobalPromptItem } from '../../services/ai/GlobalPromptService';
import { countTokens } from '../../utils/tokens';

const GP_BUDGET = 600;

export function GlobalPromptsSection(): JSX.Element {
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

  return (
    <div>
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
    </div>
  );
}
