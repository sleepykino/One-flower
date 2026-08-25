import type { Page } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';
import { acceptNativeDialog, dismissNativeDialog } from './helpers/native-dialog';

// 对应 doc/自动化测试计划260824.md 阶段 1（已于 2026-08-24 手工验证通过）
// 约定：每条用例独立创建 TEST-E2E-* 书籍并自清理，互不依赖执行顺序

function uniqueTitle(): string {
  return `TEST-E2E-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

function bookCard(page: Page, title: string) {
  return page.locator('div.group.cursor-pointer', { hasText: title });
}

async function createBook(page: Page, title: string): Promise<void> {
  await page.goto(APP_URL + '/');
  await expect(page.getByRole('button', { name: '新建书籍' })).toBeVisible();
  await page.getByRole('button', { name: '新建书籍' }).click();
  await page.getByPlaceholder('书名 *').fill(title);
  await page.getByPlaceholder('类型（武侠 / 科幻 / 悬疑…）').fill('科幻');
  await page.getByPlaceholder('作者').fill('测试员');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(bookCard(page, title)).toBeVisible({ timeout: 8_000 });
}

/** 通过原生确认弹窗删除指定书籍；confirm=true 走确认分支，false 走取消分支 */
async function deleteViaDialog(page: Page, title: string, confirm: boolean): Promise<void> {
  const card = bookCard(page, title);
  await card.hover();
  await card.getByRole('button', { name: '删除' }).click();
  if (confirm) await acceptNativeDialog();
  else await dismissNativeDialog();
}

test.describe('阶段 1：书架首页', () => {
  test('T1.1 新建书籍（空标题拦截 + 正常创建）', async ({ tauriPage }) => {
    const title = uniqueTitle();
    await tauriPage.goto(APP_URL + '/');
    await tauriPage.getByRole('button', { name: '新建书籍' }).click();

    // 空标题提交为静默 no-op：表单不关闭、无卡片产生
    await tauriPage.getByRole('button', { name: '创建' }).click();
    await expect(tauriPage.getByPlaceholder('书名 *')).toBeVisible();

    await createBook(tauriPage, title);

    // 自清理
    await deleteViaDialog(tauriPage, title, true);
    await expect(bookCard(tauriPage, title)).toHaveCount(0);
  });

  test('T1.3 删除书籍——取消分支（原生弹窗 ESC）', async ({ tauriPage }) => {
    const title = uniqueTitle();
    await createBook(tauriPage, title);

    await deleteViaDialog(tauriPage, title, false);
    await expect(bookCard(tauriPage, title)).toBeVisible();

    // 自清理
    await deleteViaDialog(tauriPage, title, true);
    await expect(bookCard(tauriPage, title)).toHaveCount(0);
  });

  test('T1.3 删除书籍——确认分支（原生弹窗 Enter）', async ({ tauriPage }) => {
    const title = uniqueTitle();
    await createBook(tauriPage, title);

    await deleteViaDialog(tauriPage, title, true);
    await expect(bookCard(tauriPage, title)).toHaveCount(0);
  });

  test('T1.4 卡片点击进入编辑器', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL + '/');
    const card = tauriPage.locator('div.group.cursor-pointer').first();
    await expect(card).toBeVisible({ timeout: 8_000 });
    await card.click();
    await expect(tauriPage).toHaveURL(/\/editor\//);
  });
});
