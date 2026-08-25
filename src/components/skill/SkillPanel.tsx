/**
 * Skill 勾选面板：列出全部 Skill，按书籍勾选启用；支持 Skill 包导入/导出
 */

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import type { SkillManifest } from '../../services/skill/types';
import { SkillPackService } from '../../services/skill/SkillPackService';
import type { ImportOptions, SkillPreview } from '../../services/skill/SkillPackService';
import { SkillCreateDialog } from './SkillCreateDialog';

const MODE_LABEL: Record<string, string> = {
  continue: '续写',
  rewrite: '改写',
  dialogue: '对白',
  check: '检查'
};

/** Skill 包文件选择器过滤条件（标准 zip 与自定义 skillpack 扩展名均可） */
const PACK_FILTERS = [{ name: 'Skill 包', extensions: ['zip', 'skillpack'] }];

/** 导入预览弹窗状态 */
interface ImportState {
  path: string;
  preview: SkillPreview;
}

export function SkillPanel({ bookId }: { bookId: string }): JSX.Element {
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [importing, setImporting] = useState<ImportState | null>(null);
  const [importChoice, setImportChoice] = useState<'overwrite' | 'rename'>('overwrite');
  const [renameTo, setRenameTo] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = async (): Promise<void> => {
    const ctx = getAppContext();
    setSkills([...ctx.skillLoader.all].sort((a, b) => b.priority - a.priority));
    setEnabled(await ctx.bookService.getEnabledSkills(bookId));
  };

  useEffect(() => {
    void load();
    // Skill 目录热重载
    const unwatch = ctxWatch();
    return unwatch;
    function ctxWatch(): () => void {
      const ctx = getAppContext();
      return ctx.skillLoader.watch(() => {
        void load();
      });
    }
  }, [bookId]);

  const toggle = async (name: string): Promise<void> => {
    const next = enabled.includes(name) ? enabled.filter((n) => n !== name) : [...enabled, name];
    setEnabled(next);
    await getAppContext().bookService.setEnabledSkills(bookId, next);
  };

  const reload = async (): Promise<void> => {
    await getAppContext().skillLoader.reload();
    await load();
  };

  /** SkillPackService（skillsDir 取自 skillLoader.dir，由装配方解析） */
  const packService = (): SkillPackService => {
    const ctx = getAppContext();
    return new SkillPackService(ctx.bridge, ctx.skillLoader.dir);
  };

  /** 选择包文件并预览 */
  const chooseImport = async (): Promise<void> => {
    setNotice(null);
    setError(null);
    const path = await open({ multiple: false, filters: PACK_FILTERS });
    if (typeof path !== 'string') return;
    try {
      const preview = await packService().previewPack(path);
      setImportChoice('overwrite');
      setRenameTo('');
      setImporting({ path, preview });
    } catch (e) {
      setError(`包解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 确认导入（已存在时可选覆盖 / 重命名） */
  const confirmImport = async (): Promise<void> => {
    if (!importing) return;
    const options: ImportOptions = {};
    if (importing.preview.alreadyExists) {
      if (importChoice === 'overwrite') {
        options.overwrite = true;
      } else {
        const name = renameTo.trim();
        if (!name) {
          setError('请输入新的 Skill 名称');
          return;
        }
        options.renameTo = name;
      }
    }
    try {
      const r = await packService().importPack(importing.path, options);
      setImporting(null);
      setError(null);
      await reload(); // 重扫 Skill 目录并刷新列表
      setNotice(`导入成功：${r.name}${r.overwritten ? '（已覆盖同名 Skill）' : ''}`);
    } catch (e) {
      setError(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 导出单个 Skill 为包文件 */
  const exportSkill = async (e: MouseEvent<HTMLButtonElement>, name: string): Promise<void> => {
    // 阻止触发所在 label 的勾选切换
    e.preventDefault();
    e.stopPropagation();
    setNotice(null);
    setError(null);
    const path = await save({ defaultPath: `${name}.zip`, filters: PACK_FILTERS });
    if (!path) return;
    try {
      const count = await packService().exportPack(name, path);
      setNotice(`已导出「${name}」（${count} 个文件）：${path}`);
    } catch (err) {
      setError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">文风 Skill（{skills.length}）</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
            onClick={() => setShowCreate(true)}
          >
            新建
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
            onClick={() => void chooseImport()}
          >
            导入
          </button>
          <button
            type="button"
            className="text-xs text-violet-600 hover:underline"
            onClick={() => void reload()}
          >
            重新扫描
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-2 rounded bg-ink-50 p-2 text-[11px] text-ink-500">
          Skill 目录：{getAppContext().skillLoader.dir}
          <br />
          勾选后按 applies_to 在对应 AI 模式注入 Prompt；一致性检查不注入文风。
        </div>
        {notice && (
          <div className="mb-2 rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">{notice}</div>
        )}
        {error && (
          <div className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</div>
        )}
        {skills.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-ink-400">
            未发现 Skill。放置 SKILL.md 到 Skill 目录后点「重新扫描」。
          </div>
        )}
        {skills.map((s) => (
          <label
            key={s.name}
            className="mb-1 flex cursor-pointer items-start gap-2 rounded border border-ink-100 bg-white px-2 py-1.5 hover:border-violet-300"
          >
            <input
              type="checkbox"
              checked={enabled.includes(s.name)}
              onChange={() => void toggle(s.name)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-500">
                  P{s.priority}
                </span>
                <button
                  type="button"
                  className="ml-auto rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500 hover:bg-ink-100"
                  onClick={(e) => void exportSkill(e, s.name)}
                >
                  导出
                </button>
              </div>
              <div className="text-xs text-ink-400">{s.description}</div>
              <div className="mt-0.5 flex gap-1">
                {s.appliesTo.map((m) => (
                  <span key={m} className="rounded bg-violet-50 px-1 text-[10px] text-violet-600">
                    {MODE_LABEL[m] ?? m}
                  </span>
                ))}
              </div>
            </div>
          </label>
        ))}
      </div>

      {importing && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
          onClick={() => setImporting(null)}
        >
          <div
            className="w-[400px] rounded-lg bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-base font-medium">导入 Skill 包</div>
            <div className="space-y-1 text-sm">
              <div className="flex gap-2">
                <span className="w-16 shrink-0 text-xs leading-5 text-ink-500">名称</span>
                <span className="min-w-0 flex-1 break-all font-medium">{importing.preview.name}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-16 shrink-0 text-xs leading-5 text-ink-500">描述</span>
                <span className="min-w-0 flex-1 break-all text-ink-600">
                  {importing.preview.description || '（无）'}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="w-16 shrink-0 text-xs leading-5 text-ink-500">适用模式</span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1 leading-5">
                  {importing.preview.appliesTo.length > 0 ? (
                    importing.preview.appliesTo.map((m) => (
                      <span
                        key={m}
                        className="rounded bg-violet-50 px-1 text-[10px] text-violet-600"
                      >
                        {MODE_LABEL[m] ?? m}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-ink-400">（未指定）</span>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="w-16 shrink-0 text-xs leading-5 text-ink-500">优先级</span>
                <span className="flex-1">P{importing.preview.priority}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-16 shrink-0 text-xs leading-5 text-ink-500">附属资源</span>
                <span className="flex-1">{importing.preview.resourceCount} 个文件</span>
              </div>
            </div>

            {importing.preview.alreadyExists && (
              <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-700">
                已存在同名 Skill，请选择处理方式：
                <div className="mt-1 flex flex-col gap-1">
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="radio"
                      checked={importChoice === 'overwrite'}
                      onChange={() => setImportChoice('overwrite')}
                    />
                    覆盖导入（替换同名 Skill 的同名文件）
                  </label>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="radio"
                      checked={importChoice === 'rename'}
                      onChange={() => setImportChoice('rename')}
                    />
                    重命名为
                  </label>
                  {importChoice === 'rename' && (
                    <input
                      type="text"
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                      placeholder="输入新的 Skill 名称"
                      autoFocus
                      className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
                    />
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</div>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
                onClick={() => setImporting(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
                onClick={() => void confirmImport()}
              >
                导入
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <SkillCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            void load();
          }}
        />
      )}
    </div>
  );
}
