/**
 * P7.1 OnboardingService：引导状态持久化 + driver.js 实例调度
 * - 状态只存 app_settings 两键（onboarding.completed / onboarding.autoShow），无新表无迁移
 * - 锚点等待用 driver.js 原生 skipMissingElement + waitForElement（超时自动跳步不中断）
 * - in-flight 防护：运行中重复 startTour 直接忽略（StrictMode 双挂载 / 「?」二次点击安全）
 * - 完成态语义：跳过 = 完成（X / Esc / 走完统一 markDone），auto tour 一生只自动触发一次
 */

import type { Driver, DriveStep } from 'driver.js';
import type { AppSettingsService } from '../settings/AppSettingsService';
import type { StepAction, Tour, TourHostEvent } from './types';
import { TOURS } from './tours';

const KEY_COMPLETED = 'onboarding.completed';
const KEY_AUTO_SHOW = 'onboarding.autoShow';
const ANCHOR_WAIT_DEFAULT = 3000;

// dev-only URL 参数（仅 vite dev 生效，生产构建恒为 null）：
//   ?onboarding=off    本会话禁用自动触发（存量 e2e 用例隔离，不污染共享数据目录）
//   ?onboarding=reset  清空引导状态且本会话禁用自动触发（phase10 造首启场景）
// 模块加载时读取一次：SPA 路由跳转不重载页面，会话内保持稳定
const DEV_PARAM =
  import.meta.env.DEV && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('onboarding')
    : null;

/** 本会话是否禁用自动触发（Home / TourHost 的自动入口据此短路；手动入口不受影响） */
export const isAutoTriggerOff: boolean = DEV_PARAM === 'off' || DEV_PARAM === 'reset';
/** 本会话是否请求清空引导状态（TourHost 挂载时执行一次 clearAll） */
export const isDevResetRequested: boolean = DEV_PARAM === 'reset';

export class OnboardingService {
  private appSettings: AppSettingsService;
  /** completed 内存缓存：markDone 先更新缓存再落盘，避免并发读改写丢条目 */
  private completed: Record<string, boolean> | null = null;
  private runningId: string | null = null;

  constructor(appSettings: AppSettingsService) {
    this.appSettings = appSettings;
  }

  /** 完成集合（内存缓存 + 读时回填；JSON 解析失败按空集合处理） */
  async getCompleted(): Promise<Record<string, boolean>> {
    if (this.completed) return this.completed;
    try {
      const raw = await this.appSettings.get(KEY_COMPLETED);
      this.completed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      this.completed = {};
    }
    return this.completed;
  }

  /** 标记完成并落盘（app_settings 整集合覆写，写入经 WriteQueue 串行化） */
  async markDone(tourId: string): Promise<void> {
    const completed = await this.getCompleted();
    if (completed[tourId]) return;
    completed[tourId] = true;
    await this.persistCompleted();
  }

  /** 自动触发总开关（onboarding.autoShow，缺省视为 true） */
  async shouldAutoShow(): Promise<boolean> {
    try {
      return (await this.appSettings.get(KEY_AUTO_SHOW)) !== 'false';
    } catch {
      return true;
    }
  }

  async setAutoShow(on: boolean): Promise<void> {
    await this.appSettings.set(KEY_AUTO_SHOW, on ? 'true' : 'false');
  }

  /** 清空引导状态（dev ?onboarding=reset 专用；生产路径不可达） */
  async clearAll(): Promise<void> {
    this.completed = {};
    await this.appSettings.set(KEY_COMPLETED, null);
    await this.appSettings.set(KEY_AUTO_SHOW, null);
    this.notifyChanged();
  }

  /** 是否有引导正在运行（「?」二次点击防护） */
  isRunning(): boolean {
    return this.runningId !== null;
  }

  /**
   * 启动引导：
   * 1. in-flight 防护 -> 2. 逐步 drive（before 指令先经 host 执行，driver 原生等待/跳过锚点）
   * 3. 完成 / 关闭（X / Esc / 走完）统一 finish：markDone 落盘 + 事件通知
   */
  async startTour(tourId: string, host: (event: TourHostEvent) => void): Promise<void> {
    if (this.runningId !== null) return;
    const tour = TOURS.find((t) => t.id === tourId);
    if (!tour || tour.steps.length === 0) return;
    this.runningId = tourId;
    try {
      // driver.js 随用随载（引导非启动必需，动态引入利于分包）
      const { driver } = await import('driver.js');
      const steps: DriveStep[] = tour.steps.map((s, i) => ({
        element: s.target,
        popover: {
          title: s.title,
          description: s.description,
          side: s.side ?? 'bottom',
          // 标签按位置写死：driver 以"下一锚点是否已在 DOM"判断末步，跨页步骤会误判
          nextBtnText: i === tour.steps.length - 1 ? '完成' : '下一步'
        },
        disableActiveInteraction: true
      }));
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.runningId = null;
        void this.markDone(tourId).catch(() => undefined);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('onboarding-tour-finished', { detail: { tourId, trigger: tour.trigger } })
          );
        }
      };
      const driverObj: Driver = driver({
        popoverClass: 'onboarding-popover',
        overlayColor: '#23211e',
        overlayOpacity: 0.45,
        allowClose: true,
        disableActiveInteraction: true,
        // 点遮罩不关闭（防误触中断；跳过只走右上角 X / Esc）
        overlayClickBehavior: () => undefined,
        showProgress: true,
        progressText: '{{current}} / {{total}}',
        prevBtnText: '上一步',
        doneBtnText: '完成',
        // 不用 driver 原生 skipMissingElement：内部跳步链不执行 before 指令，
        // 锚点等待与跳步统一由 gotoStep 处理（跳步时 before 照常生效）
        steps,
        onDestroyed: () => finish(),
        onNextClick: () => {
          void this.gotoStep(driverObj, tour, (driverObj.getActiveIndex() ?? -1) + 1, 1, host);
        },
        onPrevClick: () => {
          void this.gotoStep(driverObj, tour, (driverObj.getActiveIndex() ?? 0) - 1, -1, host);
        }
      });
      await this.gotoStep(driverObj, tour, 0, 1, host);
    } catch {
      // 引导框架异常静默清理（约束：不打扰用户）
      this.runningId = null;
    }
  }

  /**
   * 跳到第 index 步：先执行 before 指令，再等锚点出现后 drive。
   * 锚点超时未出现则沿行进方向跳步（before 照常执行）；越界即结束（destroy -> finish）。
   */
  private async gotoStep(
    driverObj: Driver,
    tour: Tour,
    index: number,
    dir: 1 | -1,
    host: (event: TourHostEvent) => void
  ): Promise<void> {
    if (index < 0 || index >= tour.steps.length) {
      driverObj.destroy();
      return;
    }
    const step = tour.steps[index];
    if (step.before) this.applyBefore(step.before, host);
    if (step.target) {
      const found = await this.waitForAnchor(step.target, step.waitTimeout ?? ANCHOR_WAIT_DEFAULT);
      if (!found) {
        await this.gotoStep(driverObj, tour, index + dir, dir, host);
        return;
      }
    }
    driverObj.drive(index);
  }

  /** 等待锚点出现（MutationObserver + 超时兜底） */
  private waitForAnchor(target: string, timeout: number): Promise<boolean> {
    if (document.querySelector(target) !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const obs = new MutationObserver(() => {
        if (document.querySelector(target) !== null) {
          cleanup();
          resolve(true);
        }
      });
      const timer = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeout);
      const cleanup = (): void => {
        obs.disconnect();
        window.clearTimeout(timer);
      };
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  private applyBefore(action: StepAction, host: (event: TourHostEvent) => void): void {
    if (action.navigate !== undefined) host({ type: 'navigate', to: action.navigate });
    if (action.expandSidebar) host({ type: 'expandSidebar' });
    if (action.openEditorTab !== undefined) host({ type: 'openEditorTab', tab: action.openEditorTab });
    if (action.openOverlay !== undefined) host({ type: 'openOverlay', overlay: action.openOverlay });
  }

  private async persistCompleted(): Promise<void> {
    const completed = this.completed ?? {};
    await this.appSettings.set(KEY_COMPLETED, JSON.stringify(completed));
    this.notifyChanged();
  }

  private notifyChanged(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('onboarding-changed'));
  }
}
