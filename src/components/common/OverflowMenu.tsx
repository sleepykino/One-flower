/**
 * 响应式溢出工具组（参考 VSCode 顶栏的响应式溢出模式）：
 * 空间足够时全部展开，空间不足时按优先级（priority 越小越先收）将条目收进右侧 ☰ 下拉菜单。
 *
 * 采用「测量层 + 宽度累计」的确定性算法，避免反复隐藏/恢复导致的振荡：
 *  - 测量层（aria-hidden / 不可见 / 不参与交互）渲染全部条目，读取各条目真实宽度；
 *  - 容器宽度变化（ResizeObserver）时，从最常驻条目开始逐个尝试显示整组，直至放不下；
 *  - 未显示的组收进 ☰，菜单项点击后自动关闭菜单。
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { Menu } from 'lucide-react';

export interface OverflowItem {
  /** 唯一标识 */
  key: string;
  /** 成组 key：同组条目同时收/放（如“目录/面板”）。单件条目设自身 key 即可 */
  group: string;
  /** 优先级：数值越小越先被收进 ☰，越大越常驻 */
  priority: number;
  /** 展开态的 JSX（按钮等；内部元素建议 shrink-0 + whitespace-nowrap，保证宽度稳定） */
  render: () => ReactNode;
  /** ☰ 菜单中的 JSX；缺省复用 render */
  menuRender?: () => ReactNode;
}

interface OverflowMenuProps {
  items: OverflowItem[];
  className?: string;
  dataTour?: string;
  /** ☰ 菜单面板宽度（tailwind 类） */
  menuWidth?: string;
}

/** 与可见层 gap-2 保持一致 */
const GAP = 8;
const MENU_KEY = '__menu__';

export function OverflowMenu({ items, className, dataTour, menuWidth = 'w-52' }: OverflowMenuProps) {
  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);
  const visibleRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef(hiddenGroups);
  hiddenRef.current = hiddenGroups;

  const hiddenItems = items.filter((it) => hiddenGroups.has(it.group));
  const visibleItems = items.filter((it) => !hiddenGroups.has(it.group));

  const recompute = useCallback(() => {
    const visible = visibleRef.current;
    const measure = measureRef.current;
    if (!visible || !measure) return;
    const clientW = visible.clientWidth;

    // 汇总各 group 的最小优先级（用于决定收放顺序）
    const groupPri = new Map<string, number>();
    for (const it of items) {
      const cur = groupPri.get(it.group) ?? Infinity;
      if (it.priority < cur) groupPri.set(it.group, it.priority);
    }
    // 按优先级降序：最常驻（最后收）的组排前面
    const order = [...groupPri.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const totalGroups = groupPri.size;

    const measureNodes = Array.from(measure.querySelectorAll<HTMLElement>('[data-ov-measure]'));
    // 计算「已显示组集」的累计宽度；只要仍有组被收起，就计入 ☰ 按钮占位
    const widthOf = (shown: ReadonlySet<string>): number => {
      let w = 0;
      let n = 0;
      const hasHidden = shown.size < totalGroups;
      for (const node of measureNodes) {
        const g = node.dataset.ovGroup ?? '';
        if (g === MENU_KEY) {
          if (hasHidden) {
            w += node.offsetWidth + (n > 0 ? GAP : 0);
            n += 1;
          }
          continue;
        }
        if (!shown.has(g)) continue;
        w += node.offsetWidth + (n > 0 ? GAP : 0);
        n += 1;
      }
      return w;
    };

    // 从最常驻的组开始逐个尝试显示，宽度放不下即停止
    const shown = new Set<string>();
    for (const g of order) {
      const cand = new Set(shown);
      cand.add(g);
      if (widthOf(cand) <= clientW) shown.add(g);
      else break;
    }
    const nextHidden = new Set(order.filter((g) => !shown.has(g)));

    const prev = hiddenRef.current;
    const changed =
      prev.size !== nextHidden.size || [...prev].some((g) => !nextHidden.has(g));
    if (changed) {
      hiddenRef.current = nextHidden;
      setHiddenGroups(nextHidden);
      setOpen(false);
    }
  }, [items]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const el = visibleRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recompute]);

  return (
    <div
      ref={visibleRef}
      data-tour={dataTour}
      className={`relative flex min-w-0 flex-1 items-center justify-end gap-2 ${className ?? ''}`}
    >
      {visibleItems.map((it) => (
        <Fragment key={it.key}>{it.render()}</Fragment>
      ))}

      {hiddenItems.length > 0 && (
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="更多工具"
            aria-expanded={open}
            title="更多工具"
            className="flex items-center justify-center rounded border border-ink-200 px-2 py-1 text-ink-500 hover:bg-ink-100"
            onClick={() => setOpen((v) => !v)}
          >
            <Menu size={15} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div
                className={`absolute right-0 z-20 mt-1 rounded-lg border border-ink-200 bg-white py-1 shadow-lg ${menuWidth}`}
              >
                {hiddenItems.map((it) => (
                  <div key={it.key} onClick={() => setOpen(false)}>
                    {it.menuRender ? it.menuRender() : it.render()}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 测量层：不可见离屏渲染全部条目 + ☰ 占位，用于读取真实宽度 */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 z-[-1]"
      >
        {items.map((it) => (
          <span key={it.key} data-ov-measure data-ov-group={it.group} className="inline-block">
            {it.render()}
          </span>
        ))}
        <span data-ov-measure data-ov-group={MENU_KEY} className="inline-block">
          <button
            type="button"
            className="flex items-center justify-center rounded border border-ink-200 px-2 py-1 text-ink-500"
          >
            <Menu size={15} />
          </button>
        </span>
      </div>
    </div>
  );
}
