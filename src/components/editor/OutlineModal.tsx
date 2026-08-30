/**
 * 全书大纲编辑器（G1）：storage_dir/outline.md 的编辑弹窗
 * - 编辑 / 预览 / 分屏三视图，实时 markdown 渲染（交互对齐 DirectiveModal）
 * - 保存后注入四模式生成（applyCtxExtras）与长文节拍规划；随书备份（v3 兼容扩展）
 * - 整行 HTML 注释为写法参照，不注入 AI 上下文
 */

import { useEffect, useMemo, useState } from 'react';
import { Eye, Columns2, Pencil, X } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { OUTLINE_TEMPLATE } from '../../services/outline/BookOutlineService';
import { renderMarkdown } from '../../utils/markdown';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';

type OutlineView = 'edit' | 'preview' | 'split';

/** 轻量分段切换（对齐 DirectiveModal.Segmented 样式） */
function Segmented({
  value,
  onChange,
  items
}: {
  value: string;
  onChange: (v: string) => void;
  items: Array<{ value: string; label: string; icon: JSX.Element }>;
}): JSX.Element {
  return (
    <div className="flex overflow-hidden rounded border border-ink-200">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className={`flex items-center gap-1 px-2.5 py-1 text-xs ${
            value === it.value ? 'bg-violet-100 text-violet-700' : 'text-ink-500 hover:bg-ink-100'
          }`}
          onClick={() => onChange(it.value)}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** 注入开关（随书持久化；关闭后大纲仅保留在本书，不再注入 AI 生成） */
function Toggle({ checked, onToggle }: { checked: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="注入 AI 生成"
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-violet-600' : 'bg-ink-200'
      }`}
      onClick={onToggle}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function OutlineModal({ bookId, onClose }: { bookId: string; onClose: () => void }): JSX.Element {
  const [outline, setOutline] = useState('');
  const [orig, setOrig] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<OutlineView>('split');
  const [saving, setSaving] = useState(false);
  /** 注入开关：关闭后大纲不注入四模式生成与长文节拍规划（随书持久化） */
  const [injectEnabled, setInjectEnabled] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [text, enabled] = await Promise.all([
          getAppContext().outlineService.getOutline(bookId),
          getAppContext().outlineService.isInjectionEnabled(bookId)
        ]);
        setOutline(text);
        setOrig(text);
        setInjectEnabled(enabled);
      } catch (e) {
        toast.error(`读取大纲失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoaded(true);
      }
    })();
  }, [bookId]);

  const dirty = outline !== orig;
  const effectiveChars = useMemo(
    () =>
      outline
        .split('\n')
        .filter((l) => !/^\s*<!--.*-->\s*$/.test(l))
        .join('\n')
        .replace(/\s/g, '').length,
    [outline]
  );

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await getAppContext().outlineService.saveOutline(bookId, outline);
      setOrig(outline);
      toast.success(
        injectEnabled && effectiveChars > 0
          ? '大纲已保存，将注入本书 AI 生成'
          : injectEnabled
            ? '大纲已保存（当前无有效正文，暂不注入）'
            : '大纲已保存（注入开关已关闭，暂不注入 AI 生成）'
      );
      onClose();
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  /** 切换注入开关（立即持久化，无需等待保存） */
  const toggleInject = async (): Promise<void> => {
    const next = !injectEnabled;
    setInjectEnabled(next);
    try {
      await getAppContext().outlineService.setInjectionEnabled(bookId, next);
      toast.success(next ? '大纲注入已开启' : '大纲注入已关闭：续写 / 改写 / 对白 / 检查 / 长文将不再注入全书大纲');
    } catch (e) {
      setInjectEnabled(!next);
      toast.error(`开关切换失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const insertTemplate = async (): Promise<void> => {
    const ok = await confirmDialog(
      '将填入示例模板（示例条目已注释，不会注入 AI）。请改写为本书实际内容后保存——保存后大纲会作为前瞻约束注入续写 / 改写 / 对白 / 检查 / 长文。确定插入？'
    );
    if (ok) setOutline(OUTLINE_TEMPLATE);
  };

  const requestClose = async (): Promise<void> => {
    if (!dirty || (await confirmDialog('有未保存的修改，确定放弃并关闭？'))) onClose();
  };

  // Ctrl+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && !saving) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const textarea = (
    <textarea
      className="h-full w-full resize-none bg-white p-4 font-mono text-xs leading-relaxed text-ink-800 focus:outline-none"
      placeholder={'写全书的故事走向：主线三幕 / 各卷要点 / 关键伏笔 / 结局方向……（支持 markdown）\n\n保存后（且上方「注入 AI 生成」开启时）会注入本书所有 AI 生成，续写将与本章在大纲中的定位对齐。'}
      value={outline}
      onChange={(e) => setOutline(e.target.value)}
    />
  );
  const preview = (
    <div
      className="h-full w-full overflow-y-auto bg-white p-4 text-sm leading-relaxed text-ink-800"
      dangerouslySetInnerHTML={{
        __html: renderMarkdown(outline.trim() !== '' ? outline : '_暂无内容_')
      }}
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex h-full max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-ink-900">全书大纲</div>
            <div className="text-xs text-ink-500">
              outline.md · 开启后作为前瞻约束注入续写 / 改写 / 对白 / 检查 / 长文节拍规划 · 随书保存与备份
            </div>
          </div>
          <button
            type="button"
            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            onClick={() => void requestClose()}
          >
            <X size={18} />
          </button>
        </div>

        {/* 工具条 */}
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
          <Segmented
            value={view}
            onChange={(v) => setView(v as OutlineView)}
            items={[
              { value: 'edit', label: '编辑', icon: <Pencil size={13} /> },
              { value: 'split', label: '分屏', icon: <Columns2 size={13} /> },
              { value: 'preview', label: '预览', icon: <Eye size={13} /> }
            ]}
          />
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-ink-400">有效正文约 {effectiveChars} 字（注释不计）</span>
            <label
              className={`flex cursor-pointer items-center gap-1.5 text-[11px] ${
                injectEnabled ? 'text-ink-700' : 'text-ink-400'
              }`}
              title="关闭后：续写 / 改写 / 对白 / 检查 / 长文不再注入本书大纲（大纲仍保留在本书）"
            >
              <Toggle checked={injectEnabled} onToggle={() => void toggleInject()} />
              注入 AI 生成
            </label>
            <button type="button" className="text-xs text-violet-600 hover:underline" onClick={() => void insertTemplate()}>
              插入示例
            </button>
          </div>
        </div>

        {/* 状态提示 */}
        {loaded && (
          <div
            className={`border-b px-4 py-2 text-[11px] leading-relaxed ${
              injectEnabled
                ? 'border-amber-100 bg-amber-50/60 text-amber-700'
                : 'border-ink-200 bg-ink-50/60 text-ink-500'
            }`}
          >
            {injectEnabled ? (
              orig.trim() === '' ? (
                '尚未编写全书大纲，当前不会注入 AI。写清主线三幕、各卷要点与关键伏笔后，AI 续写将主动对齐本章在全书中的定位，减少剧情跑偏。可点「插入示例」参考——示例已注释，不会生效。'
              ) : (
                '正在注入：续写 / 改写 / 对白 / 检查 / 长文节拍规划会带入本书大纲作前瞻约束。'
              )
            ) : (
              '注入开关已关闭：续写 / 改写 / 对白 / 检查 / 长文将不注入本书大纲（如需恢复请打开开关）。'
            )}
          </div>
        )}

        {/* 编辑区 */}
        <div className="flex min-h-0 flex-1">
          {view === 'edit' && textarea}
          {view === 'preview' && preview}
          {view === 'split' && (
            <>
              <div className="min-w-0 flex-1 border-r border-ink-100">{textarea}</div>
              <div className="min-w-0 flex-1">{preview}</div>
            </>
          )}
        </div>

        {/* 底栏 */}
        <div className="flex items-center justify-between border-t border-ink-200 px-4 py-2.5 text-xs">
          <span className="text-ink-400">
            {dirty ? (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> 有未保存的修改（Ctrl+S 保存）
              </span>
            ) : (
              '修改已保存'
            )}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-ink-200 px-3 py-1.5 text-ink-600 hover:bg-ink-100"
              onClick={() => void requestClose()}
            >
              取消
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              className="rounded bg-violet-600 px-4 py-1.5 text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void save()}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
