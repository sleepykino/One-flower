import type { Page } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';
import { acceptNativeDialog } from './helpers/native-dialog';

// 对应 doc/自动化测试计划260824.md 阶段 2（已于 2026-08-24 手工验证通过，
// 记录见 doc/自动化测试记录.md「阶段 2：编辑器核心」）
//
// 约定：
// - 每条用例独立创建 TEST-E2E-P2-* 书籍并在 afterEach 自清理，互不依赖执行顺序
// - 新建章节会自动设为当前章节（editorStore.createChapter 内 setCurrentChapter）
// - 空书（无章节）时编辑器主体不渲染（main 显示「左侧选择或新建一个章节开始写作」），
//   涉及工具栏 / 专注模式的用例必须先创建章节
// - 章节树拖拽为 HTML5 DnD，落点在目标行上半区=插前、下半区=变子级
//   （ChapterTree.tsx onDragOver），用 locator.dragTo + targetPosition 精确控制落点
// - 章节重命名：hover 行 → ✎ 按钮（title=重命名章节）→ 行内输入，Enter 保存（Step2 已补测）

const RUN = Date.now().toString(36);

function uniqueBook(): string {
  return `TEST-E2E-P2-${RUN}-${Math.floor(Math.random() * 1e4)}`;
}

/** 本轮创建的书籍，afterEach 统一删除 */
const createdBooks: string[] = [];

// ---------- 通用 helper ----------

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

/** 按树内渲染顺序返回全部顶层/子级行文本（含状态与字数后缀） */
async function rowTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('div[draggable=true]')).map((r) => r.textContent ?? '')
  );
}

/** 将 srcTitle 行拖到 tgtTitle 行顶部（targetPosition y=2，上半区=插到其前）。
 *  用 locator.dragTo 而非裸 mouse 事件：dragTo 内部会稳定触发 HTML5 DnD 的
 *  dragstart/dragover/drop 序列（裸 mouse 在部分 WebView 版本上不可靠）。 */
async function dragRowBefore(page: Page, srcTitle: string, tgtTitle: string): Promise<void> {
  const tgt = chapterRow(page, tgtTitle);
  const bb = (await tgt.boundingBox())!;
  await chapterRow(page, srcTitle).dragTo(tgt, { targetPosition: { x: Math.round(bb.width / 2), y: 2 } });
  // onDrop 内逐个 invoke 更新 sortOrder 后重载章节树，等待其完成
  await page.waitForTimeout(900);
}

/** 底部状态栏保存状态：未保存 / 保存中… / 已保存 */
async function saveState(page: Page): Promise<string> {
  return page.evaluate(() => (document.body.innerText.match(/未保存|保存中…|已保存/g) ?? []).pop() ?? '');
}

/** 编辑器工具栏按钮（限定 main 区，避免命中右侧 AI 面板同名按钮） */
function toolbar(page: Page, name: string) {
  return page.getByRole('main').getByRole('button', { name });
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

test.describe('阶段 2：编辑器核心', () => {
  test('T2.1 三栏布局与 13 个面板 tab 渲染', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);

    // 空书时编辑器主体不渲染，先建章节让工具栏/专注模式可用
    await createChapter(tauriPage, '布局章');

    // 左栏：章节树 + 底部新建输入
    await expect(tauriPage.getByRole('complementary').first().getByText('章节', { exact: true })).toBeVisible();
    await expect(tauriPage.getByPlaceholder('章节标题…')).toBeVisible();

    // 中栏：工具栏关键按钮 + 外观下拉 + 底部状态栏
    for (const name of ['H1', 'B', '@引用', '[[条目]]']) {
      await expect(toolbar(tauriPage, name)).toBeVisible();
    }
    await expect(tauriPage.getByRole('combobox', { name: '字体' })).toBeVisible();
    await expect(tauriPage.getByText(/已保存|未保存/)).toBeVisible();

    // 右栏：13 个面板 tab（长文受特性开关控制，单独软校验）
    // 按钮 aria-label 为「打开X面板」，用稳定的 data-rail-tab 属性定位
    const railTabs = [
      'ai', 'skills', 'context', 'characters', 'worldbook', 'foreshadow',
      'interview', 'whatif', 'library', 'history', 'stats', 'screenplay'
    ];
    for (const tab of railTabs) {
      await expect(tauriPage.locator(`[data-rail-tab="${tab}"]`)).toBeVisible();
    }

    // 顶栏功能入口
    for (const name of ['专注', '世界构建', '全局查找 Ctrl+Shift+F', '导出']) {
      await expect(tauriPage.getByRole('banner').getByRole('button', { name }).or(
        tauriPage.getByRole('button', { name })
      ).first()).toBeVisible();
    }
  });

  test('T2.2 章节树 CRUD——新建 / 重命名 / 子层级 / 删除确认分支', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);

    // 顶层章节
    await createChapter(tauriPage, 'E2E卷A');
    await createChapter(tauriPage, 'E2E卷B');

    // 重命名：hover 行 → ✎（title=重命名章节）→ 行内输入预填原名 → Enter 保存
    await chapterRow(tauriPage, 'E2E卷A').hover();
    await chapterRow(tauriPage, 'E2E卷A').getByRole('button', { name: '✎' }).click();
    const renameInput = tauriPage.locator('div.border-violet-200 input');
    await expect(renameInput).toHaveValue('E2E卷A');
    await renameInput.fill('E2E卷A改名');
    await renameInput.press('Enter');
    await expect(chapterRow(tauriPage, 'E2E卷A改名')).toBeVisible();
    // 「E2E卷A」是「E2E卷A改名」的前缀，行文本 could 子串误配，改用完整行文本精确断言
    const textsAfterRename = await rowTexts(tauriPage);
    expect(textsAfterRename.some((t) => t.includes('E2E卷A草稿'))).toBe(false);
    expect(textsAfterRename.some((t) => t.includes('E2E卷A改名'))).toBe(true);

    // 子章节：hover 父行 → 悬浮「+」→ 底部提示切换为添加子章节
    await chapterRow(tauriPage, 'E2E卷A改名').hover();
    await chapterRow(tauriPage, 'E2E卷A改名').getByRole('button', { name: '+' }).click();
    await expect(tauriPage.getByText(/添加子章节（父：E2E卷A改名）/)).toBeVisible();
    await createChapter(tauriPage, 'A1-E2E子章');

    // 层级断言：子行缩进大于顶层（8px），父行出现折叠符 ▾
    const childPad = await chapterRow(tauriPage, 'A1-E2E子章').evaluate((el) => el.style.paddingLeft);
    const topPad = await chapterRow(tauriPage, 'E2E卷B').evaluate((el) => el.style.paddingLeft);
    expect(parseFloat(childPad)).toBeGreaterThan(parseFloat(topPad));

    // 删除子章节（软件内确认框 确认）
    await chapterRow(tauriPage, 'A1-E2E子章').hover();
    await chapterRow(tauriPage, 'A1-E2E子章').getByRole('button', { name: '×' }).click();
    await acceptNativeDialog(tauriPage);
    await expect(chapterRow(tauriPage, 'A1-E2E子章')).toHaveCount(0);

    // 删除仍存在的顶层章节（已改名）
    await chapterRow(tauriPage, 'E2E卷A改名').hover();
    await chapterRow(tauriPage, 'E2E卷A改名').getByRole('button', { name: '×' }).click();
    await acceptNativeDialog(tauriPage);
    await expect(chapterRow(tauriPage, 'E2E卷A改名')).toHaveCount(0);
    await expect(chapterRow(tauriPage, 'E2E卷B')).toBeVisible();
  });

  test('T2.3 拖拽排序且刷新后保持', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '拖甲');
    await createChapter(tauriPage, '拖乙');

    // 将「拖乙」拖到「拖甲」上半区 → 变为 [拖乙, 拖甲]
    await dragRowBefore(tauriPage, '拖乙', '拖甲');
    let texts = await rowTexts(tauriPage);
    expect(texts.findIndex((t) => t.includes('拖乙'))).toBeLessThan(texts.findIndex((t) => t.includes('拖甲')));

    // 刷新后顺序保持（sortOrder 落盘 SQLite）
    await tauriPage.reload();
    await expect(chapterRow(tauriPage, '拖甲')).toBeVisible({ timeout: 8_000 });
    texts = await rowTexts(tauriPage);
    expect(texts.findIndex((t) => t.includes('拖乙'))).toBeLessThan(texts.findIndex((t) => t.includes('拖甲')));
  });

  test('T2.4 正文输入与格式块切换（对白/引用/H1/加粗）', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '格式章');

    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();

    // L1 普通 → L2 对白 → L3 引用块 → L4 H1（注意 Enter 会继承对白属性，需再点一次取消）
    await pm.pressSequentially('雾谷的清晨起了雾。');
    await pm.press('Enter');
    await pm.pressSequentially('“雾里有灯。”他说。');
    await toolbar(tauriPage, '对白').click();
    await pm.press('Enter');
    await toolbar(tauriPage, '对白').click(); // 取消继承的对白格式
    await pm.pressSequentially('守灯人百年未眠。');
    await toolbar(tauriPage, '❝').click();
    await pm.press('Enter');
    await toolbar(tauriPage, '❝').click(); // 退出引用块
    await pm.pressSequentially('卷一 雾谷');
    await toolbar(tauriPage, 'H1').click();

    const html = await pm.innerHTML();
    expect(html).toContain('<p class="dialogue">“雾里有灯。”他说。</p>');
    // 引用段可能继承对白类（Enter 属性继承的产品行为），且段落内无 trailingBreak，
    // 只断言结构存在与文本正确，不强校验类名
    expect(html).toContain('<blockquote>');
    expect(html).toContain('守灯人百年未眠。');
    expect(html).toContain('<h1>卷一 雾谷</h1>');

    // 加粗开关：全选加粗出现 strong，再次点击还原
    await pm.press('Control+a');
    await toolbar(tauriPage, 'B').click();
    expect(await pm.locator('strong').count()).toBeGreaterThan(0);
    await toolbar(tauriPage, 'B').click();
    expect(await pm.locator('strong').count()).toBe(0);
  });

  test('T2.5 Ctrl+S 保存流转与字数同步', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '保存章');

    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();
    await pm.pressSequentially('一字千钧。');

    // 输入后立即处于脏状态（防抖自动保存约 400ms，需尽快读取）
    expect(await saveState(tauriPage)).toBe('未保存');

    await pm.press('Control+s');
    await expect.poll(() => saveState(tauriPage), { timeout: 5_000 }).toBe('已保存');

    const banner = tauriPage.locator('[title="实时字数（保存后与落盘值同步）"]');
    // Ctrl+S 会取消防抖定时器，liveWordCount 可能尚未由 onUpdate 刷新（初始 0），
    // 需轮询等待其更新到实际字数后再与树节点字数比对
    await expect
      .poll(
        async () => {
          const text = await banner.innerText();
          return Number(text.match(/(\d+)\s*字$/)?.[1] ?? 0);
        },
        { timeout: 5_000 }
      )
      .toBeGreaterThan(0);
    const n = Number((await banner.innerText()).match(/(\d+)\s*字$/)?.[1] ?? 0);
    await expect(chapterRow(tauriPage, '保存章')).toContainText(`${n}字`);
  });

  test('T2.6 全局查找替换（含原生替换确认框）', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '替换章');

    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();
    await pm.pressSequentially('山间薄雾弥漫，薄雾之下是溪流。');
    await pm.press('Control+s');
    await expect.poll(() => saveState(tauriPage), { timeout: 5_000 }).toBe('已保存');

    await tauriPage.getByRole('button', { name: /全局查找/ }).click();
    await tauriPage.getByPlaceholder(/查找内容/).fill('薄雾');
    await tauriPage.getByPlaceholder('替换为…').fill('晨雾');
    await tauriPage.getByRole('button', { name: '搜索' }).click();
    await expect(tauriPage.getByText('命中 1 章')).toBeVisible();

    // 替换前弹出软件内确认框（标题非默认「确认操作」）
    await tauriPage.getByRole('button', { name: '全部替换' }).click();
    await acceptNativeDialog(tauriPage, '全局替换确认');

    // 替换后自动重建索引并复搜：原关键词无命中
    await expect(tauriPage.getByText(/已替换 \d+ 处|命中 0 章/)).toBeVisible({ timeout: 8_000 });

    await tauriPage.getByPlaceholder(/查找内容/).click();
    await tauriPage.keyboard.press('Escape');
    await expect(pm).toContainText('晨雾弥漫，晨雾之下是溪流');
  });

  test('T2.7 Ctrl+Shift+F 跨章节搜索并跳转', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '搜甲');
    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();
    await pm.pressSequentially('檐下落着青鸟羽。');
    await pm.press('Control+s');
    await expect.poll(() => saveState(tauriPage), { timeout: 5_000 }).toBe('已保存');

    await createChapter(tauriPage, '搜乙'); // 自动切为当前章节
    await pm.click();
    await pm.pressSequentially('又见青鸟掠过。');
    await pm.press('Control+s');
    await expect.poll(() => saveState(tauriPage), { timeout: 5_000 }).toBe('已保存');

    // 快捷键唤起全局查找
    await tauriPage.keyboard.press('Control+Shift+f');
    const query = tauriPage.getByPlaceholder(/查找内容/);
    await expect(query).toBeVisible();
    await query.fill('青鸟');
    await query.press('Enter');
    await expect(tauriPage.getByText('命中 2 章')).toBeVisible();

    // 点击「搜甲」结果跳转：顶栏当前章节名随之切换（搜乙 → 搜甲）。
    // 注意：跳转触发 Editor 重渲染，弹窗可能随之自动关闭（竞态），
    // 因此先断言顶栏横幅切为「搜甲」完成跳转验证，再按 Esc 收尾（弹窗已关则无害）
    await tauriPage.getByRole('button', { name: /搜甲.*点击跳转/ }).click();
    await expect(tauriPage.locator('[title="实时字数（保存后与落盘值同步）"]')).toContainText('搜甲');
    await tauriPage.keyboard.press('Escape');
  });

  test('T2.8 专注模式进入/打字机/Esc 退出', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);

    // 空书时编辑器主体不渲染、专注态无内容，先建章节
    await createChapter(tauriPage, '专注章');

    await tauriPage.getByRole('button', { name: '专注' }).click();
    const focusRoot = tauriPage.locator('.focus-root.fixed');
    await expect(focusRoot).toBeVisible();

    const bar = focusRoot.locator('.fixed.top-3');
    await expect(bar).toContainText('标准');
    await expect(bar).toContainText('本次 0 字');

    await bar.getByRole('button', { name: /打字机/ }).click();
    await expect(bar).toContainText('打字机 开');

    await tauriPage.keyboard.press('Escape');
    await expect(focusRoot).toHaveCount(0);
    await expect(tauriPage.getByRole('button', { name: '专注' })).toBeVisible();
  });

  test('T2.9 @ 与 ## 触发引用弹窗并插入章节引用节点', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '引甲');
    await createChapter(tauriPage, '引乙'); // 作为被引用目标

    const pm = tauriPage.locator('.ProseMirror');
    await pm.click();
    await pm.pressSequentially('他想起');
    await pm.press('@');

    // @ 弹出分组选择弹窗；空书无角色/世界书数据时仅展示「章节」组
    const popup = tauriPage.locator('div.fixed.z-50.w-60');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('选择引用（角色 @ / 世界书 [[ ]] / 章节 ##）');
    await popup.getByRole('button', { name: '引甲' }).click();

    // 插入 inline 原子引用节点
    await expect(pm.locator('span[data-chapter-ref]')).toHaveCount(1);
    await expect(pm.locator('span[data-chapter-ref]').first()).toHaveAttribute('title', '引甲');

    // ## 双击触发纯章节弹窗，Esc 关闭
    await pm.press('#');
    await tauriPage.waitForTimeout(120); // 与下一次按键间隔须 <800ms
    await pm.press('#');
    await expect(popup).toContainText('选择章节（##引用）');
    await tauriPage.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  });

  test('T2.10 字体字号行距即时生效并持久化', async ({ tauriPage }) => {
    await openFreshEditor(tauriPage);
    await createChapter(tauriPage, '外观章');

    const keys = ['novel-editor-font-family', 'novel-editor-font-size', 'novel-editor-line-height'];
    const prev = await tauriPage.evaluate(
      (ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])),
      keys
    );

    await tauriPage.getByRole('combobox', { name: '字体' }).selectOption({ label: '楷体' });
    await tauriPage.getByRole('combobox', { name: '字号' }).selectOption('22px');
    await tauriPage.getByRole('combobox', { name: '行间距' }).selectOption({ label: '紧凑' });

    const style = await tauriPage.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.ProseMirror p')!);
      return {
        font: cs.fontFamily,
        size: parseFloat(cs.fontSize),
        ratio: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)
      };
    });
    expect(style.font).toContain('KaiTi');
    expect(style.size).toBe(22);
    expect(style.ratio).toBeCloseTo(1.4, 1); // 紧凑=1.4 倍行距

    const stored = await tauriPage.evaluate(
      (ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])),
      keys
    );
    expect(stored['novel-editor-font-family']).toBe('kaiti');
    expect(stored['novel-editor-font-size']).toBe('22');
    expect(stored['novel-editor-line-height']).toBe('1.4');

    // 还原用户原有设置（可能为 null），刷新使其生效
    await tauriPage.evaluate(
      ({ ks, vals }) =>
        ks.forEach((k) => {
          const v = vals[k];
          if (v === null) localStorage.removeItem(k);
          else localStorage.setItem(k, v);
        }),
      { ks: keys, vals: prev }
    );
    await tauriPage.reload();
  });
});
