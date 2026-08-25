import type { Page } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';
import { acceptNativeDialog } from './helpers/native-dialog';

// 对应 doc/自动化测试计划.md 阶段 9（已于 2026-08-25 手工验证通过，
// 记录见 doc/自动化测试记录.md「阶段 9：跨模块健壮性」）
//
// 约定：
// - 每条用例自建 TEST-E2E-P9-* 书籍，afterEach 统一删除，互不依赖执行顺序
// - toast 宿主固定右下角 fixed bottom-4 right-4 z-[200]，info 停留约 3500ms，
//   快照可能漏捕获 → 用轮询 body innerText 断言出现/消失
// - 快捷键监听位置不一：Ctrl+Shift+F / Ctrl+S 绑 window keydown（dispatchEvent 触发）；
//   全局查找弹窗的 Esc 绑在聚焦输入框 onKeyDown（需先聚焦再按键）
// - 教训（手工记录 T9.4）：service 层写盘只改正文 JSON 文件、不回写 chapters.word_count；
//   本文件所有正文改动都走编辑器 UI + Ctrl+S 链路（会同步 word_count），不绕过编辑器直写
// - T9.2 会话恢复横幅：Editor.tsx 挂载时 longformService.findActive(bookId)
//   （longform_sessions.status ∈ ready/running/paused/seam-review）决定渲染，
//   直接 UPDATE status 制造 paused 会话即可无生成副作用复现

const RUN = Date.now().toString(36);

function uniqueBook(): string {
  return `TEST-E2E-P9-${RUN}-${Math.floor(Math.random() * 1e4)}`;
}

/** 本轮创建的书籍，afterEach 统一删除 */
const createdBooks: string[] = [];

// ---------- 通用 helper（沿用 phase2-editor 约定，复制勿 import） ----------

function bookCard(page: Page, title: string) {
  return page.locator('div.group.cursor-pointer', { hasText: title });
}

async function createBookViaHome(page: Page, title: string): Promise<void> {
  await page.goto(APP_URL + '/');
  await page.getByRole('button', { name: '新建书籍' }).click();
  await page.getByPlaceholder('书名 *').fill(title);
  await page.getByPlaceholder('类型（武侠 / 科幻 / 悬疑…）').fill('科幻');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(bookCard(page, title)).toBeVisible({ timeout: 8_000 });
}

/** 创建书籍并进入其编辑器 */
async function openFreshEditor(page: Page): Promise<string> {
  const title = uniqueBook();
  createdBooks.push(title);
  await createBookViaHome(page, title);
  await bookCard(page, title).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.getByRole('button', { name: '专注' })).toBeVisible();
  return title;
}

async function deleteBook(page: Page, title: string): Promise<void> {
  await page.goto(APP_URL + '/');
  const card = bookCard(page, title);
  await card.hover();
  await card.getByRole('button', { name: '删除' }).click();
  await acceptNativeDialog();
  await expect(card).toHaveCount(0);
}

function chapterRow(page: Page, title: string) {
  // 行 div 本身 draggable；.last() 防御标题互为前缀的极端情况
  return page.locator('div[draggable=true]', { hasText: title }).last();
}

async function createChapter(page: Page, title: string): Promise<void> {
  const input = page.getByPlaceholder('章节标题…');
  await input.fill(title);
  await input.locator('xpath=following-sibling::button[1]').click();
  await expect(chapterRow(page, title)).toBeVisible({ timeout: 5_000 });
}

/** 底部状态栏保存状态：未保存 / 保存中… / 已保存 */
async function saveState(page: Page): Promise<string> {
  return page.evaluate(() => (document.body.innerText.match(/未保存|保存中…|已保存/g) ?? []).pop() ?? '');
}

test.afterEach(async ({ tauriPage }) => {
  for (const title of createdBooks.splice(0)) {
    try {
      await deleteBook(tauriPage, title);
    } catch {
      // 清理失败不掩盖用例本身的失败
    }
  }
});

// ---------- 用例 ----------

test.describe('阶段 9：跨模块健壮性', () => {
  test('T9.1 持久化验证——reload 后章节树与正文均在', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '持久章');

    // 输入正文 → Ctrl+S 立即落盘（SQLite 章节元数据 + 正文 JSON 文件）
    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();
    await pm.pressSequentially('雾散之后是长街，长街尽头有人提灯。');
    await pm.press('Control+s');
    await expect.poll(() => saveState(tauriPage), { timeout: 5_000 }).toBe('已保存');

    // reload → 章节树行仍在且含字数后缀、正文文本仍在
    await tauriPage.reload();
    await expect(chapterRow(tauriPage, '持久章')).toBeVisible({ timeout: 8_000 });
    await expect(chapterRow(tauriPage, '持久章')).toContainText(/\d+字/);
    await expect(tauriPage.locator('.ProseMirror')).toContainText('雾散之后是长街', { timeout: 8_000 });
  });

  test('T9.2 会话恢复横幅——paused 会话复现、恢复入口与还原', async ({ tauriPage }) => {
    // app-context 动态 import 模式（手工记录沉淀资产）：Vite dev 下模块 URL 带 HMR
    // 时间戳，静态路径无法对齐 → 用 performance resource entries 取真实 URL 再 import()。
    // 前置：DB 中需存在带节拍（beats 非空）的长文会话；没有则跳过本用例。
    interface LfRow {
      id: string;
      book_id: string;
      status: string;
      beats: string;
    }
    const rows = await tauriPage.evaluate<LfRow[]>(async () => {
      const res = performance.getEntriesByType('resource').find((n) => n.name.includes('app-context'));
      if (!res) throw new Error('resource entries 中未找到 app-context 模块');
      const mod = await import(res.name);
      const db = mod.getAppContext().db as {
        query: (sql: string, ...args: unknown[]) => Promise<unknown[]>;
      };
      return (await db.query(
        'SELECT id, book_id, status, beats FROM longform_sessions ORDER BY updated_at DESC'
      )) as LfRow[];
    });
    const candidates = (rows ?? []).filter((r) => {
      try {
        return JSON.parse(String(r.beats ?? '[]')).length > 0;
      } catch {
        return false;
      }
    });
    test.skip(candidates.length === 0, '无可复用的长文会话（longform_sessions 无含节拍的记录）');

    const target = candidates[0];
    const originalStatus = target.status; // 还原为原状态（手工记录中为 done）

    // 直接 UPDATE 制造 paused 会话（无任何 AI 生成副作用）
    await tauriPage.evaluate(async (sid) => {
      const res = performance.getEntriesByType('resource').find((n) => n.name.includes('app-context'));
      if (!res) throw new Error('resource entries 中未找到 app-context 模块');
      const mod = await import(res.name);
      await mod.getAppContext().db.exec(
        "UPDATE longform_sessions SET status='paused' WHERE id=?",
        [sid]
      );
    }, target.id);

    // 进入该书编辑器：Editor.tsx 挂载时 findActive 命中 paused 会话 → 渲染恢复横幅
    await tauriPage.goto(`${APP_URL}/editor/${target.book_id}`);
    const banner = tauriPage.getByText(/检测到未完成的长文生成/);
    await expect(banner).toBeVisible({ timeout: 8_000 });

    // 点「恢复」→ 切到长文面板（步骤条 ① 节拍表 可见）
    await tauriPage.getByRole('button', { name: '恢复' }).click();
    await expect(tauriPage.getByText('① 节拍表')).toBeVisible({ timeout: 5_000 });

    // 还原会话状态 → reload 后横幅消失
    await tauriPage.evaluate(async ({ sid, status }) => {
      const res = performance.getEntriesByType('resource').find((n) => n.name.includes('app-context'));
      if (!res) throw new Error('resource entries 中未找到 app-context 模块');
      const mod = await import(res.name);
      await mod.getAppContext().db.exec(
        'UPDATE longform_sessions SET status=? WHERE id=?',
        [status, sid]
      );
    }, { sid: target.id, status: originalStatus });
    await tauriPage.reload();
    await expect(tauriPage.getByText(/检测到未完成的长文生成/)).toHaveCount(0);
  });

  test('T9.3 Toast 通知——插图无选区弹出 info 并自动消失', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '提示章');

    // 编辑器内无选区直接点工具栏「插图」→ toast.info 提示
    await tauriPage.getByRole('main').getByRole('button', { name: '插图' }).click();

    const TOAST_TEXT = '请先在正文中选中一段场景文字，再生成插图';
    // info 停留约 3500ms 且为 fixed 定位，快照可能漏捕获 → 轮询 body 文本断言出现
    await expect
      .poll(async () => tauriPage.evaluate(() => document.body.innerText), { timeout: 4_000 })
      .toContain(TOAST_TEXT);

    // 等待自动消失（info 约 3.5s，超时放宽到 8s）
    await expect
      .poll(async () => tauriPage.evaluate(() => document.body.innerText), { timeout: 8_000 })
      .not.toContain(TOAST_TEXT);
  });

  test('T9.4 快捷键回归——Ctrl+Shift+F 唤起查找 / Esc 关闭 / Ctrl+S 立即落盘', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '快捷章');

    // Ctrl+Shift+F 绑 window keydown → dispatchEvent 触发全局查找弹窗
    await tauriPage.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true })
      )
    );
    const query = tauriPage.getByPlaceholder(/查找内容/);
    await expect(query).toBeVisible();

    // Esc 绑定在聚焦的查找输入框 onKeyDown：先聚焦再按键关闭弹窗
    await query.click();
    await tauriPage.keyboard.press('Escape');
    await expect(query).toHaveCount(0);

    // 正文输入制造 dirty（防抖自动保存 3s 内不会触发）→ 断言 未保存
    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();
    await pm.pressSequentially('快捷键立即落盘验证。');
    expect(await saveState(tauriPage)).toBe('未保存');

    // Ctrl+S 跳过防抖立即保存 → poll 已保存
    await pm.press('Control+s');
    await expect.poll(() => saveState(tauriPage), { timeout: 5_000 }).toBe('已保存');
  });

  test('T9.5 窗口尺寸——1100×720 无横向溢出且三栏关键元素可见', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '尺寸章');

    // 在 Tauri WebView 上 setViewportSize 走 CDP Emulation.setDeviceMetricsOverride：
    // 覆盖视口宽高 + 设备像素比（DPR 被钉为 1）。恢复宽高无法清除该 override，
    // 残留会导致页面被拉伸（DPR 与 Windows 系统缩放不一致），
    // 故恢复必须显式调用 Emulation.clearDeviceMetricsOverride 让 WebView 回到原生渲染。
    const cdp = await tauriPage.context().newCDPSession(tauriPage);
    try {
      await tauriPage.setViewportSize({ width: 1100, height: 720 });

      // 无横向溢出：documentElement.scrollWidth <= innerWidth，且视口确已生效
      const overflow = await tauriPage.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        ih: window.innerHeight
      }));
      expect(overflow.iw).toBe(1100);
      expect(overflow.ih).toBe(720);
      expect(overflow.sw).toBeLessThanOrEqual(overflow.iw);

      // 三栏关键元素仍可见：章节树新建输入 / 正文编辑器 / 右侧 rail 任一 tab
      await expect(tauriPage.getByPlaceholder('章节标题…')).toBeVisible();
      await expect(tauriPage.locator('.ProseMirror')).toBeVisible();
      await expect(
        tauriPage.getByRole('navigation').getByRole('button', { name: 'AI 助手', exact: true })
      ).toBeVisible();
    } finally {
      // 彻底清除 override，恢复 WebView 原生视口与设备像素比（避免测试后页面残留拉伸）
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    }
  });

  test('T9.6 错误边界冒烟——reload 后正常渲染无 fallback', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '边界章');
    await tauriPage.reload();

    // 正常流程不受影响：根级 ErrorBoundary fallback（title「应用出错了」）不出现，
    // 章节树与正文编辑器正常渲染。
    // 注：ErrorBoundary 触发路径已在手工记录 T9.6 核查——装配点为根 main.tsx ×1
    // （title=应用出错了）+ 地图/剧本工作台局部 overlay 边界 ×2，fallback 卡片文案见
    // src/components/common/ErrorBoundary.tsx；人为触发渲染崩溃属破坏性注入，
    // E2E 只做冒烟（reload 后无 fallback 即可），console 无新增 error 的断言省略。
    await expect(tauriPage.getByText('应用出错了')).toHaveCount(0);
    await expect(chapterRow(tauriPage, '边界章')).toBeVisible({ timeout: 8_000 });
    await expect(tauriPage.locator('.ProseMirror')).toBeVisible();
  });
});
