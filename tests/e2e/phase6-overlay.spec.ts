import type { Page } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';
import { acceptNativeDialog } from './helpers/native-dialog';

// 对应 doc/自动化测试计划.md 阶段 6「Overlay 与导出」（已于 2026-08-25 手工验证通过，
// 记录见 doc/自动化测试记录.md「阶段 6：Overlay 与导出」）
//
// 约定（沿用 phase2-editor.spec.ts，复制勿 import）：
// - 每条用例独立创建 TEST-E2E-P6-* 书籍并在 afterEach 自清理，互不依赖执行顺序
// - 每条用例先建一个章节作为编辑器载体（overlay 入口在顶栏，章节非必需，
//   但图片生成/剧本向导依赖正文与章节数据，统一前置最稳妥）
//
// 关键交互源码核实结论（编写前逐文件核对）：
// - 世界构建下拉：顶栏「世界构建」→ 菜单项 地图 / 时间线 / 命名生成（Editor.tsx）
// - MapEditor overlay 容器类名 fixed inset-0 z-50；工具 active 样式 =
//   border-violet-300 + bg-violet-50（MapEditor.tsx TOOLS 栅格）；B/E 为 window 级
//   keydown 快捷键（目标为 INPUT/TEXTAREA/SELECT/contentEditable 时忽略）
// - MapGenDialog 预设卡 label 以 terrainPresets.ts 为准：
//   环岛/群岛/大块陆地/大岛屿/小岛屿/泛大陆/半岛；「生成」走 generateTerrainPreset
//   （本地 seeded 算法，无外部调用）——可以点击；结果落新瓦片层（图层名「生成 HH:MM」）
// - TimelineView 新建事件表单字段：标题/描述/所属时间线/关联章节/关联角色
// - NameGenerator 双 tab（生成/收藏夹）+ 类型下拉（角色/地点/招式/势力）+
//   性别（仅角色）+ 数量(1-20) + 提示输入框
// - ExportDialog 容器是 z-40（注意与其他 overlay 的 z-50 区分）；格式五选项以
//   FORMAT_LABEL 为准；单章范围时备份包 option disabled
// - ImageGenDialog 两段式表单：场景描述 textarea + 补充要求 input + 尺寸/候选数量
//   下拉 + 高级模式勾选；无选中文本时 NovelEditor.openIllustrationGen 只弹 toast 且不开窗
//
// ⚠️ 硬约束——以下按钮一律不点（真实外部调用或系统级副作用），用注释标注：
//   1) 命名生成器的「生成」（LLM 外部调用）
//   2) AdaptWizard 的「生成大纲」（LLM 外部调用）
//   3) 导出对话框的「选择路径并导出」（触发原生 save 文件对话框）
//   4) 图片生成的「生成（N 张候选）」（走图片 Provider 外部调用）

const RUN = Date.now().toString(36);

function uniqueBook(): string {
  return `TEST-E2E-P6-${RUN}-${Math.floor(Math.random() * 1e4)}`;
}

/** 本轮创建的书籍，afterEach 统一删除 */
const createdBooks: string[] = [];

// ---------- 通用 helper（复制自 phase2-editor.spec.ts）----------

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

/** 创建书籍并进入其编辑器（空书，无任何章节） */
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

/** 编辑器工具栏按钮（限定 main 区，避免命中右侧面板同名按钮） */
function toolbar(page: Page, name: string) {
  return page.getByRole('main').getByRole('button', { name });
}

// ---------- 本阶段专用 helper ----------

/** 建书 → 进编辑器 → 建一个载体章节（本阶段各用例的统一前置） */
async function openEditorWithChapter(page: Page): Promise<string> {
  const title = await openFreshEditor(page);
  await createChapter(page, '载体章');
  return title;
}

/** 打开顶栏「世界构建」下拉并进入子项（地图 / 时间线 / 命名生成）。
 *  菜单按钮的可访问名含说明后缀（如「地图 世界地图编辑」），用前缀正则匹配。 */
async function openWorldBuild(page: Page, item: '地图' | '时间线' | '命名生成'): Promise<void> {
  await page.getByRole('button', { name: '世界构建' }).click();
  await page.getByRole('button', { name: new RegExp(`^${item}`) }).click();
}

/** 全屏 overlay 容器（MapEditor/TimelineView/NameGenerator/ImageGenDialog 均为
 *  fixed inset-0 z-50，按标题文本区分）；ExportDialog 例外为 z-40 */
function fullscreenOverlay(page: Page, titleText: string) {
  return page.locator('div.fixed.inset-0.z-50', { hasText: titleText });
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

test.describe('阶段 6：Overlay 与导出', () => {
  test('T6.1 世界地图：工具集 / B·E 快捷键高亮 / 预设生成本地算法 / × 关闭', async ({ tauriPage }) => {
    await openEditorWithChapter(tauriPage);
    await openWorldBuild(tauriPage, '地图');

    const mapOv = fullscreenOverlay(tauriPage, '地图编辑');
    await expect(mapOv.getByText('地图编辑')).toBeVisible();
    // Konva 画布渲染完成（同时意味着 currentMap 已自动创建就绪）
    await expect(mapOv.locator('.konvajs-content').first()).toBeVisible();

    // 左侧工具栅格九件套（label 以 MapEditor.tsx TOOLS 为准）
    const toolGrid = mapOv.locator('div.grid.grid-cols-3');
    const tools = ['选择', '抓手', '笔刷', '橡皮', '填充', '吸管', '连线', '区域', '删除'];
    for (const t of tools) {
      await expect(toolGrid.getByRole('button', { name: t, exact: true })).toBeVisible();
    }

    // 先点「笔刷」确立基态（按钮获得焦点，window 级快捷键才不会被输入框吞掉）
    const brushBtn = toolGrid.getByRole('button', { name: '笔刷', exact: true });
    const eraserBtn = toolGrid.getByRole('button', { name: '橡皮', exact: true });
    const classOf = async (btn: ReturnType<typeof toolGrid.getByRole>): Promise<string> =>
      (await btn.getAttribute('class')) ?? '';
    await brushBtn.click();

    // 按 E → 橡皮 active 高亮（border-violet-300 + bg-violet-50），笔刷退态
    await tauriPage.keyboard.press('e');
    expect(await classOf(eraserBtn)).toContain('border-violet-300');
    expect(await classOf(eraserBtn)).toContain('bg-violet-50');
    expect(await classOf(brushBtn)).not.toContain('border-violet-300');

    // 按 B → 切回笔刷
    await tauriPage.keyboard.press('b');
    expect(await classOf(brushBtn)).toContain('border-violet-300');
    expect(await classOf(brushBtn)).toContain('bg-violet-50');
    expect(await classOf(eraserBtn)).not.toContain('border-violet-300');

    // 「预设生成」打开 MapGenDialog：预设卡 + 参数滑杆 + seed
    await mapOv.getByRole('button', { name: '预设生成' }).click();
    const genPanel = mapOv.locator('div.absolute[class*="right-64"]', { hasText: '预设地形生成' });
    await expect(genPanel.getByText('预设地形生成')).toBeVisible();
    for (const label of ['环岛', '群岛', '大块陆地', '大岛屿', '小岛屿', '泛大陆', '半岛']) {
      await expect(genPanel.getByRole('button', { name: label })).toBeVisible();
    }
    expect((await genPanel.locator('input[type="range"]').count())).toBeGreaterThanOrEqual(2);
    await expect(genPanel.locator('input[type="number"]')).toBeVisible(); // seed
    await expect(genPanel.getByText('锁定 seed')).toBeVisible();

    // 「生成」为本地 seeded 算法（generateTerrainPreset），可安全点击；
    // 同浮层的「AI 生成」才是 LLM 调用，绝不触碰
    await genPanel.getByRole('button', { name: '生成', exact: true }).click();
    // 断言对话框关闭，且画布出现生成的瓦片层（左侧「目标层」下拉新增「生成 HH:MM」图层）
    await expect(genPanel).toHaveCount(0);
    // 生成后「目标层」下拉新增「生成 HH:MM」图层：
    // 原生 <option> 对 Playwright 恒为 hidden，可见性断言必然失败，改用存在性断言（toHaveCount）
    await expect(
      mapOv.locator('aside select', { hasText: /生成 \d{2}:\d{2}/ })
    ).toHaveCount(1, { timeout: 8_000 });

    // 工具栏 ×（title=关闭）关闭 overlay（Esc 仅退出工具/菜单态，不关 overlay）
    await mapOv.locator('button[title="关闭"]').first().click();
    await expect(mapOv).toHaveCount(0);
  });

  test('T6.2 时间线：标题 / ＋新线 / 新建事件表单字段 / 取消与关闭', async ({ tauriPage }) => {
    await openEditorWithChapter(tauriPage);
    await openWorldBuild(tauriPage, '时间线');

    const tl = fullscreenOverlay(tauriPage, '时间线');
    await expect(tl.getByText('时间线', { exact: true })).toBeVisible();
    await expect(tl.getByRole('button', { name: '＋新线' })).toBeVisible();
    // 空书空数据时的泳道空态文案
    await expect(tl.getByText(/暂无时间线|暂无事件/).first()).toBeVisible();

    // 「新建事件」→ 表单字段齐全（不保存，避免写入测试数据）。
    // 注意：TimelineView 表单的 label 是控件的兄弟节点（非包裹式），
    // getByLabel 不生效，改用弹层容器内的控件类型/顺序定位
    await tl.getByRole('button', { name: '新建事件' }).click();
    const form = tl.locator('div.absolute.inset-0');
    await expect(form.getByText('新建事件')).toBeVisible();
    // 标题 input（表单内第一个 input，autoFocus）
    await expect(form.locator('input').first()).toBeVisible();
    // 描述 textarea
    await expect(form.locator('textarea')).toBeVisible();
    // 所属时间线 + 关联章节两个下拉；章节下拉含「（不关联）」空选项
    await expect(form.locator('select')).toHaveCount(2);
    await expect(form.locator('select').nth(1).locator('option', { hasText: '（不关联）' })).toBeAttached();
    // 关联角色区块（空书显示「暂无角色」占位）
    await expect(form.getByText('关联角色')).toBeVisible();

    // 取消关闭表单 → 头部 × 关闭 overlay
    await tl.getByRole('button', { name: '取消' }).click();
    await expect(tl.locator('div.absolute.inset-0')).toHaveCount(0);
    await tl.getByRole('button', { name: '×' }).click();
    await expect(tl).toHaveCount(0);
  });

  test('T6.3 命名生成：双 tab / 类型下拉 / 数量与提示输入（不点生成）', async ({ tauriPage }) => {
    await openEditorWithChapter(tauriPage);
    await openWorldBuild(tauriPage, '命名生成');

    const ng = fullscreenOverlay(tauriPage, '命名生成器');
    await expect(ng.getByText('命名生成器')).toBeVisible();

    // 双 tab：生成 / 收藏夹（带计数后缀）。「生成」tab 与 LLM 按钮「生成」同名，
    // 必须限定在头部 tab 条内定位
    const tabBar = ng.locator('div.flex.gap-1').first();
    await expect(tabBar.getByRole('button', { name: '生成', exact: true })).toBeVisible();
    await expect(tabBar.getByRole('button', { name: /^收藏夹/ })).toBeVisible();

    // 类型下拉四选项（TYPE_LABEL：角色/地点/招式/势力）；默认角色类型下性别下拉可见
    const typeSel = ng.locator('select').first();
    const typeOpts = await typeSel.locator('option').allInnerTexts();
    for (const o of ['角色', '地点', '招式', '势力']) {
      expect(typeOpts.some((t) => t.includes(o))).toBe(true);
    }
    await expect(ng.locator('select')).toHaveCount(3); // 类型 / 题材 / 性别

    // 数量输入（默认 10，1-20）与提示输入 placeholder
    await expect(ng.locator('input[type="number"]')).toHaveValue('10');
    await expect(ng.getByPlaceholder("如：姓林，单字 / 带'星'字")).toBeVisible();

    // 收藏夹 tab 可切换（空态文案），随后切回生成视图
    await tabBar.getByRole('button', { name: /^收藏夹/ }).click();
    await expect(ng.getByText(/暂无收藏/)).toBeVisible();
    await tabBar.getByRole('button', { name: '生成', exact: true }).click();

    // ⚠️ 绝不点击表单行的「生成」按钮（真实 LLM 外部调用）；直接 × 关闭 overlay
    await ng.getByRole('button', { name: '×' }).click();
    await expect(ng).toHaveCount(0);
  });

  test('T6.4 导出对话框：范围单选 / 五种格式 / 单章禁用备份包（不点导出）', async ({ tauriPage }) => {
    await openEditorWithChapter(tauriPage);
    // 顶栏「导出」按钮 → 对话框容器为 z-40（区别于其他 z-50 overlay）
    await tauriPage.getByRole('banner').getByRole('button', { name: '导出', exact: true }).click();
    const dlg = tauriPage.locator('div.fixed.inset-0.z-40', { hasText: '选择路径并导出' });
    await expect(dlg.getByText('导出', { exact: true })).toBeVisible();

    // 格式下拉五选项（FORMAT_LABEL 原文），默认全书范围时仅此一个下拉
    const fmtSel = dlg.locator('select');
    await expect(fmtSel).toHaveCount(1);
    const fmtOpts = await fmtSel.locator('option').allInnerTexts();
    for (const f of ['Markdown (.md)', '纯文本 (.txt)', 'EPUB 电子书 (.epub)', 'Word 文档 (.docx)', '备份包 (.zip)']) {
      expect(fmtOpts.some((t) => t.includes(f))).toBe(true);
    }
    // markdown 说明文案（插图落盘 images/）随默认格式展示
    await expect(dlg.getByText(/images\//)).toBeVisible();

    // 切到「单章」→ 出现章节下拉，且「备份包」option 变禁用（仅全书可打包）
    await dlg.locator('label', { hasText: '单章' }).locator('input[type="radio"]').check();
    await expect(dlg.locator('select')).toHaveCount(2);
    await expect(dlg.locator('select').first().locator('option', { hasText: '选择章节…' })).toBeAttached();
    expect(
      await dlg.locator('select').nth(1).locator('option', { hasText: '备份包' }).isDisabled()
    ).toBe(true);

    // ⚠️ 绝不点击「选择路径并导出」（触发原生 save 文件对话框）；「关闭」收尾
    await dlg.getByRole('button', { name: '关闭' }).click();
    await expect(dlg).toHaveCount(0);
  });

  test('T6.5 图片生成双分支：无选中仅 toast / 有选区打开两段式表单', async ({ tauriPage }) => {
    await openEditorWithChapter(tauriPage);

    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();
    await pm.pressSequentially('雾隐山的清晨，薄雾像一层纱，青鸟掠过檐角。');

    // 分支一（无选区）：光标塌陷态点「插图」→ 只弹前置校验 toast，不开对话框
    await toolbar(tauriPage, '插图').click();
    await expect(tauriPage.getByText('请先在正文中选中一段场景文字，再生成插图')).toBeVisible();

    // 分支二（有选区）：Selection API 选中 .ProseMirror 第一段全部内容
    await tauriPage.evaluate(() => {
      const p = document.querySelector('.ProseMirror p');
      if (!p) throw new Error('.ProseMirror 首段不存在');
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      if (!sel) throw new Error('无法获取 Selection');
      sel.removeAllRanges();
      sel.addRange(range);
    });
    // 等 TipTap onSelectionUpdate 把选区文本同步进 editorStore.selectedText
    //（随后点击工具栏会清除 DOM 选区，但 store 值已持久，判定不受影响）
    await tauriPage.waitForTimeout(300);
    await toolbar(tauriPage, '插图').click();

    const dlg = fullscreenOverlay(tauriPage, '生成正文插图');
    await expect(dlg.getByText('场景描述（中文）')).toBeVisible();
    // 场景描述 textarea 由选区文本预填，应为非空
    await expect(dlg.locator('textarea').first()).not.toHaveValue('');
    await expect(dlg.getByPlaceholder(/风格 \/ 构图 \/ 光影/)).toBeVisible(); // 补充要求
    await expect(dlg.getByText('尺寸', { exact: true })).toBeVisible();
    await expect(dlg.getByText('候选数量', { exact: true })).toBeVisible();
    await expect(dlg.locator('select')).toHaveCount(2); // 尺寸 + 候选数量
    await expect(dlg.getByText(/高级模式（手写英文 prompt/)).toBeVisible();
    await expect(dlg.getByRole('checkbox')).toBeVisible();

    // ⚠️ 绝不点击「生成（N 张候选）」（走图片 Provider 外部调用）；取消收尾
    await dlg.getByRole('button', { name: '取消' }).click();
    await expect(dlg).toHaveCount(0);
  });

  test('T6.6 剧本工作台：从章节转化 → AdaptWizard config 字段（不点生成大纲）', async ({ tauriPage }) => {
    await openEditorWithChapter(tauriPage);

    // rail「剧本」tab → 面板头部入口「从章节转化」（onOpen(undefined, true) 直进向导）
    await tauriPage.getByRole('navigation').getByRole('button', { name: '剧本', exact: true }).click();
    await tauriPage.getByRole('button', { name: '从章节转化' }).click();

    const wb = fullscreenOverlay(tauriPage, '剧本工作台');
    await expect(wb.getByText('剧本工作台')).toBeVisible();

    // AdaptWizard 第一步（config）：居中对话框 absolute inset-0
    const wizard = wb.locator('div.absolute.inset-0');
    await expect(wizard.getByText('从章节转化剧本')).toBeVisible();
    await expect(wizard.getByText(/第一步：选择章节范围与集数/)).toBeVisible();
    await expect(wizard.getByLabel('起始章节')).toBeVisible();
    await expect(wizard.getByLabel('结束章节')).toBeVisible();
    // 起始章节下拉已按本书章节预填
    const fromOpts = await wizard.getByLabel('起始章节').locator('option').allInnerTexts();
    expect(fromOpts.some((t) => t.includes('载体章'))).toBe(true);
    await expect(wizard.getByText(/^集数（\d+）$/)).toBeVisible();
    await expect(wizard.getByText(/^每集场次数（\d+）$/)).toBeVisible();
    expect((await wizard.locator('input[type="range"]').count())).toBe(2);
    await expect(wizard.getByPlaceholder('如：快节奏改编，合并支线，保留主线冲突')).toBeVisible();
    await expect(wizard.getByRole('button', { name: '生成大纲' })).toBeVisible();

    // ⚠️ 绝不点击「生成大纲」（LLM 外部调用，且会创建剧本记录）；取消向导并关闭工作台
    await wizard.getByRole('button', { name: '取消' }).click();
    await expect(wizard).toHaveCount(0);
    await wb.locator('button[title="关闭"]').first().click();
    await expect(wb).toHaveCount(0);
  });
});
