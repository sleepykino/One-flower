/**
 * 一把炼化页（P7.4）：从文本 / 书籍提炼文风 Skill
 * 定位与灵感库一致——「激发而非替代」：提炼风格指令，不复制内容。
 * 状态机：idle -> confirming -> running -> preview（失败回 idle 并报错）。
 * M1：来源选择 + 参数区 + 模型禁用态 + 隐私首提；M2：预估确认弹窗 + 执行链（进度/取消）。
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import {
  ClipboardPaste,
  FileText,
  BookOpen,
  Flame,
  AlertTriangle,
  Loader2,
  X
} from 'lucide-react';
import { HomeSidebar } from '../components/home/HomeSidebar';
import { ForgeConfirmDialog } from '../components/skillforge/ForgeConfirmDialog';
import { ForgePreviewDialog } from '../components/skillforge/ForgePreviewDialog';
import { getAppContext } from '../context/app-context';
import { confirmDialog } from '../native/dialog';
import { toast } from '../components/common/toast';
import {
  MAX_PASTE_CHARS,
  MAX_FILE_BYTES,
  FOCUS_MAX_CHARS
} from '../services/skill/SkillForgeService';
import type {
  SkillForgeEstimate,
  SkillForgeProgress,
  SkillForgeDraft,
  SkillForgeSource
} from '../services/skill/SkillForgeService';
import {
  resolveProviderConfigIdForFeature,
  resolveDefaultProviderConfigId
} from '../services/ai/providerResolver';
import { parseDocument, blocksPlainText } from '../services/import/DocParse';
import type { Book } from '../types';

type SourceKind = 'paste' | 'file' | 'book';

const PRIVACY_ACK_KEY = 'skillforge.privacyAck';

/** 进度文案映射（running 态） */
function progressText(p: SkillForgeProgress | null): string {
  if (!p) return '正在准备…';
  switch (p.phase) {
    case 'reading':
      return '正在读取素材…';
    case 'sampling':
      return '正在采样…';
    case 'forging':
      return '正在提炼…';
    case 'observing':
      return `第 ${p.current}/${p.total} 片 · 风格观测`;
    case 'synthesizing':
      return '正在汇总合成…';
    default:
      return '正在提炼…';
  }
}

export function SkillForge(): JSX.Element {
  const navigate = useNavigate();
  // 素材来源（三互斥）
  const [sourceKind, setSourceKind] = useState<SourceKind>('paste');
  const [pasteText, setPasteText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const fileTextRef = useRef(''); // 上传文件解析后的纯文本（不进 state 展示）
  const [books, setBooks] = useState<Book[]>([]);
  const [bookId, setBookId] = useState('');
  const [markSource, setMarkSource] = useState(true);
  // 提炼侧重（可选）
  const [focus, setFocus] = useState('');
  // 智能采样（页内 state，不持久化）
  const [sample, setSample] = useState(true);
  // 模型可用性探测
  const [modelName, setModelName] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  // 状态机
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'running' | 'preview'>('idle');
  const [error, setError] = useState<string | null>(null);
  // M2：预估与执行
  const [estimate, setEstimate] = useState<SkillForgeEstimate | null>(null);
  const [modelNote, setModelNote] = useState('默认配置');
  const [progress, setProgress] = useState<SkillForgeProgress | null>(null);
  const [draft, setDraft] = useState<SkillForgeDraft | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 挂载：探测模型 + 拉取书架
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ctx = getAppContext();
        const m = await ctx.skillForgeService.modelName();
        if (alive) setModelName(m);
      } catch (e) {
        if (alive) setModelError(e instanceof Error ? e.message : String(e));
      }
      try {
        const ctx = getAppContext();
        const list = await ctx.bookService.list();
        if (alive) {
          setBooks(list);
          if (list.length > 0) setBookId(list[0].id);
        }
      } catch {
        // 书架加载失败不阻塞页面
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pasteOver = pasteText.length > MAX_PASTE_CHARS;
  const selectedBook = books.find((b) => b.id === bookId);

  /** 当前 UI 状态 -> SkillForgeSource */
  const buildSource = (): SkillForgeSource | null => {
    if (sourceKind === 'book') {
      if (!bookId) return null;
      return { kind: 'book', bookId, title: selectedBook?.title ?? '' };
    }
    const text = sourceKind === 'file' ? fileTextRef.current : pasteText.trim();
    if (!text.trim()) return null;
    return { kind: 'text', text: text.trim() };
  };

  /** 素材来源描述（确认弹窗展示） */
  const sourceLabel = (): string => {
    if (sourceKind === 'book') return `《${selectedBook?.title ?? ''}》`;
    if (sourceKind === 'file') return `上传文件 ${fileName}`;
    const n = pasteText.trim().length;
    return `粘贴文本（${n.toLocaleString()} 字）`;
  };

  /** 上传文件：走原生文件选择，txt 直接读、md 剥语法标记取正文 */
  const pickFile = async (): Promise<void> => {
    const path = await open({
      multiple: false,
      filters: [{ name: '文本文档', extensions: ['txt', 'md', 'markdown'] }]
    });
    if (typeof path !== 'string') return;
    try {
      const ctx = getAppContext();
      const content = await ctx.bridge.fs.readFile(path);
      const bytes = new TextEncoder().encode(content).length;
      if (bytes > MAX_FILE_BYTES) {
        void toast.error('文件超过 5MB 上限，请选择更短的文本');
        setFileName('');
        fileTextRef.current = '';
        return;
      }
      let plain = content;
      if (/\.(md|markdown)$/i.test(path)) {
        const chapters = parseDocument(content, { markdown: true });
        plain = chapters.map((c) => blocksPlainText(c.blocks)).join('\n\n');
      }
      fileTextRef.current = plain;
      setFileName(path.split(/[\\/]/).pop() ?? path);
      setFileSize(bytes);
    } catch (e) {
      void toast.error(`读取文件失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 当前来源是否已有素材 */
  const sourceReady = (): boolean => {
    if (sourceKind === 'paste') return pasteText.trim().length > 0;
    if (sourceKind === 'file') return fileTextRef.current.trim().length > 0;
    return !!bookId;
  };

  /** 开启采样快捷按钮：改 state 后重算预估并重开确认弹窗 */
  const enableSample = async (): Promise<void> => {
    setSample(true);
    await computeEstimate(true);
  };

  /** 读取素材并估算（确认弹窗数据） */
  const computeEstimate = async (sampleOn: boolean): Promise<void> => {
    const ctx = getAppContext();
    const source = buildSource();
    if (!source) return;
    const est = await ctx.skillForgeService.estimate(source, sampleOn);
    // 模型是否功能绑定（未绑定则默认配置）
    const bookIdFor = source.kind === 'book' ? source.bookId : '';
    const [boundId, defaultId] = await Promise.all([
      resolveProviderConfigIdForFeature(ctx.bridge, bookIdFor, 'skill-forge'),
      resolveDefaultProviderConfigId(ctx.bridge)
    ]);
    setModelNote(boundId === defaultId ? '默认配置' : '功能绑定');
    setEstimate(est);
    setPhase('confirming');
  };

  /** 点「开始提炼」：先过隐私首提，再读取素材 -> 预估 -> 确认弹窗 */
  const startForge = async (): Promise<void> => {
    setError(null);
    if (!sourceReady()) {
      const tip =
        sourceKind === 'paste'
          ? '请先粘贴要提炼的文本'
          : sourceKind === 'file'
            ? '请先选择要提炼的文件'
            : '请先从书架选择一本书';
      void toast.info(tip);
      return;
    }
    // 隐私首提（一次性）
    const ctx = getAppContext();
    const ack = await ctx.appSettings.get(PRIVACY_ACK_KEY);
    if (!ack) {
      const ok = await confirmDialog(
        '素材文本将发送至所配置的模型服务商进行风格分析；请仅用于个人学习风格提炼，注意原作版权。',
        '隐私提示'
      );
      if (!ok) return;
      await ctx.appSettings.set(PRIVACY_ACK_KEY, 'true');
    }
    await computeEstimate(sample);
  };

  /** 确认执行：跑 forge 管线（单次 / 分片 map-reduce / 解析降级） */
  const runForge = async (): Promise<void> => {
    const ctx = getAppContext();
    const source = buildSource();
    if (!source) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('running');
    setError(null);
    setProgress(null);
    try {
      const result = await ctx.skillForgeService.forge({
        source,
        focus: focus.trim() || undefined,
        sample,
        signal: controller.signal,
        onProgress: setProgress
      });
      setDraft(result);
      setPhase('preview');
    } catch (e) {
      if (controller.signal.aborted) {
        setPhase('idle');
        void toast.info('已取消提炼');
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('idle');
      }
    } finally {
      abortRef.current = null;
    }
  };

  /** 取消执行 */
  const cancelForge = (): void => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex h-full">
      <HomeSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <main className="mx-auto max-w-4xl space-y-4 px-6 py-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
                <Flame size={22} className="text-violet-600" />
                一把炼化
              </h1>
              <p className="text-sm text-ink-500">
                上传书籍或粘贴文本，AI 凝练为文风 Skill -- 提炼风格指令，不复制内容
              </p>
            </div>
          </div>

          {/* 1. 素材来源（三互斥单选卡） */}
          <section className="rounded-lg border border-ink-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-medium text-ink-700">素材来源</h2>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: 'paste' as SourceKind, label: '粘贴文本', icon: ClipboardPaste, desc: '直接粘贴小说片段' },
                  { key: 'file' as SourceKind, label: '上传文件', icon: FileText, desc: 'TXT / Markdown 文档' },
                  { key: 'book' as SourceKind, label: '从书架选书', icon: BookOpen, desc: '库内书籍整本取样' }
                ] as const
              ).map((s) => {
                const active = sourceKind === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSourceKind(s.key)}
                    className={`flex flex-col items-start gap-1 rounded border p-3 text-left transition ${
                      active
                        ? 'border-violet-400 bg-violet-50'
                        : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink-800">
                      <s.icon size={15} className={active ? 'text-violet-600' : 'text-ink-400'} />
                      {s.label}
                    </span>
                    <span className="text-[11px] leading-4 text-ink-400">{s.desc}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3">
              {sourceKind === 'paste' && (
                <div className="space-y-1">
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={8}
                    placeholder="粘贴要提炼文风的小说文本片段…"
                    spellCheck={false}
                    className="w-full rounded border border-ink-200 px-2 py-1.5 text-sm leading-6 outline-none focus:border-violet-400"
                  />
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-ink-400">支持最长 10 万字，超长建议上传文件或整本采样</span>
                    <span className={pasteOver ? 'font-medium text-red-600' : 'text-ink-400'}>
                      {pasteText.length.toLocaleString()} / {MAX_PASTE_CHARS.toLocaleString()} 字
                    </span>
                  </div>
                  {pasteOver && (
                    <div className="flex items-center gap-1 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">
                      <AlertTriangle size={13} />
                      已超过粘贴上限，请精简后再试，或改用「上传文件 / 从书架选书」
                    </div>
                  )}
                </div>
              )}

              {sourceKind === 'file' && (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => void pickFile()}
                    className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-50"
                  >
                    {fileName ? '重新选择文件' : '选择文件'}
                  </button>
                  {fileName && (
                    <div className="rounded bg-ink-50 px-2 py-1.5 text-xs text-ink-600">
                      {fileName}
                      <span className="ml-2 text-ink-400">
                        {(fileSize / 1024 / 1024).toFixed(2)} MB
                      </span>
                      {fileSize > MAX_FILE_BYTES && (
                        <span className="ml-2 font-medium text-red-600">超过 5MB 上限，请换更短的文本</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {sourceKind === 'book' && (
                <div className="space-y-2">
                  <select
                    value={bookId}
                    onChange={(e) => setBookId(e.target.value)}
                    className="w-full rounded border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-400"
                  >
                    {books.length === 0 && <option value="">书架暂无书籍</option>}
                    {books.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                        {b.author ? `（${b.author}）` : ''}
                      </option>
                    ))}
                  </select>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
                    <input
                      type="checkbox"
                      checked={markSource}
                      onChange={(e) => setMarkSource(e.target.checked)}
                    />
                    描述中注明来源书名
                  </label>
                </div>
              )}
            </div>
          </section>

          {/* 2. 提炼侧重 */}
          <section className="rounded-lg border border-ink-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-medium text-ink-700">提炼侧重（可选）</h2>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              rows={2}
              placeholder="重点提炼对白风格，忽略景物描写"
              spellCheck={false}
              className="w-full rounded border border-ink-200 px-2 py-1.5 text-sm leading-6 outline-none focus:border-violet-400"
            />
            <div className="mt-1 flex justify-end text-[11px]">
              <span className={focus.length > FOCUS_MAX_CHARS ? 'font-medium text-red-600' : 'text-ink-400'}>
                {focus.length} / {FOCUS_MAX_CHARS} 字
              </span>
            </div>
          </section>

          {/* 3. 采样开关 */}
          <section className="rounded-lg border border-ink-200 bg-white p-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={sample}
                onChange={(e) => setSample(e.target.checked)}
                className="accent-violet-600"
              />
              智能采样（推荐，长文本按比例抽取代表段落）
            </label>
            <p className="mt-1 text-[11px] leading-4 text-ink-400">
              {sourceKind === 'book'
                ? '按章节均匀抽取，覆盖全书风格演变'
                : '关闭后超长文本将分片逐段分析（调用次数更多），适合需覆盖全文细节的场景'}
            </p>
          </section>

          {/* 4. 模型可用性与开始按钮 */}
          <section className="rounded-lg border border-ink-200 bg-white p-4">
            {modelError ? (
              <div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
                未配置模型，请先到设置页『模型接入』添加
                <button
                  type="button"
                  className="ml-2 underline hover:text-amber-900"
                  onClick={() => navigate('/settings')}
                >
                  去设置
                </button>
              </div>
            ) : modelName ? (
              <p className="mb-3 text-[11px] text-ink-400">
                将调用模型：<span className="text-ink-600">{modelName}</span>
              </p>
            ) : null}
            <button
              type="button"
              disabled={!!modelError || phase !== 'idle'}
              onClick={() => void startForge()}
              className="w-full rounded bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
            >
              开始提炼
            </button>
            {error && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
                {error}
              </div>
            )}
          </section>

          {/* 5. running：进度与取消 */}
          {phase === 'running' && (
            <section className="rounded-lg border border-ink-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm text-ink-700">
                <Loader2 size={16} className="animate-spin text-violet-600" />
                <span className="font-medium">{progressText(progress)}</span>
              </div>
              {progress?.phase === 'observing' && progress.total ? (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all"
                    style={{ width: `${Math.round(((progress.current ?? 0) / progress.total) * 100)}%` }}
                  />
                </div>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={cancelForge}
                  className="flex items-center gap-1 rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
                >
                  <X size={13} />
                  取消
                </button>
              </div>
            </section>
          )}

          {/* 6. preview：由底部 ForgePreviewDialog 承载（M3） */}
          {phase === 'preview' && (
            <p className="text-center text-xs text-ink-400">正在打开预览编辑…</p>
          )}
        </main>
      </div>

      {/* M2：预估确认弹窗 */}
      {phase === 'confirming' && estimate && (
        <ForgeConfirmDialog
          estimate={estimate}
          sourceLabel={sourceLabel()}
          modelNote={modelNote}
          sample={sample}
          onConfirm={() => void runForge()}
          onCancel={() => {
            setPhase('idle');
            setEstimate(null);
          }}
          onEnableSample={() => void enableSample()}
        />
      )}

      {/* M3：预览编辑与保存弹窗（draft 为 null 时打开空白模板手动填写兜底） */}
      {phase === 'preview' && (
        <ForgePreviewDialog
          draft={draft}
          sourceTitle={sourceKind === 'book' && markSource ? (selectedBook?.title ?? null) : null}
          onClose={() => {
            setPhase('idle');
            setDraft(null);
            setEstimate(null);
          }}
        />
      )}
    </div>
  );
}
