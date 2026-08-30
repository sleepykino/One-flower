import type { Locator, Page } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';
import { acceptNativeDialog } from './helpers/native-dialog';

// 对应 doc/自动化测试计划.md「阶段 3：设定类面板」（T3.1–T3.5）。
// 实测行为与选择器依据 doc/自动化测试记录.md「阶段 3：设定类面板」
// 与「阶段 3 改进项闭环」两节（2026-08-25），关键事实：
// - 角色卡 / 世界书条目删除走 confirmDialog（原生 ask，标题「确认操作」）；伏笔删除无确认弹窗直接删
// - 世界书条目有「启用」checkbox（禁用 = 半透明 +「已禁用」徽标 + 计数「· 启用 x」，改进闭环新增）；
//   正文输入后 800ms 内连按 [ [ 两次触发条目引用弹窗，插入 span.node-worldbookRef 原子节点；
//   删除条目会联动清理正文中的 [[引用]]（确认文案：「正文中的 [[引用]] 将一并移除」）
// - 伏笔 resolved 态渲染「重新打开」按钮（改进闭环新增）；planted ↔ abandoned 可互转；
//   时间线视图含「全部/未回收/已回收/已放弃」四档过滤按钮
// - 角色关系图连线为两步点击式（＋ 连线 → 点起点 → 点终点），非拖拽 handle；
//   节点由本书角色自动生成并圆形布局，无手动添加节点 UI；节点位置不持久化（设计行为）
// - 文件 open/save 原生对话框 CDP 无法自动化（WebView2 模态消息循环拦截键盘输入）：
//   凡涉及「导出/导入模板」「导出/导入」的点击一律不执行，仅在注释中标 MANUAL（见 T3.5）
//
// 约定（沿用 phase2-editor.spec.ts，helper 为本文件局部副本、不做跨文件 import）：
// - 每条用例独立创建 TEST-E2E-P3-* 书籍并在 afterEach 自清理，互不依赖执行顺序
// - 右侧 rail 按钮的可访问名来自 title 属性；「角色」是「角色采访」的前缀，必须 exact 精确匹配

const RUN = Date.now().toString(36);

function uniqueBook(): string {
  return `TEST-E2E-P3-${RUN}-${Math.floor(Math.random() * 1e4)}`;
}

/** 本轮创建的书籍，afterEach 统一删除 */
const createdBooks: string[] = [];

// ---------- 通用 helper（复制自 phase2-editor.spec.ts 的局部模式） ----------

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

/** 删除书籍：hover 卡片显示删除按钮 → 软件内确认框 确认 → 卡片消失 */
async function deleteBook(page: Page, title: string): Promise<void> {
  await page.goto(APP_URL + '/');
  const card = bookCard(page, title);
  await card.hover();
  // P6：删除入口移入 ⋮ 菜单（软删除移入回收站）
  await card.getByRole('button', { name: '更多操作' }).click();
  await card.getByRole('button', { name: '删除' }).click();
  await acceptNativeDialog(page);
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

// ---------- 阶段 3 专属 helper ----------

/** 编辑器右侧面板内容区（页面 aside 数量随上下文变化：创建章节后 main 内会多一个「章节节拍」aside，
 *  故用 .last() 而非 nth(1)；右侧面板恒为最后一个 complementary） */
function rightPanel(page: Page): Locator {
  return page.getByRole('complementary').last();
}

/** 右侧竖排 icon rail 按钮：按钮 aria-label 为「打开X面板」，用稳定的 data-rail-tab 属性定位。
 *  key 即 Editor.tsx RIGHT_TAB_GROUPS 中的 tab key（ai/skills/context/characters/…） */
function railTab(page: Page, key: string): Locator {
  return page.locator(`[data-rail-tab="${key}"]`);
}

/** 动态表单字段：按 label 标题定位其所在 div.mb-3 内的 input/textarea。
 *  CharacterForm 的 label 与控件无 for/id 关联，不能 getByLabel；
 *  必填字段的 label 渲染文本为「姓名 *」（hasText 子串匹配可命中） */
function formField(scope: Locator, title: string): Locator {
  return scope.locator('div.mb-3').filter({ hasText: title }).locator('input, textarea').first();
}

/** hover 才显示的按钮（hidden group-hover:block）：先 hover 再常规 click；
 *  CDP 下 Playwright 可见性判定可能超时，此时退化为 JS 程序化触发 onClick
 *  （doc/自动化测试记录.md 阶段 3 沉淀的绕行方案，React onClick 正常生效） */
async function clickHiddenButton(item: Locator, name: string): Promise<void> {
  const btn = item.getByRole('button', { name });
  await item.hover();
  try {
    await btn.click({ timeout: 3_000 });
  } catch {
    await btn.dispatchEvent('click');
  }
}

/** 角色列表中的一张角色卡行 */
function charCard(page: Page, name: string): Locator {
  return rightPanel(page).locator('div.group.cursor-pointer').filter({ hasText: name });
}

/** 在角色面板新建一张角色卡并等待回到列表 */
async function createCharacter(page: Page, name: string, personality: string): Promise<void> {
  const panel = rightPanel(page);
  await panel.getByRole('button', { name: '新建', exact: true }).click();
  await expect(panel.getByText('新建角色', { exact: true })).toBeVisible();
  await formField(panel, '姓名').fill(name);
  if (personality) await formField(panel, '性格').fill(personality);
  await panel.getByRole('button', { name: '保存' }).click();
  await expect(charCard(page, name)).toBeVisible({ timeout: 5_000 });
}

/** 角色关系图全屏 overlay（bg-white，区别于 SchemaBuilder 遮罩的 bg-black/40） */
function graphOverlay(page: Page): Locator {
  return page.locator('div.fixed.inset-0.z-50.bg-white');
}

/** 读取 React Flow 节点的视口中心坐标 */
async function nodeCenter(node: Locator): Promise<{ x: number; y: number }> {
  const bb = (await node.boundingBox())!;
  return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
}

/** React Flow 节点拖拽：mouse 步进移动（12 步 × 30ms，测试记录中实测可靠的拖法，
 *  步进可稳定触发 d3-drag 的 dragstart/dragover 序列） */
async function dragNode(page: Page, node: Locator, dx: number, dy: number): Promise<void> {
  const c = await nodeCenter(node);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(c.x + (dx * i) / steps, c.y + (dy * i) / steps);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

/** 伏笔列表中的一条记录 */
function foreshadowItem(page: Page, desc: string): Locator {
  return rightPanel(page).locator('div.group').filter({ hasText: desc });
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

test.describe('阶段 3：设定类面板', () => {
  test('T3.1 角色 CRUD + SchemaBuilder 模板字段增删排序', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    const panel = rightPanel(tauriPage);

    await railTab(tauriPage, 'characters').click();
    await expect(panel.getByText('角色卡（0）')).toBeVisible();

    // 新建角色卡：默认模板 6 个输入位（姓名* 为单行 input，外貌/性格/背景/关系为多行 textarea，
    // 「标签（顿号分隔）」为独立受控输入），全部填写
    await panel.getByRole('button', { name: '新建', exact: true }).click();
    await expect(panel.getByText('新建角色', { exact: true })).toBeVisible();
    await formField(panel, '姓名').fill('TEST-林晚照');
    await formField(panel, '外貌').fill('青衣长剑，眉目清冷');
    await formField(panel, '性格').fill('冷峻孤高，剑不离身');
    await formField(panel, '背景').fill('雾谷守灯人后代');
    await formField(panel, '关系').fill('与师父亦师亦敌');
    await formField(panel, '标签').fill('主角、剑客');
    await panel.getByRole('button', { name: '保存' }).click();

    // 卡片出现 + 头部计数「角色卡（1）」+ 副文本显示性格（summarizeData 取 personality 前 40 字）
    await expect(panel.getByText('角色卡（1）')).toBeVisible();
    const card = charCard(tauriPage, 'TEST-林晚照');
    await expect(card).toContainText('冷峻孤高，剑不离身');

    // 点击卡片行进入编辑态：标题变「编辑角色」+ 字段预填
    await card.click();
    await expect(panel.getByText('编辑角色', { exact: true })).toBeVisible();
    await expect(formField(panel, '姓名')).toHaveValue('TEST-林晚照');
    await expect(formField(panel, '性格')).toHaveValue('冷峻孤高，剑不离身');
    await expect(formField(panel, '背景')).toHaveValue('雾谷守灯人后代');

    // 修改保存后列表卡片副文本即时同步
    await formField(panel, '性格').fill('外冷内热，重诺守信');
    await panel.getByRole('button', { name: '保存' }).click();
    await expect(charCard(tauriPage, 'TEST-林晚照')).toContainText('外冷内热，重诺守信');

    // 再次进入编辑态并打开 SchemaBuilder 弹窗
    await charCard(tauriPage, 'TEST-林晚照').click();
    await panel.getByRole('button', { name: '编辑模板' }).click();
    const builder = tauriPage.locator('div.fixed.inset-0.z-50');
    await expect(builder).toBeVisible();
    await expect(builder.getByText('模板构建器 · 默认模板')).toBeVisible();
    // MANUAL：头部「导入模板 / 导出模板」调用原生 open/save 文件对话框，CDP 无法自动化，不点击

    // 默认模板 5 字段（name/appearance/personality/background/relationships）+ 右侧实时预览逐字段渲染
    const rows = builder.locator('div.mb-1\\.5'); // 字段行（类名 mb-1.5 的 CSS 转义）
    await expect(rows).toHaveCount(5);
    await expect(builder.getByText('key: name · 文本')).toBeVisible();
    await expect(builder.getByText('key: relationships · 多行')).toBeVisible();

    // 点「＋ 标签」新增字段：默认 key=field6 → 经受控输入改 key/标题 → 预览同步
    await builder.getByRole('button', { name: '＋ 标签' }).click();
    await expect(rows).toHaveCount(6);
    const newKeyInput = rows.nth(5).locator('input[placeholder="key（英文）"]');
    await expect(newKeyInput).toHaveValue('field6');
    await newKeyInput.fill('affiliation');
    await rows.nth(5).locator('input[placeholder="显示标题"]').fill('门派');
    await expect(builder.getByText('key: affiliation · 标签')).toBeVisible();

    // ↑ 上移至 relationships 之前，预览顺序同步更新
    await rows.nth(5).getByTitle('上移').click();
    await expect(rows.nth(4).locator('input[placeholder="key（英文）"]')).toHaveValue('affiliation');
    const preview = await builder.innerText(); // key: xxx 小字仅存在于预览区
    expect(preview.indexOf('key: affiliation')).toBeGreaterThanOrEqual(0);
    expect(preview.indexOf('key: affiliation')).toBeLessThan(preview.indexOf('key: relationships'));

    // × 删除新增字段恢复默认 5 字段，预览不再出现
    await rows.nth(4).getByTitle('删除字段').click();
    await expect(rows).toHaveCount(5);
    await expect(builder.getByText('key: affiliation · 标签')).toHaveCount(0);

    // 关闭构建器回到表单，再取消回列表
    await builder.getByRole('button', { name: '关闭' }).click();
    await expect(builder).toHaveCount(0);
    await panel.getByRole('button', { name: '取消' }).click();
    await expect(panel.getByText('角色卡（1）')).toBeVisible();

    // 删除角色（hover 才显示的文字按钮 + 软件内确认框「确认操作」）→ 回空态
    await clickHiddenButton(charCard(tauriPage, 'TEST-林晚照'), '删除');
    await acceptNativeDialog(tauriPage);
    await expect(charCard(tauriPage, 'TEST-林晚照')).toHaveCount(0);
    await expect(panel.getByText('角色卡（0）')).toBeVisible();
    await expect(panel.getByText(/暂无角色/)).toBeVisible();
  });

  test('T3.2 角色关系图——圆形布局/节点拖拽/两步连线/重排/持久化', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    const panel = rightPanel(tauriPage);

    await railTab(tauriPage, 'characters').click();
    await expect(panel.getByText('角色卡（0）')).toBeVisible();
    await createCharacter(tauriPage, 'TEST-林晚照', '冷峻孤高');
    await createCharacter(tauriPage, 'TEST-沈孤舟', '狂放不羁');
    await expect(panel.getByText('角色卡（2）')).toBeVisible();

    // 打开关系图：全屏 overlay，节点由本书角色自动生成（圆形布局，两点在同一垂直线上）
    await panel.getByRole('button', { name: '关系图' }).click();
    const overlay = graphOverlay(tauriPage);
    await expect(overlay).toBeVisible();
    await expect(overlay.getByText('角色关系图')).toBeVisible();
    const nodes = tauriPage.locator('.react-flow__node');
    await expect(nodes).toHaveCount(2);
    await tauriPage.waitForTimeout(600); // 等 fitView 缩放布局稳定后再取坐标

    // 节点拖拽：步进 mouse 拖动第一个节点，另一节点位置不受影响
    const before1 = await nodeCenter(nodes.nth(0));
    const before2 = await nodeCenter(nodes.nth(1));
    await dragNode(tauriPage, nodes.nth(0), 190, 90);
    await tauriPage.waitForTimeout(300); // 等 onNodesChange 受控更新落位
    const after1 = await nodeCenter(nodes.nth(0));
    const after2 = await nodeCenter(nodes.nth(1));
    expect(Math.hypot(after1.x - before1.x, after1.y - before1.y)).toBeGreaterThan(80);
    expect(Math.abs(after2.x - before2.x)).toBeLessThan(5);
    expect(Math.abs(after2.y - before2.y)).toBeLessThan(5);

    // 两步点击连线：＋ 连线 → 提示「点击第一个角色」→ 点起点 → 点终点 → 边出现且工具条复位
    const linkBtn = overlay.getByRole('button', { name: '＋ 连线' });
    await linkBtn.click();
    await expect(overlay.getByText('点击第一个角色')).toBeVisible();
    await nodes.nth(0).click(); // pending 态下单击 = 选起点（非 pending 单击会打开角色卡，勿混淆）
    await expect(overlay.getByText(/从「TEST-林晚照」连到/)).toBeVisible();
    await nodes.nth(1).click(); // 第二次点击创建关系并刷新画布
    const edges = tauriPage.locator('.react-flow__edge');
    await expect(edges).toHaveCount(1, { timeout: 8_000 }); // 关系创建为异步 invoke，轮询等待
    await expect(linkBtn).toBeVisible(); // 工具条复位回「＋ 连线」

    // 重排：两节点回到圆形布局初始位（同一圆上 x 坐标相同）
    await overlay.getByRole('button', { name: '重排' }).click();
    await tauriPage.waitForTimeout(300);
    const rearranged1 = await nodeCenter(nodes.nth(0));
    const rearranged2 = await nodeCenter(nodes.nth(1));
    expect(Math.abs(rearranged1.x - rearranged2.x)).toBeLessThan(8);

    // 关闭后重开：节点数与边均持久化（仅角色删除才级联清理关系数据；节点位置不持久化为设计行为）
    await overlay.getByRole('button', { name: '关闭' }).click();
    await expect(overlay).toHaveCount(0);
    await panel.getByRole('button', { name: '关系图' }).click();
    await expect(overlay).toBeVisible();
    await expect(nodes).toHaveCount(2);
    await expect(edges).toHaveCount(1);

    // 收尾：删除两个角色（原生确认）后重开关系图为空态——角色删除级联清理关系数据
    await overlay.getByRole('button', { name: '关闭' }).click();
    await expect(overlay).toHaveCount(0);
    for (const name of ['TEST-林晚照', 'TEST-沈孤舟']) {
      await clickHiddenButton(charCard(tauriPage, name), '删除');
      await acceptNativeDialog(tauriPage);
      await expect(charCard(tauriPage, name)).toHaveCount(0);
    }
    await panel.getByRole('button', { name: '关系图' }).click();
    await expect(nodes).toHaveCount(0);
    await expect(overlay.getByText('暂无角色，请先在角色面板新建')).toBeVisible();
  });

  test('T3.3 世界书条目——启停开关、正文 [[ 引用与删除联动清理', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    const panel = rightPanel(tauriPage);
    await createChapter(tauriPage, '引章');

    await railTab(tauriPage, '世界书').click();
    await expect(panel.getByText('世界书（0）')).toBeVisible();
    // MANUAL：头部「导出 / 导入」调用原生 save/open 文件对话框，CDP 无法自动化，不点击

    // 新建条目：标题 + 分类下拉（地点/势力/物品/事件/其他）+ 内容
    await panel.getByRole('button', { name: '新建', exact: true }).click();
    await expect(panel.getByText('新建条目', { exact: true })).toBeVisible();
    await panel.getByPlaceholder('标题，如：青云剑派').fill('TEST-雾隐山灵境');
    await panel.locator('select').selectOption({ label: '地点' }); // 编辑态唯一的 select 即分类
    await panel.getByPlaceholder(/设定内容/).fill('终年雾锁的山峰，山中藏有上古阵法遗迹。');
    await panel.getByRole('button', { name: '保存' }).click();

    const entry = panel.locator('div.group.cursor-pointer').filter({ hasText: 'TEST-雾隐山灵境' });
    await expect(entry).toBeVisible();
    await expect(panel.getByText('世界书（1）')).toBeVisible();

    // 启停开关：取消勾选「启用」→ 出现「已禁用」徽标 + 条目半透明 + 计数变为「· 启用 0」
    await entry.getByRole('checkbox').click();
    await expect(entry.getByText('已禁用', { exact: true })).toBeVisible();
    await expect(panel.getByText('世界书（1 · 启用 0）')).toBeVisible();
    expect(await entry.getAttribute('class')).toContain('opacity-60');

    // 重新勾选恢复启用：徽标消失、计数还原
    await entry.getByRole('checkbox').click();
    await expect(panel.getByText('世界书（1）')).toBeVisible();
    await expect(entry.getByText('已禁用', { exact: true })).toHaveCount(0);

    // 正文 [[ 引用：输入文字后在 800ms 内连按 [ 两次 → 弹窗列出条目 → 点击插入 inline 原子节点
    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();
    await pm.pressSequentially('他远远望见');
    await pm.press('[');
    await tauriPage.waitForTimeout(120); // 与下一次按键间隔须 <800ms 才触发 [[ 弹窗
    await pm.press('[');
    const popup = tauriPage.locator('div.fixed.z-50.w-60'); // MentionPopup（与 @/## 弹窗同组件）
    await expect(popup).toContainText('选择世界书条目（[[引用]]）');
    await popup.getByRole('button', { name: 'TEST-雾隐山灵境' }).click();

    const refNode = pm.locator('span.node-worldbookRef');
    await expect(refNode).toHaveCount(1);
    await expect(refNode).toHaveText('[[TEST-雾隐山灵境]]');
    await expect(refNode).toHaveAttribute('data-worldbook-ref', '');

    // Ctrl+S 落盘
    await pm.press('Control+s');
    await expect.poll(() => saveState(tauriPage), { timeout: 5_000 }).toBe('已保存');

    // 删除条目：hover 才显示的「删除」+ 软件内确认框（文案含「正文中的 [[引用]] 将一并移除」）
    await clickHiddenButton(entry, '删除');
    await acceptNativeDialog(tauriPage);
    await expect(panel.getByText('世界书（0）')).toBeVisible();

    // 联动清理：正文中指向该条目的引用节点被同步移除（当前章节自动重载，轮询等待完成）
    await expect(refNode).toHaveCount(0, { timeout: 8_000 });
  });

  test('T3.4 伏笔管理——状态流转、重新打开、时间线过滤、无确认删除', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    const panel = rightPanel(tauriPage);
    await createChapter(tauriPage, '章甲');
    await createChapter(tauriPage, '章乙');

    await railTab(tauriPage, 'foreshadow').click();
    await expect(panel.getByText('伏笔追踪（0）')).toBeVisible();
    await expect(panel.getByText('暂无伏笔记录。')).toBeVisible();

    // 添加第一条：描述 input + 埋设章节 select（回收章节留空 → 初始状态 planted）
    const descInput = panel.getByPlaceholder('伏笔描述，如：主角背上的胎记');
    const plantSelect = panel.locator('select').first(); // 表单区两个 select：埋设 / 回收
    await descInput.fill('TEST-胎记谜纹');
    await plantSelect.selectOption({ label: '章甲' });
    await panel.getByRole('button', { name: '添加', exact: true }).click();

    const mark = foreshadowItem(tauriPage, 'TEST-胎记谜纹');
    await expect(mark).toBeVisible();
    await expect(mark.getByText('已埋设', { exact: true })).toBeVisible(); // 状态徽标
    await expect(mark).toContainText('埋设：章甲 · 回收：—');
    // planted 态操作区：标记已回收 / 放弃；隐藏「标记已埋设」与「重新打开」
    await expect(mark.getByRole('button', { name: '标记已回收' })).toBeVisible();
    await expect(mark.getByRole('button', { name: '放弃' })).toBeVisible();
    await expect(mark.getByRole('button', { name: '标记已埋设' })).toHaveCount(0);
    await expect(mark.getByRole('button', { name: '重新打开' })).toHaveCount(0);

    // planted → resolved：徽标变「已回收」，整个操作区只剩「重新打开」（改进闭环新增的回退入口）
    await mark.getByRole('button', { name: '标记已回收' }).click();
    await expect(mark.getByText('已回收', { exact: true })).toBeVisible();
    await expect(mark.getByRole('button', { name: '重新打开' })).toBeVisible();
    await expect(mark.getByRole('button', { name: '标记已回收' })).toHaveCount(0);
    await expect(mark.getByRole('button', { name: '放弃' })).toHaveCount(0);

    // resolved → planted：点「重新打开」回到「已埋设」，操作区恢复
    await mark.getByRole('button', { name: '重新打开' }).click();
    await expect(mark.getByText('已埋设', { exact: true })).toBeVisible();
    await expect(mark.getByRole('button', { name: '标记已回收' })).toBeVisible();

    // 第二条：abandoned ↔ planted 互转
    await descInput.fill('TEST-黑手线索');
    await plantSelect.selectOption({ label: '章乙' });
    await panel.getByRole('button', { name: '添加', exact: true }).click();
    const clue = foreshadowItem(tauriPage, 'TEST-黑手线索');
    await expect(clue.getByText('已埋设', { exact: true })).toBeVisible();

    await clue.getByRole('button', { name: '放弃' }).click();
    await expect(clue.getByText('已放弃', { exact: true })).toBeVisible();
    await expect(clue.getByRole('button', { name: '标记已埋设' })).toBeVisible();
    await expect(clue.getByRole('button', { name: '标记已回收' })).toHaveCount(0);

    await clue.getByRole('button', { name: '标记已埋设' }).click();
    await expect(clue.getByText('已埋设', { exact: true })).toBeVisible();

    // 为让下方「未回收 / 已放弃」过滤隔离断言（457-465 行）成立，
    // 黑手线索在验证完 abandoned ↔ planted 互转后最终停在 abandoned
    await clue.getByRole('button', { name: '放弃' }).click();
    await expect(clue.getByText('已放弃', { exact: true })).toBeVisible();

    // 时间线视图：两条伏笔渲染 + 未回收高亮提示 + 四档状态过滤按钮齐全
    await panel.getByRole('button', { name: '时间线', exact: true }).click();
    await expect(panel.getByText(/当前有 1 处未回收伏笔/)).toBeVisible();
    for (const filter of ['全部', '未回收', '已回收', '已放弃']) {
      await expect(panel.getByRole('button', { name: filter, exact: true })).toBeVisible();
    }
    await expect(panel.getByText('伏笔（2）')).toBeVisible();
    await expect(panel.getByText('TEST-胎记谜纹')).toBeVisible();
    await expect(panel.getByText('TEST-黑手线索')).toBeVisible();

    // 「未回收」（planted）过滤：仅剩胎记谜纹，黑手线索被隔离
    await panel.getByRole('button', { name: '未回收', exact: true }).click();
    await expect(panel.getByText('TEST-胎记谜纹')).toBeVisible();
    await expect(panel.getByText('TEST-黑手线索')).toHaveCount(0);

    // 「已放弃」过滤：仅剩黑手线索
    await panel.getByRole('button', { name: '已放弃', exact: true }).click();
    await expect(panel.getByText('TEST-黑手线索')).toBeVisible();
    await expect(panel.getByText('TEST-胎记谜纹')).toHaveCount(0);

    // 「已回收」过滤：当前无 resolved 记录 → 过滤空态
    await panel.getByRole('button', { name: '已回收', exact: true }).click();
    await expect(panel.getByText('当前过滤条件下无伏笔。')).toBeVisible();
    await panel.getByRole('button', { name: '全部', exact: true }).click();

    // 回列表收尾：hover「删除」点击后直接删（源码 remove 无 confirmDialog，实测无弹窗，
    // 故此处刻意不调 acceptNativeDialog——若误弹确认框后续断言必然失败）
    await panel.getByRole('button', { name: '列表', exact: true }).click();
    await clickHiddenButton(foreshadowItem(tauriPage, 'TEST-胎记谜纹'), '删除');
    await expect(foreshadowItem(tauriPage, 'TEST-胎记谜纹')).toHaveCount(0);
    await clickHiddenButton(foreshadowItem(tauriPage, 'TEST-黑手线索'), '删除');
    await expect(foreshadowItem(tauriPage, 'TEST-黑手线索')).toHaveCount(0);
    await expect(panel.getByText('暂无伏笔记录。')).toBeVisible();
    await expect(panel.getByText('伏笔追踪（0）')).toBeVisible();
  });

  test('T3.5 JSON 导入导出（MANUAL——原生文件对话框不可自动化）', async () => {
    // 对应计划 T3.5。涉及路径均调用 plugin-dialog 的 open()/save() 原生文件对话框：
    // - SchemaBuilder 头部「导入模板 / 导出模板」
    // - 世界书面板头部「导入 / 导出」
    // 经实测（doc/自动化测试记录.md「阶段 3 改进项闭环」）：AppActivate 可命中窗口，
    // 但 SendKeys 直输 / 剪贴板粘贴均无法写入文件名框（WebView2 模态消息循环拦截键盘自动化），
    // CDP 无法操作 open/save 类对话框 → 转人工验证路径：
    // - 角色面板 → 编辑模板 → 导入模板 / 导出模板
    // - 世界书面板 → 导入（样本 mcp/worldbook-import-test.json）/ 导出
    // 注：删除确认类原生弹窗（ask，标题「确认操作」）不受此限，
    // 已在 T3.1 / T3.3 以 acceptNativeDialog 完成自动化。
    test.skip(true, 'open/save 原生文件对话框无法通过 CDP 自动化，转人工验证（MANUAL）');
  });
});
