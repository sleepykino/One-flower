/**
 * P7.1 引导运行时：OnboardingService 惰性单例 + TourHost 副作用回调工厂
 * 服务层不持 React 上下文；路由 / 侧栏 / tab / overlay 副作用经这里的回调落到 React 层。
 * 本文件不含组件（供 TourHost / TourHintButton / Home / OnboardingSection 共用）。
 */

import { getAppContext } from '../../context/app-context';
import { OnboardingService } from '../../services/onboarding/OnboardingService';
import type { TourHostEvent } from '../../services/onboarding/types';

let service: OnboardingService | null = null;

/** 惰性单例（initApp 完成后才会被调用） */
export function getOnboardingService(): OnboardingService {
  if (!service) service = new OnboardingService(getAppContext().appSettings);
  return service;
}

/** TourHost 副作用回调：把声明式指令落到 React 路由 / DOM 事件 */
export function createTourHostCallbacks(navigate: (to: string) => void): (event: TourHostEvent) => void {
  return (event) => {
    switch (event.type) {
      case 'navigate':
        navigate(event.to);
        break;
      case 'expandSidebar':
        try {
          localStorage.setItem('home-sidebar-collapsed', '0');
        } catch {
          // ignore
        }
        window.dispatchEvent(new Event('onboarding-expand-sidebar'));
        break;
      case 'openEditorTab':
        window.dispatchEvent(new CustomEvent<string>('onboarding-open-editor-tab', { detail: event.tab }));
        break;
      case 'openOverlay':
        window.dispatchEvent(new CustomEvent<string>('onboarding-open-overlay', { detail: event.overlay }));
        break;
    }
  };
}
