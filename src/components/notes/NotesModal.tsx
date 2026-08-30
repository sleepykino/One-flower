/**
 * 随手记 / 备忘录（全局）：编辑器顶栏「随手记」弹出的独立浮窗
 * - 左侧备忘录列表（置顶优先），右侧 markdown 编辑 / 预览
 * - 图片附件：粘贴 / 拖拽 / 选择上传，文件落盘 appDataDir/notes/{note_id}/
 * - 链接：直接粘贴 URL 文本，预览时自动转可点击链接
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, ImagePlus, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { renderMarkdown } from '../../utils/markdown';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import type { Note, NoteAttachment } from '../../services/notes/NotesService';

type NotesView = 'edit' | 'preview';

/** 裸 URL -> markdown 链接（跳过已在 [x](url) 内的），供预览点击跳转 */
function linkify(src: string): string {
  return src.replace(/(^|[^(\w])(https?:\/\/[^\s)<>]+)/g, '$1[$2]($2)');
}

export function NotesModal({ onClose }: { onClose: () => void }): JSX.Element {
  const svc = getAppContext().notesService;

  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [orig, setOrig] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<NotesView>('edit');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const urlMapRef = useRef<Record<string, string>>({});

  const active = notes.find((n) => n.id === activeId) ?? null;
  const dirty = content !== orig;

  const reload = async (): Promise<Note[]> => {
    const list = await svc.list();
    setNotes(list);
    if (!list.some((n) => n.id === activeId)) {
      setActiveId(list[0]?.id ?? null);
    }
    return list;
  };

  const reloadAttachments = async (noteId: string): Promise<void> => {
    const atts = await svc.attachmentsOf(noteId);
    setAttachments(atts);
    // 旧 blob URL 释放后重建（避免泄漏）
    for (const url of Object.values(urlMapRef.current)) URL.revokeObjectURL(url);
    const map: Record<string, string> = {};
    for (const a of atts) map[a.id] = await svc.attachmentUrl(a);
    urlMapRef.current = map;
    setUrlMap(map);
  };

  const selectNote = async (note: Note, force = false): Promise<void> => {
    if (!force && dirty && !(await confirmDialog('当前备忘录有未保存的修改，确定放弃并切换？'))) return;
    setActiveId(note.id);
    setContent(note.content);
    setOrig(note.content);
    setView('edit');
    await reloadAttachments(note.id);
  };

  useEffect(() => {
    void (async () => {
      try {
        const list = await reload();
        const target = list[0];
        if (target) {
          setActiveId(target.id);
          setContent(target.content);
          setOrig(target.content);
          await reloadAttachments(target.id);
        }
      } catch (e) {
        toast.error(`读取备忘录失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoaded(true);
      }
    })();
    return () => {
      for (const url of Object.values(urlMapRef.current)) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (): Promise<void> => {
    if (dirty && !(await confirmDialog('当前备忘录有未保存的修改，确定放弃并新建？'))) return;
    const note = await svc.create('');
    setNotes((prev) => [note, ...prev]);
    await selectNote(note, true);
    toast.success('已新建备忘录');
  };

  const save = async (): Promise<void> => {
    if (!active) return;
    setSaving(true);
    try {
      await svc.updateContent(active.id, content);
      setOrig(content);
      setNotes((prev) =>
        prev.map((n) => (n.id === active.id ? { ...n, content, updatedAt: Date.now() } : n))
      );
      toast.success('已保存');
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const togglePin = async (): Promise<void> => {
    if (!active) return;
    const next = !active.pinned;
    await svc.setPinned(active.id, next);
    setNotes((prev) => prev.map((n) => (n.id === active.id ? { ...n, pinned: next } : n)));
    const list = await reload();
    const target = list.find((n) => n.id === active.id);
    if (target) await selectNote(target, true);
  };

  const remove = async (): Promise<void> => {
    if (!active) return;
    if (!(await confirmDialog('确定删除这条备忘录？图片附件会一并删除，且不可恢复。'))) return;
    try {
      await svc.remove(active.id);
      for (const url of Object.values(urlMapRef.current)) URL.revokeObjectURL(url);
      urlMapRef.current = {};
      setUrlMap({});
      const list = await reload();
      const target = list[0] ?? null;
      setActiveId(target?.id ?? null);
      setContent(target?.content ?? '');
      setOrig(target?.content ?? '');
      if (target) await reloadAttachments(target.id);
      toast.success('已删除');
    } catch (e) {
      toast.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const uploadFiles = async (files: File[]): Promise<void> => {
    if (!active || files.length === 0) return;
    setBusy(true);
    try {
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        await svc.addAttachment(active.id, { name: f.name, mime: f.type || 'image/png', bytes });
      }
      await reloadAttachments(active.id);
      toast.success(`已添加 ${files.length} 张图片`);
    } catch (e) {
      toast.error(`图片上传失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const removeAttachment = async (att: NoteAttachment): Promise<void> => {
    await svc.removeAttachment(att);
    const url = urlMapRef.current[att.id];
    if (url) URL.revokeObjectURL(url);
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
  };

  const onPaste = (e: React.ClipboardEvent): void => {
    if (!active) return;
    const img = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith('image/'));
    const file = img?.getAsFile();
    if (file) {
      e.preventDefault();
      void uploadFiles([file]);
    }
  };
  const onDrop = (e: React.DragEvent): void => {
    if (!active) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) void uploadFiles(files);
  };

  // Ctrl+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (active && dirty && !saving) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const requestClose = async (): Promise<void> => {
    if (!dirty || (await confirmDialog('有未保存的修改，确定放弃并关闭？'))) onClose();
  };

  const previewHtml = useMemo(() => renderMarkdown(linkify(content.trim() !== '' ? content : '_暂无内容_')), [content]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = (
    <div className="flex h-full min-h-0 flex-1 flex-col" onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      {view === 'edit' && (
        <textarea
          className="min-h-0 flex-1 resize-none bg-white p-4 font-mono text-xs leading-relaxed text-ink-800 focus:outline-none"
          placeholder={'随手记…（支持 markdown；直接粘贴链接 / 拖入或粘贴图片）\n\n全局共享，跨书可用，编辑器顶栏「随手记」随时打开。'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      )}
      {view === 'preview' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white p-4 text-sm leading-relaxed text-ink-800" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      )}

      {/* 图片附件区 */}
      <div className="border-t border-ink-100 bg-ink-50/40 p-2">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[11px] font-medium text-ink-500">图片附件（{attachments.length}）</span>
          <button
            type="button"
            disabled={!active || busy}
            className="flex items-center gap-1 rounded border border-ink-200 bg-white px-2 py-0.5 text-[11px] text-ink-600 hover:bg-ink-100 disabled:opacity-40"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={12} /> 添加图片
          </button>
          <span className="text-[10px] text-ink-400">支持粘贴剪贴板图片 / 拖入文件</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length > 0) void uploadFiles(files);
            }}
          />
        </div>
        {attachments.length === 0 ? (
          <div className="text-[11px] text-ink-400">暂无图片。</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="group relative">
                <img src={urlMap[a.id]} alt={a.fileName} className="h-20 w-20 rounded border border-ink-200 object-cover" />
                <button
                  type="button"
                  className="absolute right-0.5 top-0.5 hidden rounded bg-black/60 p-0.5 text-white group-hover:block"
                  title="删除图片"
                  onClick={() => void removeAttachment(a)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex h-full max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-ink-900">随手记 · 备忘录</div>
            <div className="text-xs text-ink-500">全局跨书共享 · 文本 / 图片 / 链接 · 图片存于应用数据目录</div>
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-violet-600 px-2.5 py-1 text-xs text-white hover:bg-violet-700"
              onClick={() => void create()}
            >
              + 新建
            </button>
            {loaded && <span className="text-[11px] text-ink-400">共 {notes.length} 条</span>}
          </div>
          <div className="flex items-center gap-2">
            {active && (
              <>
                <button
                  type="button"
                  className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
                    active.pinned ? 'border-violet-300 text-violet-700' : 'border-ink-200 text-ink-500 hover:bg-ink-100'
                  }`}
                  title={active.pinned ? '取消置顶' : '置顶'}
                  onClick={() => void togglePin()}
                >
                  {active.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                  {active.pinned ? '已置顶' : '置顶'}
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-ink-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                  onClick={() => void remove()}
                >
                  <Trash2 size={13} /> 删除
                </button>
              </>
            )}
          </div>
        </div>

        {/* 主体 */}
        {loaded && (
          <div className="flex min-h-0 flex-1">
            {/* 备忘录列表 */}
            <div className="flex w-60 flex-col overflow-y-auto border-r border-ink-100 bg-ink-50/40">
              {notes.length === 0 && (
                <div className="p-4 text-[11px] leading-relaxed text-ink-400">
                  还没有备忘录。点「+ 新建」，随手记下想法、摘抄片段或图片。
                </div>
              )}
              {notes.map((n) => {
                const title = n.content.trim().split('\n').find((l) => l.trim() !== '')?.slice(0, 24) ?? '（空白备忘）';
                const time = new Date(n.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`flex w-full items-start gap-1.5 border-b border-ink-100 px-3 py-2 text-left ${
                      n.id === activeId ? 'bg-violet-50' : 'hover:bg-ink-100'
                    }`}
                    onClick={() => void selectNote(n)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs ${n.id === activeId ? 'text-violet-800' : 'text-ink-700'}`}>
                        {title}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-ink-400">
                        {n.pinned && <Pin size={10} className="text-violet-500" />}
                        {time}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 编辑区 */}
            <div className="flex min-w-0 flex-1 flex-col">
              {active ? (
                <>
                  <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
                    <div className="flex overflow-hidden rounded border border-ink-200">
                      {(['edit', 'preview'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={`flex items-center gap-1 px-2.5 py-1 text-xs ${
                            view === v ? 'bg-violet-100 text-violet-700' : 'text-ink-500 hover:bg-ink-100'
                          }`}
                          onClick={() => setView(v)}
                        >
                          {v === 'edit' ? <Pencil size={12} /> : <Eye size={12} />}
                          {v === 'edit' ? '编辑' : '预览'}
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] text-ink-400">更新于 {new Date(active.updatedAt).toLocaleString('zh-CN')}</span>
                  </div>
                  {editor}
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-ink-400">
                  选择左侧备忘录，或点「+ 新建」开始记录。
                </div>
              )}
            </div>
          </div>
        )}

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
              disabled={!active || !dirty || saving}
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