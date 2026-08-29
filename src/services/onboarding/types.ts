/**
 * P7.1 使用引导：数据结构（TourStep / StepAction / Tour）
 * 引导 = driver.js 气泡高亮；状态存 app_settings 两键（见 OnboardingService）
 */

export interface TourStep {
  /** 锚点选择器：data-tour 属性（如 [data-tour="home-new-book"]）或既有 data 属性（如 [data-rail-tab="ai"]）；空 = 居中展示 */
  target?: string;
  title: string;
  description: string;
  /** 气泡朝向，默认 bottom */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** 进入该步前执行的声明式指令（经 TourHost 在 React 层执行） */
  before?: StepAction;
  /** 锚点等待超时 ms（默认 3000，超时自动跳过该步不中断） */
  waitTimeout?: number;
}

/** 声明式步骤指令：服务层不持 React 上下文，一切副作用经 TourHost 执行 */
export interface StepAction {
  /** 路由跳转 */
  navigate?: string;
  /** HomeSidebar 展开（localStorage home-sidebar-collapsed 置 '0' + 事件通知） */
  expandSidebar?: boolean;
  /** 编辑器右侧 rail tab 切换（RightTab key） */
  openEditorTab?: string;
  /** overlay 打开请求（目前仅 'screenplay' 剧本工作台） */
  openOverlay?: string;
}

export interface Tour {
  /** 完成集合中的标记，全局唯一 */
  id: string;
  title: string;
  /** auto = 首次自动触发（仅一次）；manual = 仅 TourHintButton / 设置页触发 */
  trigger: 'auto' | 'manual';
  steps: TourStep[];
}

/** TourHost 执行的副作用事件（StepAction 的运行时形态） */
export type TourHostEvent =
  | { type: 'navigate'; to: string }
  | { type: 'expandSidebar' }
  | { type: 'openEditorTab'; tab: string }
  | { type: 'openOverlay'; overlay: string };
