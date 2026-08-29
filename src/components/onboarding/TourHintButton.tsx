/**
 * P7.1 TourHintButton：面板标题栏「?」单点引导入口（manual tour 通用）
 * 点击即启动对应引导（随时可重放，无"已完成不弹"限制）；运行中二次点击无操作
 */

import { HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createTourHostCallbacks, getOnboardingService } from './tourRuntime';

interface Props {
  /** 对应 TOURS 中的 id */
  tourId: string;
  /** 追加到标题栏场景的样式 */
  className?: string;
}

export function TourHintButton({ tourId, className }: Props): JSX.Element {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      title="使用引导"
      aria-label="使用引导"
      className={`shrink-0 text-ink-400 transition-colors hover:text-violet-600 ${className ?? ''}`}
      onClick={() => {
        const svc = getOnboardingService();
        if (svc.isRunning()) return;
        void svc.startTour(tourId, createTourHostCallbacks((to) => navigate(to)));
      }}
    >
      <HelpCircle size={14} />
    </button>
  );
}
