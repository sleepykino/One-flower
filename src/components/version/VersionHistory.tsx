/**
 * 版本历史面板：版本列表（时间倒序）+ 预览 + 对比 + 一键回退
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { useEditorStore } from '../../store/editorStore';
import type { ChapterVersionMeta } from '../../services/chapter/ChapterVersionStore';
import type { TextDiffResult } from '../../utils/diff';
import { docToPlainText } from '../../utils/pmdoc';

export function VersionHistory(): JSX.Element {
  const currentChapterId = useEditorStore((s) => s.currentChapterId);
  const [versions, setVersions] = useState<ChapterVersionMeta[]>([]);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [diff, setDiff] = useState<TextDiffResult | null>(null);
  const [compareFrom, setCompareFrom] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    if (!currentChapterId) return;
    const vs = await getAppContext().versionStore.listVersions(currentChapterId);
    setVersions(vs);
  };

  useEffect(() => {
    setPreviewText(null);
    setDiff(null);
    setCompareFrom(null);
    void load();
  }, [currentChapterId]);

  const preview = async (versionId: string): Promise<void> => {
    const doc = await getAppContext().versionStore.getVersion(versionId);
    setPreviewText(docToPlainText(doc));
    setDiff(null);
  };

  const compare = async (versionId: string): Promise<void> => {
    if (!compareFrom) {
      setCompareFrom(versionId);
      return;
    }
    if (compareFrom === versionId) {
      setCompareFrom(null);
      return;
    }
    const result = await getAppContext().versionStore.diff(compareFrom, versionId);
    // 展示为「旧 → 新」
    setDiff(result);
    setPreviewText(null);
    setCompareFrom(null);
  };

  const restore = async (versionId: string): Promise<void> => {
    if (!(await confirmDialog('回退后当前正文将被覆盖（会先存为历史版本），确认回退？'))) return;
    const doc = await getAppContext().versionStore.restore(versionId);
    useEditorStore.getState().editorApi?.setContent(doc);
    await load();
  };

  // GC 手动触发
  const gc = async (): Promise<void> => {
    if (!currentChapterId) return;
    await getAppContext().versionStore.gc(currentChapterId, 50, 1);
    await load();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">版本历史（{versions.length}）</span>
        <button type="button" className="text-xs text-violet-600 hover:underline" onClick={() => void gc()}>
          清理旧版本
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {versions.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-ink-400">
            暂无版本。编辑正文停顿 3 秒自动保存并生成版本快照。
          </div>
        )}
        {versions.map((v) => (
          <div
            key={v.id}
            className={`mb-1 flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
              compareFrom === v.id ? 'border-violet-400 bg-violet-50' : 'border-ink-100 bg-white'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-ink-700">{new Date(v.createdAt).toLocaleString()}</div>
              <div className="text-ink-400">{v.wordCount} 字</div>
            </div>
            <button type="button" className="text-violet-600 hover:underline" onClick={() => void preview(v.id)}>
              预览
            </button>
            <button type="button" className="text-violet-600 hover:underline" onClick={() => void compare(v.id)}>
              {compareFrom ? '对比到此' : '对比'}
            </button>
            <button type="button" className="text-red-500 hover:underline" onClick={() => void restore(v.id)}>
              回退
            </button>
          </div>
        ))}
        {compareFrom && (
          <div className="mt-1 rounded bg-violet-50 p-2 text-[11px] text-violet-600">
            已选基准版本，点击另一版本的「对比到此」
          </div>
        )}
      </div>
      {(previewText !== null || diff) && (
        <div className="max-h-72 shrink-0 overflow-y-auto border-t border-ink-200 bg-ink-50 p-2">
          {previewText !== null && (
            <pre className="whitespace-pre-wrap text-xs text-ink-700">{previewText || '（空文档）'}</pre>
          )}
          {diff && (
            <div className="text-xs">
              <div className="mb-1 text-ink-500">
                +{diff.added} / -{diff.removed}
              </div>
              {diff.hunks.map((h, i) => (
                <div key={i} className={h.type === 'add' ? 'diff-add' : h.type === 'remove' ? 'diff-remove' : 'text-ink-400'}>
                  {h.content}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
