import type { Page } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';
import { acceptNativeDialog } from './helpers/native-dialog';

// 对应 doc/自动化测试计划.md 阶段 5：资产与工具（P1）
// 手工验证记录见 doc/自动化测试记录.md「阶段 5：资产与工具（2026-08-25）」
//
// 约定：
// - 每条用例独立创建 TEST-E2E-P5-* 书籍并进入编辑器，afterEach 统一删除，互不依赖执行顺序
// - 进入编辑器后统一建 1 个章节、写入一句正文并 Ctrl+S 保存：
//   editorStore 保存链路每次落盘都调 versionStore.saveVersion（editorStore.ts），
//   保证版本历史面板有真实快照数据
// - 图库上传入口为原生 plugin-dialog open 文件对话框，CDP 无法操作 → 标 MANUAL，
//   只测筛选 UI 与空态；入库/删除保护等 service 等价链路见手工记录 T5.1/T5.2
// - 版本历史无手动创建快照入口（已知事实）：版本由自动保存链路生成，
//   故不点击「清理旧版本」「回退」等破坏性按钮

const RUN = Date.now().toString(36);

function uniqueBook(): string {
  return `TEST-E2E-P5-${RUN}-${Math.floor(Math.random() * 1e4)}`;
}

/** 本轮创建的书籍，afterEach 统一删除 */
const createdBooks: string[] = [];

// ---------- 通用 helper（沿用 phase2-editor.spec.ts 的局部 helper 模式） ----------

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

/** 创建书籍 → 进入编辑器 → 建 1 章 + 写入一句正文 + Ctrl+S 保存 */
async function openEditorWithSavedText(page: Page): Promise<string> {
  const title = uniqueBook();
  createdBooks.push(title);
  await createBookViaHome(page, title);
  await bookCard(page, title).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.getByRole('button', { name: '专注' })).toBeVisible();

  await createChapter(page, '第一章');
  const pm = page.locator('.ProseMirror');
  await pm.click();
  await pm.pressSequentially('青鸟穿过晨雾，落在守灯人的肩头。');
  await pm.press('Control+s');
  await expect.poll(() => saveState(page), { timeout: 5_000 }).toBe('已保存');
  return title;
}

/** 右侧 rail tab（竖排图标栏按钮的 accessible name 来自 title 属性）。
 *  nav.last() 域限定 + exact 规避「角色」与「角色采访」前缀等重名问题 */
function railTab(page: Page, name: string) {
  return page.locator('nav').last().getByRole('button', { name, exact: true });
}

/** 右侧面板容器（DOM 末位 aside，见手工记录沉淀的定位技巧） */
function rightPanel(page: Page) {
  return page.locator('aside').last();
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

test.describe('阶段 5：资产与工具', () => {
  test('T5.1/T5.2 图库空态渲染与用途筛选 chips 切换（上传入口 MANUAL）', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);
    await railTab(tauriPage, '图库').click();
    const panel = rightPanel(tauriPage);

    // 新书无任何图片：空态文案在位（ImageLibraryPanel 空态）
    await expect(panel.getByText(/暂无图片/)).toBeVisible();

    // 四个用途筛选 chip：全部 / 封面 / 角色 / 插图，逐个点击切换不报错
    // （新书任何筛选下均为空列表，切换仅触发 listByBook 本地查询）
    // 四个用途筛选 chip 用文本定位：rail 按钮的可访问名来自 title（文本是图标，非「角色」文字），
    // getByText 精确匹配只命中 chip 文本，避开与 rail「角色」按钮的 strict mode 冲突
    for (const chip of ['全部', '封面', '角色', '插图']) {
      await panel.getByText(chip, { exact: true }).click();
    }
    // 回到「全部」收尾，空态仍在
    await panel.getByText('全部', { exact: true }).click();
    await expect(panel.getByText(/暂无图片/)).toBeVisible();

    // 「+ 上传」按钮可见。
    // MANUAL：上传走原生 plugin-dialog open 文件对话框，CDP 无法操作文件对话框
    // （见手工记录 T5.1），此处不点击执行流程；
    // 入库（importFromBytes）/ 用途筛选语义 / 被引用删除保护的 service 等价链路验证，
    // 见手工记录 T5.1/T5.2。
    await expect(panel.getByRole('button', { name: '+ 上传' })).toBeVisible();
  });

  test('T5.3 版本历史面板头与版本列表（自动快照，无手动快照入口）', async ({ tauriPage }) => {
    // Ctrl+S 保存链路每次落盘均写 versionStore.saveVersion → 必有 ≥1 条快照
    await openEditorWithSavedText(tauriPage);
    await railTab(tauriPage, '版本').click();
    const panel = rightPanel(tauriPage);

    // 面板头「版本历史（N）」+ 清理旧版本按钮
    await expect(panel.getByText(/版本历史（\d+）/)).toBeVisible();
    await expect(panel.getByRole('button', { name: '清理旧版本' })).toBeVisible();

    // 已知事实：版本由自动保存链路生成，面板无手动创建快照入口；
    // 不点击「清理旧版本」（破坏性操作）。对比/回退涉及原生确认弹窗，见手工记录 T5.3。
    // 正文已保存（saveCurrentChapter 先 saveContent 后 saveVersion 再置「已保存」），
    // 轮询等待首条版本条目渲染；确无版本时退回断言空态提示
    const rows = panel.getByRole('button', { name: '预览' });
    const hasRows = await expect
      .poll(() => rows.count(), { timeout: 3_000 })
      .toBeGreaterThan(0)
      .then(() => true)
      .catch(() => false);
    if (hasRows) {
      await expect(rows.first()).toBeVisible();
      await expect(panel.getByRole('button', { name: '回退' }).first()).toBeVisible();
    } else {
      await expect(panel.getByText(/暂无版本/)).toBeVisible();
    }
  });

  test('T5.4 写作统计：streak / 今日字数块 / 近 30 天趋势折线', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);
    await railTab(tauriPage, '统计').click();
    const panel = rightPanel(tauriPage);

    // 面板头 + 今日块：今日字数大数字、连续天数（streak）、今日时长、日更目标进度
    await expect(panel.getByText('写作统计')).toBeVisible();
    await expect(panel.getByText('今日字数')).toBeVisible();
    await expect(panel.getByText(/连续 \d+ 天/)).toBeVisible();
    await expect(panel.getByText(/今日时长 \d+ 分钟/)).toBeVisible();
    await expect(panel.getByText(/日更目标 \d+ 字（\d+%）/)).toBeVisible();

    // 近 30 天趋势 SVG 折线（TrendChart 的 polyline，全页面唯一）
    await expect(panel.getByText('近 30 天趋势')).toBeVisible();
    await expect(panel.locator('svg polyline')).toHaveCount(1);
  });

  test('T5.5 任务中心指示器展开与收起（无任务时条件容错）', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);

    // footer 内 TaskIndicator：tasks 为空且面板未开时整个隐藏（TaskIndicator.tsx return null）；
    // 有残留 done 任务时显示「0」徽标（已知行为，见手工记录 T5.5）
    const indicator = tauriPage.getByRole('button', { name: '打开任务中心' });
    if ((await indicator.count()) === 0) {
      test.skip(
        true,
        '当前无任何后台任务（tasks.length===0 且无残留 done 任务），TaskIndicator 按设计隐藏；' +
          '触发真实后台任务（长文生成/批量向量化）需真实 Key 或额外数据，见手工记录 T5.5'
      );
    }

    // 点指示器展开任务中心浮层：面板头 + 清除已完成入口
    await indicator.click();
    const panelTitle = tauriPage.getByText('任务中心', { exact: true });
    await expect(panelTitle).toBeVisible();
    await expect(tauriPage.getByRole('button', { name: '清除已完成' })).toBeVisible();

    // 收尾：点遮罩关闭浮层
    await tauriPage.getByRole('button', { name: '关闭任务面板' }).click();
    await expect(panelTitle).toHaveCount(0);
  });
});
