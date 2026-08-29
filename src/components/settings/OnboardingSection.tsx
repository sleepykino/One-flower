/**
 * P7.1 OnboardingSection：设置页「使用引导」分区
 * 全部 tour 列表（名称 / 步数 / 完成态 / 重新播放）+「自动弹出首次引导」总开关
 * 列表从 TOURS 自动渲染——新功能接入引导（见 P7.1 文档「新功能引导接入约定」）无需改本文件
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { TOURS } from '../../services/onboarding/tours';
import { createTourHostCallbacks, getOnboardingService } from '../onboarding/tourRuntime';

export function OnboardingSection(): JSX.Element {
  const navigate = useNavigate();
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [autoShow, setAutoShow] = useState(true);

  useEffect(() => {
    const svc = getOnboardingService();
    const load = (): void => {
      void svc.getCompleted().then(setCompleted).catch(() => undefined);
      void svc.shouldAutoShow().then(setAutoShow).catch(() => undefined);
    };
    load();
    // 引导完成 / 状态清空时刷新完成态（service 层经事件通知）
    window.addEventListener('onboarding-changed', load);
    return () => window.removeEventListener('onboarding-changed', load);
  }, []);

  const replay = (id: string): void => {
    const svc = getOnboardingService();
    if (svc.isRunning()) return;
    void svc.startTour(id, createTourHostCallbacks((to) => navigate(to)));
  };

  const toggleAuto = (on: boolean): void => {
    setAutoShow(on);
    void getOnboardingService().setAutoShow(on).catch(() => undefined);
  };

  return (
    <div>
      <p className="mb-3 text-xs leading-5 text-ink-400">
        首次启动的主线引导与各功能面板的「?」单点引导都可随时重看。跳过视同完成，不会重复自动弹出。
      </p>

      <div className="mb-4 space-y-1.5">
        {TOURS.map((t) => (
          <div
            key={t.id}
            data-tour={`onboarding-row-${t.id}`}
            className="flex items-center justify-between rounded border border-ink-100 bg-white px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{t.title}</span>
                {completed[t.id] && (
                  <span className="rounded bg-emerald-100 px-1.5 py-px text-[10px] text-emerald-700">已完成</span>
                )}
                {t.trigger === 'auto' && (
                  <span className="rounded bg-ink-100 px-1.5 py-px text-[10px] text-ink-500">首启自动</span>
                )}
              </div>
              <div className="text-[11px] text-ink-400">
                {t.steps.length} 步 · {t.trigger === 'auto' ? '首次启动自动播放' : '面板「?」或此处手动播放'}
              </div>
            </div>
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded border border-ink-200 px-2 py-1 text-xs text-ink-600 hover:border-violet-300 hover:text-violet-600"
              onClick={() => replay(t.id)}
            >
              <RotateCcw size={11} />
              重新播放
            </button>
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={autoShow}
          onChange={(e) => toggleAuto(e.target.checked)}
          data-tour="onboarding-auto-show"
        />
        自动弹出首次引导（关闭后清空数据首启也不再弹出，上方重放仍可用）
      </label>
    </div>
  );
}
