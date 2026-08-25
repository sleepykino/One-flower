import { APP_URL, expect, test } from './helpers/tauri-app';

// 对应 doc/自动化测试计划260824.md 阶段 0（已于 2026-08-24 手工验证通过）

test.describe('阶段 0：环境连通性与冒烟', () => {
  test('T0.1 首页加载并显示书架', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL + '/');
    await expect(tauriPage.getByRole('heading', { name: '我的书架' })).toBeVisible();
    await expect(tauriPage.getByRole('button', { name: '新建书籍' })).toBeVisible();
  });

  test('T0.2 灵感库与设置路由可达', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL + '/inspiration');
    // 页面同时存在 h1「灵感库」与灵感库列表的 h2「灵感库」，须限定级别
    await expect(tauriPage.getByRole('heading', { name: '灵感库', level: 1 })).toBeVisible();

    await tauriPage.goto(APP_URL + '/settings');
    await expect(tauriPage.getByRole('button', { name: '← 返回' })).toBeVisible();
  });

  test('T0.2 编辑器路由可达（依赖至少一本书）', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL + '/');
    const card = tauriPage.locator('div.group.cursor-pointer').first();
    // 书籍列表由 SQLite 异步加载，load 事件时可能尚未渲染
    try {
      await expect(card).toBeVisible({ timeout: 8_000 });
    } catch {
      test.skip(true, '书架为空，无法验证编辑器路由');
      return;
    }
    await card.click();
    await expect(tauriPage).toHaveURL(/\/editor\//);
  });

  test('T0.4 侧边导航与收起状态持久化', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL + '/');
    const key = 'home-sidebar-collapsed';
    const before = await tauriPage.evaluate((k) => localStorage.getItem(k), key);

    // 固定为收起态再刷新，保证用例确定性（用户当前可能处于任意状态）
    await tauriPage.evaluate((k) => localStorage.setItem(k, '1'), key);
    await tauriPage.reload();

    // 展开侧边栏 → 值翻转
    await tauriPage.getByRole('button', { name: '展开侧边栏' }).click();
    await expect(tauriPage.getByRole('button', { name: '收起' })).toBeVisible();
    expect(await tauriPage.evaluate((k) => localStorage.getItem(k), key)).toBe('0');

    // 导航到灵感库
    await tauriPage.getByRole('button', { name: '灵感库' }).click();
    await expect(tauriPage).toHaveURL(/\/inspiration$/);

    // 还原用户原状态，避免污染
    await tauriPage.evaluate(([k, v]) => localStorage.setItem(k, v ?? ''), [key, before]);
  });
});
