import type { Page } from '@playwright/test';

/**
 * 软件内确认弹窗（ConfirmDialogHost）自动化。
 *
 * P7.2 起确认弹窗由原生 ask 系统消息框改为软件内模态（DOM 级），
 * 不再依赖 PowerShell AppActivate + SendKeys。
 * 统一入口语义不变：accept=点「确认」（原生 ask 回车=是）、dismiss=点「取消」（ESC=否）。
 */

/** 定位软件内确认弹窗（按可选标题文本过滤），等待可见后返回 */
async function dialog(page: Page, title?: string) {
  const loc = title ? page.getByRole('dialog').filter({ hasText: title }) : page.getByRole('dialog');
  await loc.waitFor({ state: 'visible', timeout: 5_000 });
  return loc;
}

/** 点确认弹窗的「确认」按钮（等价原生 ask 回车=是） */
export async function acceptNativeDialog(page: Page, title?: string): Promise<void> {
  await (await dialog(page, title)).getByRole('button', { name: '确认' }).click();
}

/** 点确认弹窗的「取消」按钮（等价原生 ask ESC=否） */
export async function dismissNativeDialog(page: Page, title?: string): Promise<void> {
  await (await dialog(page, title)).getByRole('button', { name: '取消' }).click();
}
