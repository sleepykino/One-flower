/**
 * P7.1 TourHost：引导框架的 React 宿主（渲染 null，只承载副作用）
 * - 挂载于 App Router 内（需 useNavigate）
 * - dev ?onboarding=reset 清空引导状态（e2e 造首启场景）
 * - editor-basics 自动触发：welcome 已完成且自身未完成时，进入编辑器一次性播放
 * - 自动引导完成 / 跳过后的 toast 提示（service 层经事件转发，不持组件依赖）
 */

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '../common/toast';
import { isAutoTriggerOff, isDevResetRequested } from '../../services/onboarding/OnboardingService';
import { createTourHostCallbacks, getOnboardingService } from './tourRuntime';
import './popover.css';
import 'driver.js/dist/driver.css';

export function TourHost(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  // dev-only：清空引导状态（?onboarding=reset）
  useEffect(() => {
    if (isDevResetRequested) void getOnboardingService().clearAll().catch(() => undefined);
  }, []);

  // editor-basics 首启触发（对齐 Home 延迟静默先例；锚点未就绪由 driver 等待兜底）
  useEffect(() => {
    if (isAutoTriggerOff) return;
    if (!/^\/editor\//.test(location.pathname)) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const svc = getOnboardingService();
        if (!(await svc.shouldAutoShow())) return;
        const done = await svc.getCompleted();
        if (done['welcome'] && !done['editor-basics']) {
          await svc.startTour('editor-basics', createTourHostCallbacks(navigate));
        }
      })().catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [location.pathname, navigate]);

  // 自动引导完成提示（manual tour 不提示，避免打扰）
  useEffect(() => {
    const onFinish = (e: Event): void => {
      const detail = (e as CustomEvent<{ tourId: string; trigger: 'auto' | 'manual' }>).detail;
      if (detail?.trigger === 'auto') toast.info('引导完成，随时可在「设置 → 使用引导」中重看');
    };
    window.addEventListener('onboarding-tour-finished', onFinish);
    return () => window.removeEventListener('onboarding-tour-finished', onFinish);
  }, []);

  return <></>;
}
