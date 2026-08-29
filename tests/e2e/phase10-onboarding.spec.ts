/**
 * P7.1 phase10-onboarding：使用引导 E2E
 * - welcome 首启自动触发 → 走完落盘 → 二次启动不弹
 * - Esc 跳过即完成落盘
 * - 「自动弹出首次引导」总开关关闭后清空数据首启也不弹；设置页重放仍可用
 *
 * 隔离说明：e2e 与真实应用共享数据目录，全程用 dev-only URL 参数隔离
 * （?onboarding=reset 清空且本会话关闭自动触发；?onboarding=off 本会话关闭自动触发），
 * 不预置任何数据库状态。用例顺序有依赖，workers=1 串行执行。
 */

import { APP_URL, expect, test } from './helpers/tauri-app';

const POPOVER = '.onboarding-popover';
const NEXT_BTN = `${POPOVER} .driver-popover-next-btn`;

/**
 * 清空引导状态并等待落盘完成。
 * reset 页面必须完成应用挂载（TourHost effect 发出清库指令）+ 异步 DELETE 落盘后才能离开，
 * 否则页面卸载丢弃在途写入，completed 仍是旧值 -> 后续断言全部失真。
 */
async function resetOnboarding(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${APP_URL}/?onboarding=reset`);
  await page.getByRole('button', { name: '新建书籍' }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
}

test.describe('P7.1 使用引导', () => {
  test('welcome 首启自动触发 → 走完落盘 → 二次启动不弹', async ({ tauriPage: page }) => {
    test.setTimeout(90_000);
    await resetOnboarding(page);
    // 正常加载：无参数会话，autoShow 默认开 -> 600ms 后自动弹出 welcome
    await page.goto(`${APP_URL}/`);
    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 15_000 });
    await expect(popover).toContainText('欢迎使用一花');

    // 逐步走完：第 5 步自动跳设置页，第 7 步自动跳回书架（书架空置时该步自动跳过）
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(600);
      await page.locator(NEXT_BTN).click({ timeout: 8000 });
    }
    // 末步：有书 -> 高亮首书卡并显示「完成」；无书 -> 锚点缺失自动结束。
    // 第 7 步锚点需等回到书架并渲染书卡（waitTimeout 1500ms），因此给完成按钮足够的出现窗口
    const done = page.locator(`${POPOVER} button`, { hasText: '完成' });
    await done.click({ timeout: 10_000 }).catch(() => undefined);
    await expect(popover).toHaveCount(0, { timeout: 5000 });

    // 二次启动（off 会话）不弹
    await page.goto(`${APP_URL}/?onboarding=off`);
    await page.waitForTimeout(1500);
    await expect(page.locator(POPOVER)).toHaveCount(0);
  });

  test('Esc 跳过等同完成并落盘', async ({ tauriPage: page }) => {
    test.setTimeout(60_000);
    await resetOnboarding(page);
    await page.goto(`${APP_URL}/`);
    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0, { timeout: 5000 });

    // 落盘后二次加载不再自动弹出
    await page.goto(`${APP_URL}/?onboarding=off`);
    await page.waitForTimeout(1500);
    await expect(page.locator(POPOVER)).toHaveCount(0);
  });

  test('autoShow 总开关：关闭后清空数据首启也不弹，设置页重放仍可用', async ({ tauriPage: page }) => {
    test.setTimeout(90_000);
    // 清空状态；reset 会话本身不弹，方便静默操作设置页
    await resetOnboarding(page);
    await page.getByRole('button', { name: '设置' }).first().click();
    await page.getByRole('button', { name: '使用引导' }).click();
    await expect(page.getByRole('heading', { name: '使用引导' })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-tour="onboarding-row-welcome"]')).toBeVisible({ timeout: 8000 });

    // 关闭总开关
    const autoSwitch = page.locator('[data-tour="onboarding-auto-show"]');
    await expect(autoSwitch).toBeVisible();
    await autoSwitch.uncheck();

    // 全新加载（无参数、autoShow=false 已持久化）：清空过的数据也不自动弹
    await page.goto(`${APP_URL}/`);
    await page.waitForTimeout(1800);
    await expect(page.locator(POPOVER)).toHaveCount(0);

    // 设置页重放不受总开关影响（welcome 第 1 步会导航回书架）
    await page.getByRole('button', { name: '设置' }).first().click();
    await page.getByRole('button', { name: '使用引导' }).click();
    await expect(page.getByRole('heading', { name: '使用引导' })).toBeVisible({ timeout: 8000 });
    await page
      .locator('[data-tour="onboarding-row-welcome"]')
      .getByRole('button', { name: '重新播放' })
      .click();
    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
    await expect(page.locator(POPOVER)).toHaveCount(0);

    // 还原总开关（重放已把页面带回书架，需先回设置页；完成态保留，保持用户数据整洁）
    await page.getByRole('button', { name: '设置' }).first().click();
    await page.getByRole('button', { name: '使用引导' }).click();
    await expect(page.getByRole('heading', { name: '使用引导' })).toBeVisible({ timeout: 8000 });
    await page.locator('[data-tour="onboarding-auto-show"]').check();
  });
});
