/**
 * 沉浸 / 打字机模式（P2）：
 * 作为包裹容器复用同一个 NovelEditor（TipTap 实例，不重挂载）：
 * - 非激活：透传 children，保持原三栏布局
 * - 激活：切换为 fixed 全屏沉浸容器，支持 标准/护眼/夜间 三主题、
 *   打字机滚动（光标所在块居中）、本次字数 / 时长统计，Esc 或 × 退出
 *
 * 用法：
 * <FocusMode active={focusOn} onExit={() => setFocusOn(false)}>
 *   <NovelEditor bookId={bookId} />
 * </FocusMode>
 */

import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';

/** 沉浸主题 */
type Theme = 'standard' | 'sepia' | 'night';

const THEME_ORDER: Theme[] = ['standard', 'sepia', 'night'];

/**
 * 各主题样式：
 * - container：沉浸容器背景 / 文字色
 * - bar：浮动状态条（半透明，浅色主题用 bg-black/10，夜间反色 bg-white/10）
 * - btnIdle / btnActive：状态条按钮（半透明黑白自适应，夜间保持可读）
 */
const THEME_UI: Record<
  Theme,
  { label: string; container: string; bar: string; btnIdle: string; btnActive: string }
> = {
  standard: {
    label: '标准',
    container: 'bg-white text-ink-800',
    bar: 'bg-black/10 text-ink-700',
    btnIdle: 'border-ink-200/50 hover:bg-white/60',
    btnActive: 'border-ink-200/50 bg-white/80 text-ink-800'
  },
  sepia: {
    label: '护眼',
    container: 'bg-[#f5f0e1] text-[#5b4a32]',
    bar: 'bg-black/10 text-[#5b4a32]',
    btnIdle: 'border-ink-200/50 hover:bg-white/60',
    btnActive: 'border-ink-200/50 bg-white/80 text-[#5b4a32]'
  },
  night: {
    label: '夜间',
    container: 'bg-[#1c1c1e] text-[#d6d3cd]',
    bar: 'bg-white/10 text-[#d6d3cd]',
    btnIdle: 'border-white/30 bg-white/10 text-current hover:bg-white/20',
    btnActive: 'border-white/50 bg-white/80 text-ink-900'
  }
};

/**
 * 激活态注入的样式：
 * - ProseMirror 透明并继承主题文字色（NovelEditor 自带白底被中和）
 * - 隐藏 NovelEditor 工具栏、去掉其编辑区白底 / 内边距 / 内部滚动，
 *   让本容器（overflow-y-auto）成为唯一滚动容器
 * 注：nth-child(2) 对应 NovelEditor 的编辑区（第 1 个子 div 是工具栏），
 *     不影响其后条件渲染的 @ / [[ 弹窗
 */
const FOCUS_CSS = `
.focus-root .ProseMirror { background: transparent !important; color: inherit !important; min-height: 60vh; }
.focus-root { outline: none; }
.focus-root .novel-editor { height: auto !important; overflow: visible !important; }
.focus-root .novel-editor > div:first-child { display: none !important; }
.focus-root .novel-editor > div:nth-child(2) {
  background: transparent !important;
  padding: 0 !important;
  overflow: visible !important;
  border-bottom: none !important;
}
`;

interface FocusModeProps {
  active: boolean;
  onExit: () => void;
  children: React.ReactNode;
}

export function FocusMode({ active, onExit, children }: FocusModeProps): JSX.Element {
  const [theme, setTheme] = useState<Theme>('standard');
  const [typewriter, setTypewriter] = useState(false);
  /** 本次时长（秒，1s interval 时钟） */
  const [elapsed, setElapsed] = useState(0);
  /** 本次新增字数 = max(0, 当前长度 - 起始长度) */
  const [written, setWritten] = useState(0);
  /** 沉浸容器（打字机滚动的包含判断用） */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startTimeRef = useRef(0);
  const startLenRef = useRef(0);

  // 进入沉浸态：重置主题 / 打字机 / 统计，记录起始时间与字数
  useEffect(() => {
    if (!active) return;
    startTimeRef.current = Date.now();
    startLenRef.current = useEditorStore.getState().editorApi?.getPlainText().length ?? 0;
    setTheme('standard');
    setTypewriter(false);
    setElapsed(0);
    setWritten(0);
  }, [active]);

  // 1s 时钟；顺带刷新本次字数（打字机关闭时 selectionchange 未监听，兜底更新）
  useEffect(() => {
    if (!active) return;
    const tick = (): void => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      const len = useEditorStore.getState().editorApi?.getPlainText().length;
      if (len !== undefined) setWritten(Math.max(0, len - startLenRef.current));
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active]);

  // 打字机模式：selectionchange 防抖 250ms，光标所在块平滑滚动到容器中央
  useEffect(() => {
    if (!active || !typewriter) return;
    let timer: number | null = null;
    const onSelectionChange = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        // 顺带更新本次字数
        const len = useEditorStore.getState().editorApi?.getPlainText().length;
        if (len !== undefined) setWritten(Math.max(0, len - startLenRef.current));
        // 打字机滚动（容器自身是滚动容器，ProseMirror 内部不再滚动）
        const node = window.getSelection()?.anchorNode ?? null;
        const container = containerRef.current;
        if (!node || !container || !container.contains(node)) return;
        const target = node.parentElement ?? node;
        if (target instanceof Element) {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 250);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, typewriter]);

  // Esc 退出
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onExit]);

  const ui = THEME_UI[theme];
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    /* 根节点与内容包裹层在两种形态下保持相同结构（children 恒为首个子节点），
       避免切换沉浸态时 NovelEditor 被重挂载、TipTap 实例被销毁重建 */
    <div
      ref={containerRef}
      className={
        active ? `fixed inset-0 z-50 overflow-y-auto focus-root ${ui.container}` : 'h-full w-full'
      }
    >
      <div className={active ? 'mx-auto max-w-3xl px-10 py-20' : 'h-full w-full'}>{children}</div>

      {active && (
        <>
          <style>{FOCUS_CSS}</style>

          {/* 顶部浮动状态条：主题切换 / 打字机 / 本次字数·时长 / 退出 */}
          <div
            className={`fixed top-3 right-4 z-50 flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs backdrop-blur-sm ${ui.bar}`}
          >
            {THEME_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                  theme === t ? ui.btnActive : ui.btnIdle
                }`}
                onClick={() => setTheme(t)}
              >
                {THEME_UI[t].label}
              </button>
            ))}

            <button
              type="button"
              className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                typewriter ? ui.btnActive : ui.btnIdle
              }`}
              onClick={() => setTypewriter((v) => !v)}
            >
              打字机 {typewriter ? '开' : '关'}
            </button>

            <span className="px-1 tabular-nums">本次 {written} 字 · {mm}:{ss}</span>

            <button
              type="button"
              title="退出沉浸模式（Esc）"
              className={`rounded border px-2 py-0.5 text-xs transition-colors ${ui.btnIdle}`}
              onClick={onExit}
            >
              ×
            </button>
          </div>
        </>
      )}
    </div>
  );
}
