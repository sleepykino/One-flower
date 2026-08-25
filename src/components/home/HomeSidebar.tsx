/**
 * 主页左侧边栏（P2.1-B）：全局功能入口
 * 我的书架（默认）/ 灵感库 / 设置；为周报复盘、任务中心等未来全局功能预留位
 * 支持收起/展开（默认收起），状态持久化到 localStorage
 */

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Lightbulb, Settings, Trash2, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';

const NAV_ITEMS: Array<{ key: string; label: string; icon: LucideIcon; path: string }> = [
  { key: 'shelf', label: '我的书架', icon: BookOpen, path: '/' },
  { key: 'trash', label: '回收站', icon: Trash2, path: '/trash' },
  { key: 'inspiration', label: '灵感库', icon: Lightbulb, path: '/inspiration' },
  { key: 'settings', label: '设置', icon: Settings, path: '/settings' }
];

const STORAGE_KEY = 'home-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    // 默认收起
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function HomeSidebar(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  };

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-ink-200 bg-ink-50 transition-[width] duration-200 ${
        collapsed ? 'w-14' : 'w-52'
      }`}
    >
      <div className="px-3 pt-5 pb-3">
        {collapsed ? (
          <div className="text-center text-base font-bold">花</div>
        ) : (
          <>
            <div className="text-sm font-bold">One Flower</div>
            <div className="mt-0.5 text-[11px] text-ink-400">一花一世界</div>
          </>
        )}
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {!collapsed && (
          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
            工作台
          </div>
        )}
        {NAV_ITEMS.map((item) => {
          const active =
            item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.key}
              type="button"
              title={collapsed ? item.label : undefined}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-sm ${
                collapsed ? 'justify-center' : ''
              } ${
                active
                  ? 'bg-violet-100 font-medium text-violet-700'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
              }`}
            >
              <item.icon size={15} />
              {!collapsed && item.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto px-2 pb-2">
        {!collapsed && <div className="px-2 pb-2 text-[10px] text-ink-300">本地优先 · 多模式 AI</div>}
        <button
          type="button"
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={toggle}
          className="flex w-full items-center justify-center gap-2 rounded px-2.5 py-1.5 text-sm text-ink-400 hover:bg-ink-100 hover:text-ink-900"
        >
          {collapsed ? <PanelLeftOpen size={15} /> : (
            <>
              <PanelLeftClose size={15} />
              <span>收起</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
