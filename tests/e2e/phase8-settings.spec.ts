import type { Page } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';
import { acceptNativeDialog } from './helpers/native-dialog';

// 对应 doc/自动化测试计划.md 阶段 8（已于 2026-08-25 手工验证通过，
// 记录见 doc/自动化测试记录.md「阶段 8：设置页」）
//
// 约定：
// - 页面直达 APP_URL + '/settings'（原生 /settings 路由，左栏 5 分组 8 分区导航）
// - 分区按钮文案与控件以 src/routes/Settings.tsx + src/components/settings/* 源码为准
// - 不触发外网：「测试连接」（真实 LLM 调用）与「立即检查更新」（真实 GitHub Releases API）
//   均只断言按钮存在，绝不点击（见手工记录 T8.2 / T8.8）
// - 原生 open/save 对话框（备份导出/导入）自动化不可用 → 只断言入口，标 MANUAL
// - 所有全局设置改动在用例内还原：模型分工下拉改回原值、全局提示词条目删除、
//   外观 localStorage 复原默认（default/16/1.7）、自动检查更新开关复原初始值

const RUN = Date.now().toString(36);

function uniqueBook(): string {
  return `TEST-E2E-P8-${RUN}-${Math.floor(Math.random() * 1e4)}`;
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

async function deleteBook(page: Page, title: string): Promise<void> {
  await page.goto(APP_URL + '/');
  const card = bookCard(page, title);
  await card.hover();
  // P6：删除入口移入 ⋮ 菜单（软删除移入回收站）
  await card.getByRole('button', { name: '更多操作' }).click();
  await card.getByRole('button', { name: '删除' }).click();
  await acceptNativeDialog();
  await expect(card).toHaveCount(0);
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

/** 设置页左栏分区导航按钮（aside 内，exact 防止前后缀误配） */
function navButton(page: Page, name: string) {
  return page.getByRole('complementary').getByRole('button', { name, exact: true });
}

/** 右侧内容区（Settings.tsx 的 <main>，各分区组件挂载点） */
function sectionMain(page: Page) {
  return page.getByRole('main');
}

/** 右侧特征标题（每个分区唯一的 <h1>，文案来自 SECTION_TITLES） */
function sectionTitle(page: Page) {
  return sectionMain(page).getByRole('heading', { level: 1 });
}

async function gotoSettings(page: Page): Promise<void> {
  await page.goto(APP_URL + '/settings');
}

// ---------- 用例 ----------

test.describe('阶段 8：设置页', () => {
  test('T8.1 分区导航——左栏 8 个分区逐一切换渲染', async ({ tauriPage }) => {
    await gotoSettings(tauriPage);

    // 左栏 5 分组 8 分区；默认选中「模型接入」
    for (const name of ['模型接入', '模型分工', '全局提示词', '指令说明', '编辑器', '备份与恢复', '数据管理', '更新与关于']) {
      await expect(navButton(tauriPage, name)).toBeVisible();
    }

    // 逐一点击 → 断言右侧 h1 特征标题与专属特征文案（均与源码一一对应）
    const sections = [
      { nav: '模型接入', h1: '模型接入', probe: '快捷接入' },
      { nav: '模型分工', h1: 'AI 模型分工', probe: '为每类功能指定模型' },
      { nav: '全局提示词', h1: '全局提示词', probe: '超出部分会被截断' },
      { nav: '指令说明', h1: '指令说明', probe: '三种机制控制 AI 的行为' },
      { nav: '编辑器', h1: '编辑器外观', probe: '两处同步' },
      { nav: '备份与恢复', h1: '备份与恢复', probe: '误删恢复' },
      { nav: '数据管理', h1: '数据管理', probe: '应用数据目录' },
      { nav: '更新与关于', h1: '更新与关于', probe: 'GitHub Releases' }
    ];
    for (const s of sections) {
      await navButton(tauriPage, s.nav).click();
      await expect(sectionTitle(tauriPage)).toHaveText(s.h1);
      await expect(sectionMain(tauriPage).getByText(s.probe).first()).toBeVisible();
    }
  });

  test('T8.2 模型接入——12 供应商预置卡 + 自定义表单校验 toast', async ({ tauriPage }) => {
    await gotoSettings(tauriPage); // 默认分区即「模型接入」

    // 预置卡：grid 三列布局中 PROVIDER_PRESETS 共 12 张
    const presetGrid = sectionMain(tauriPage).locator('.grid.grid-cols-3');
    await expect(presetGrid.locator('> button')).toHaveCount(12);
    // 抽查代表性供应商名称（文案与 providerPresets.ts 一致）
    for (const label of ['DeepSeek', '智谱 GLM', 'OpenAI', 'Kimi 月之暗面', 'Ollama（本地）', 'ComfyUI（本地生图）']) {
      await expect(sectionMain(tauriPage).getByText(label, { exact: true })).toBeVisible();
    }

    // 展开「+ 自定义配置」内联表单
    await sectionMain(tauriPage).getByRole('button', { name: '+ 自定义配置' }).click();
    await expect(sectionMain(tauriPage).getByText('新建自定义配置')).toBeVisible();

    // 4 字段 placeholder 断言（与 ModelsSection.tsx 源码一致）
    await expect(
      tauriPage.getByPlaceholder('配置名称，如「我的 DeepSeek」', { exact: true })
    ).toBeVisible();
    await expect(
      tauriPage.getByPlaceholder('baseURL *，如 https://api.deepseek.com', { exact: true })
    ).toBeVisible();
    await expect(
      tauriPage.getByPlaceholder('模型名，如 deepseek-v4-pro / gpt-5.5', { exact: true })
    ).toBeVisible();
    await expect(tauriPage.getByPlaceholder('API Key *', { exact: true })).toBeVisible();

    // 空提交 → if 手写校验拦截 → toast「名称必填」（右下角 info，停留约 3.5s）
    await sectionMain(tauriPage).getByRole('button', { name: '保存' }).click();
    await expect(tauriPage.getByText('名称必填', { exact: true })).toBeVisible({ timeout: 3_000 });

    // 收起表单，不残留编辑态
    await sectionMain(tauriPage).getByRole('button', { name: '取消' }).click();
    await expect(sectionMain(tauriPage).getByText('新建自定义配置')).toHaveCount(0);

    // 注意：已添加配置行的「测试连接」为真实外网调用（真实 LLM Provider），
    // 本脚本刻意不点击 —— 成功分支见手工记录 T8.2（OpenCode 连接成功）。
    await expect(sectionMain(tauriPage).getByText(/API Key 存于系统钥匙串/)).toBeVisible();
  });

  test('T8.3 模型分工——功能域分组与首个功能点下拉改选还原', async ({ tauriPage }) => {
    await gotoSettings(tauriPage);
    await navButton(tauriPage, '模型分工').click();
    await expect(sectionTitle(tauriPage)).toHaveText('AI 模型分工');

    // 功能域分组标签（语音域无功能点不渲染，其余 5 组均在）
    for (const domain of ['写作生成', '规划与校验', '灵感与素材', '视觉生成', '向量与后台']) {
      await expect(sectionMain(tauriPage).getByText(domain, { exact: true })).toBeVisible();
    }
    // 22 个功能点各带一个绑定下拉（向量嵌入行另有嵌入模型名输入框，非 select）
    await expect(sectionMain(tauriPage).locator('select')).toHaveCount(22);

    // 第一个下拉（写作生成·续写）：change 即存 app_settings key ai.featureModels，
    // DB 持久化已在手工记录 T8.3 通过 service 直连 SQL 验证，此处仅断言 UI 生效并还原
    const firstSelect = sectionMain(tauriPage).locator('select').first();
    await expect(firstSelect).toBeVisible();
    const before = await firstSelect.inputValue();
    const optionValues = await firstSelect
      .locator('option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    // 找一个与当前值不同的选项：「用默认配置」或另一组配置
    const alt = optionValues.find((v) => v !== before);

    if (!alt) {
      // 环境无任何对话可用 Provider 配置时下拉仅「用默认配置」一项，无从改选；
      // 断言兜底选项存在即可，不视为失败
      expect(optionValues).toContain('__follow__');
    } else {
      await firstSelect.selectOption(alt);
      await expect(firstSelect).toHaveValue(alt); // 改选即时生效（无保存按钮）
      await firstSelect.selectOption(before); // 还原原值，避免污染全局 ai.featureModels
      await expect(firstSelect).toHaveValue(before);
    }
  });

  test('T8.4 全局提示词——添加条目联动预算并删除还原（原生确认框）', async ({ tauriPage }) => {
    await gotoSettings(tauriPage);
    await navButton(tauriPage, '全局提示词').click();
    await expect(sectionTitle(tauriPage)).toHaveText('全局提示词');

    // 输入框 + 添加按钮在位
    const draft = tauriPage.getByPlaceholder("新增提示词，如：避免使用'仿佛'", { exact: true });
    await expect(draft).toBeVisible();
    await expect(sectionMain(tauriPage).getByRole('button', { name: '添加', exact: true })).toBeVisible();

    // 记录初始快照：预算数字 + 条目数（可能非空，删除后按快照对比还原）
    const budgetNumber = async (): Promise<number> =>
      tauriPage.evaluate(() =>
        Number(document.body.innerText.match(/已启用条目合计约 (\d+) \/ 600 token/)?.[1] ?? '-1')
      );
    const listItems = sectionMain(tauriPage).locator('ul > li');
    const initialBudget = await budgetNumber();
    expect(initialBudget).toBeGreaterThanOrEqual(0);
    const initialCount = await listItems.count();

    // 添加唯一后缀条目 → 列表出现该条目且预算增长
    const tag = `TEST-E2E-提示词-${RUN}`;
    await draft.fill(tag);
    await sectionMain(tauriPage).getByRole('button', { name: '添加', exact: true }).click();
    const addedItem = listItems.filter({ hasText: tag });
    await expect(addedItem).toHaveCount(1);
    await expect.poll(budgetNumber, { timeout: 5_000 }).toBeGreaterThan(initialBudget);

    // 删除走 confirmDialog 原生确认框（PowerShell AppActivate+ENTER 方案）
    await addedItem.getByRole('button', { name: '删除' }).click();
    await acceptNativeDialog();

    // 列表恢复初始快照状态，预算回初始值（初始为空时即 0 / 600 token）
    await expect(addedItem).toHaveCount(0);
    await expect(listItems).toHaveCount(initialCount);
    await expect.poll(budgetNumber, { timeout: 5_000 }).toBe(initialBudget);
    await expect(sectionMain(tauriPage).getByText(/已启用条目合计约 \d+ \/ 600 token/)).toBeVisible();
  });

  test('T8.5 编辑器外观——楷体/18/舒适写入 localStorage 并复原默认', async ({ tauriPage }) => {
    await gotoSettings(tauriPage);
    await navButton(tauriPage, '编辑器').click();
    await expect(sectionTitle(tauriPage)).toHaveText('编辑器外观');

    // 预置按钮组：9 字体 / 8 字号 / 5 行距（AppearanceSection 与 editorAppearance.ts 源码一致），抽查代表按钮
    const main = sectionMain(tauriPage);
    await expect(main.getByRole('button', { name: '楷体', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: '标准', exact: true })).toBeVisible();

    // 依次点击 楷体 / 18 / 舒适 → localStorage 三 key 即时写入（无需 reload）
    await main.getByRole('button', { name: '楷体', exact: true }).click();
    await main.getByRole('button', { name: '18', exact: true }).click();
    await main.getByRole('button', { name: '舒适', exact: true }).click();
    const stored = await tauriPage.evaluate(() => ({
      family: localStorage.getItem('novel-editor-font-family'),
      size: localStorage.getItem('novel-editor-font-size'),
      lineHeight: localStorage.getItem('novel-editor-line-height')
    }));
    expect(stored.family).toBe('kaiti');
    expect(stored.size).toBe('18');
    expect(stored.lineHeight).toBe('2.2'); // 舒适 = 2.2 倍行距

    // 复原 默认 / 16 / 标准（与手工记录阶段 8 结束态一致）
    await main.getByRole('button', { name: '默认', exact: true }).click();
    await main.getByRole('button', { name: '16', exact: true }).click();
    await main.getByRole('button', { name: '标准', exact: true }).click();
    const restored = await tauriPage.evaluate(() => ({
      family: localStorage.getItem('novel-editor-font-family'),
      size: localStorage.getItem('novel-editor-font-size'),
      lineHeight: localStorage.getItem('novel-editor-line-height')
    }));
    expect(restored.family).toBe('default');
    expect(restored.size).toBe('16');
    expect(restored.lineHeight).toBe('1.7'); // 标准 = 1.7 倍行距
  });

  test('T8.6 备份与恢复——书籍下拉与两按钮入口在位（落盘 MANUAL）', async ({ tauriPage }) => {
    // 自建一本书保证下拉必有选项（afterEach 统一清理）
    const title = uniqueBook();
    createdBooks.push(title);
    await createBookViaHome(tauriPage, title);

    await gotoSettings(tauriPage);
    await navButton(tauriPage, '备份与恢复').click();
    await expect(sectionTitle(tauriPage)).toHaveText('备份与恢复');

    // 说明文案
    await expect(sectionMain(tauriPage).getByText(/备份包含章节正文、章节树、角色卡、世界书与伏笔/)).toBeVisible();
    await expect(sectionMain(tauriPage).getByText(/不覆盖现有书籍/)).toBeVisible();

    // 书籍下拉含自建书 + 「导出备份」「选择备份包导入」两按钮在位
    const bookSelect = sectionMain(tauriPage).getByRole('combobox');
    await expect(bookSelect).toBeVisible();
    await expect(bookSelect.locator('option', { hasText: title })).toHaveCount(1, { timeout: 5_000 });
    await expect(sectionMain(tauriPage).getByRole('button', { name: '导出备份' })).toBeVisible();
    await expect(sectionMain(tauriPage).getByRole('button', { name: '选择备份包导入' })).toBeVisible();

    // 导出依赖原生 save 对话框、导入依赖原生 open 对话框，CDP 无法自动化
    // （AppActivate 方案仅适用确认框，文件对话框不可用）→ 落盘分支标 MANUAL，
    // 见 doc/自动化测试记录.md T8.6。此处绝不点击。
  });

  test('T8.7 数据管理——两组目录路径文案与打开入口', async ({ tauriPage }) => {
    await gotoSettings(tauriPage);
    await navButton(tauriPage, '数据管理').click();
    await expect(sectionTitle(tauriPage)).toHaveText('数据管理');

    // 应用数据目录路径（异步加载后出现，SQLite WAL 文案）+ Skill 目录路径
    await expect(
      sectionMain(tauriPage).getByText(/com\.oneflower\.novelagent.*SQLite WAL/s)
    ).toBeVisible({ timeout: 8_000 });
    await expect(sectionMain(tauriPage).getByText(/\.novelagent\\skills/)).toBeVisible();

    // 两组「打开目录」按钮在位；不点击（会拉起系统资源管理器干扰桌面，无数据副作用）
    await expect(sectionMain(tauriPage).getByRole('button', { name: '打开目录' })).toHaveCount(2);
  });

  test('T8.8 更新与关于——自动检查更新开关切换还原 + 版本文案', async ({ tauriPage }) => {
    await gotoSettings(tauriPage);
    await navButton(tauriPage, '更新与关于').click();
    await expect(sectionTitle(tauriPage)).toHaveText('更新与关于');

    // 「立即检查更新」按钮在位；不点击 —— 真实 GitHub Releases API 外网调用，
    // 反馈分支见手工记录 T8.8（已是最新版本 v0.11.4）
    await expect(sectionMain(tauriPage).getByRole('button', { name: '立即检查更新' })).toBeVisible();

    // 自动检查更新 checkbox 写 DB update.autoCheck（持久化已在手工记录验证）：
    // 切换两次断言 checked 态变化，并复原为初始值
    const autoCheck = sectionMain(tauriPage).getByRole('checkbox', { name: '自动检查更新' });
    await expect(autoCheck).toBeVisible();
    const initial = await autoCheck.isChecked();
    await autoCheck.click();
    await expect(autoCheck).toBeChecked({ checked: !initial });
    await autoCheck.click();
    await expect(autoCheck).toBeChecked({ checked: initial });

    // 关于区：产品名 + 版本号徽章（v 开头，形如 v0.11.4）+ 仓库入口
    await expect(sectionMain(tauriPage).getByText('One Flower 一花一世界')).toBeVisible();
    await expect(sectionMain(tauriPage).getByText(/v\d+\.\d+/).first()).toBeVisible();
    await expect(sectionMain(tauriPage).getByText('GitHub 仓库 ↗')).toBeVisible();
  });
});
