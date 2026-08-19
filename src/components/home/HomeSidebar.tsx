/**
 * 主页左侧边栏（P2.1-B）：全局功能入口
 * 我的书架（默认）/ 灵感库 / 设置；为周报复盘、任务中心等未来全局功能预留位
 */

import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Lightbulb, Settings, type LucideIcon } from 'lucide-react';

const NAV_ITEMS: Array<{ key: string; label: string; icon: LucideIcon; path: string }> = [
  { key: 'shelf', label: '我的书架', icon: BookOpen, path: '/' },
  { key: 'inspiration', label: '灵感库', icon: Lightbulb, path: '/inspiration' },
  { key: 'settings', label: '设置', icon: Settings, path: '/settings' }
];

export function HomeSidebar(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-ink-200 bg-ink-50">
      <div className="px-4 pt-5 pb-3">
        <div className="text-sm font-bold">One Flower</div>
        <div className="mt-0.5 text-[11px] text-ink-400">一花一世界</div>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
          工作台
        </div>
        {NAV_ITEMS.map((item) => {
          const active =
            item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-sm ${
                active
                  ? 'bg-violet-100 font-medium text-violet-700'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
              }`}
            >
              <item.icon size={15} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto px-4 pb-4 text-[10px] text-ink-300">
        本地优先 · 多模式 AI
      </div>
    </aside>
  );
}
