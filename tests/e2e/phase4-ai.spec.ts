import type { Page } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';
import { acceptNativeDialog } from './helpers/native-dialog';

// 对应 doc/自动化测试计划.md 阶段 4：AI 与灵感面板 UI（P1，无网络依赖部分先行）
// 手工验证记录见 doc/自动化测试记录.md「阶段 4：AI 与灵感面板 UI（2026-08-25）」
//
// 约定：
// - 每条用例独立创建 TEST-E2E-P4-* 书籍并进入编辑器，afterEach 统一删除，互不依赖执行顺序
// - 进入编辑器后统一建 1 个章节、写入一句正文并 Ctrl+S 保存（保证上下文/版本链路有数据）
// - 硬性约束：绝不点击任何触发 LLM 的按钮（开始续写 / 开始改写 / 生成对白 /
//   AI 生成初稿 / 确认并开始生成 / 开始采访 / 开始推演 等），只断言 UI 存在性；
//   涉及真实生成的部分需真实 Key，见手工记录（T4.7 流式生成、长文完整四步、采访对话等）
// - 右侧 rail 定位必须 nav.last() 域限定 + exact：「长文」rail tab 与 AI 面板内模式按钮
//   重名（getByRole strict 冲突），「角色」是「角色采访」的前缀（见手工记录 T4.1 备注）

const RUN = Date.now().toString(36);

function uniqueBook(): string {
  return `TEST-E2E-P4-${RUN}-${Math.floor(Math.random() * 1e4)}`;
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

/** 右侧 rail tab：按钮 aria-label 为「打开X面板」，用稳定的 data-rail-tab 属性定位。
 *  key 即 Editor.tsx RIGHT_TAB_GROUPS 中的 tab key（ai/longform/skills/…） */
function railTab(page: Page, key: string) {
  return page.locator(`[data-rail-tab="${key}"]`);
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

test.describe('阶段 4：AI 与灵感面板 UI', () => {
  test('T4.1 rail 13 个面板 tab 完整性与各面板特征文案渲染', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);

    // rail 共 13 个 tab 按钮（分组分隔线为 div 不计入；「长文」受特性开关控制当前恒启用）
    const rail = tauriPage.locator('nav').last();
    await expect(rail.getByRole('button')).toHaveCount(13);

    // 逐个点击 + 各面板特征文案断言（13 个名称全集见手工记录 T4.1）
    // 探针统一限定右侧面板容器，避免与 rail 按钮名或其他区域文本混淆
    const panel = rightPanel(tauriPage);
    const probes: Array<[string, () => Promise<void>]> = [
      [
        'ai',
        // 非长文视图恒有的「本书指令」入口；模式为全局内存态可能被其他会话残留切换，
        // 故不用「开始续写」做探针
        () => expect(panel.getByRole('button', { name: '本书指令' })).toBeVisible()
      ],
      ['longform', () => expect(panel.getByText('① 节拍表')).toBeVisible()],
      ['skills', () => expect(panel.getByText(/文风 Skill（\d+）/)).toBeVisible()],
      ['context', () => expect(panel.getByText('尚未发起 AI 调用')).toBeVisible()],
      ['characters', () => expect(panel.getByText(/角色卡（\d+）/)).toBeVisible()],
      ['worldbook', () => expect(panel.getByText(/世界书（\d+）/)).toBeVisible()],
      ['foreshadow', () => expect(panel.getByText(/伏笔追踪（\d+）/)).toBeVisible()],
      ['interview', () => expect(panel.getByText('采访角度')).toBeVisible()],
      ['whatif', () => expect(panel.getByText(/给定一个剧情假设/)).toBeVisible()],
      ['library', () => expect(panel.getByRole('button', { name: '+ 上传' })).toBeVisible()],
      ['history', () => expect(panel.getByText(/版本历史（\d+）/)).toBeVisible()],
      ['stats', () => expect(panel.getByText('今日字数')).toBeVisible()],
      ['screenplay', () => expect(panel.getByRole('button', { name: '从章节转化' })).toBeVisible()]
    ];
    for (const [tab, probe] of probes) {
      await railTab(tauriPage, tab).click();
      await probe();
    }
  });

  test('T4.2 AI 助手四模式切换（续写/改写/对白/检查）', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);
    const panel = rightPanel(tauriPage);

    // 初始默认续写模式；显式点一次确保基线（aiStore 为全局内存态，防御残留状态）
    await panel.getByRole('button', { name: '续写', exact: true }).click();

    // —— 续写：要求输入 + 触发按钮（不点击）——
    await expect(panel.getByPlaceholder(/续写要求（可选）/)).toBeVisible();
    await expect(panel.getByRole('button', { name: '开始续写' })).toBeVisible();

    // —— 改写：未选中文本提示 + 叙述视角下拉；无选区且无指令时「开始改写」禁用 ——
    await panel.getByRole('button', { name: '改写', exact: true }).click();
    await expect(panel.getByText('请先在编辑器中选中要改写的文本')).toBeVisible();
    await expect(panel.getByText('叙述视角')).toBeVisible();
    await expect(panel.getByPlaceholder(/改写要求/)).toBeVisible();
    const rewriteBtn = panel.getByRole('button', { name: '开始改写' });
    await expect(rewriteBtn).toBeVisible();
    await expect(rewriteBtn).toBeDisabled(); // 未选中任何文本

    // —— 对白：场景描述输入 + 参与角色区；新书无角色卡显示空态提示 ——
    await panel.getByRole('button', { name: '对白', exact: true }).click();
    await expect(panel.getByPlaceholder(/场景描述，如：客栈中/)).toBeVisible();
    await expect(panel.getByText(/本书暂无角色卡/)).toBeVisible();
    const dialogueBtn = panel.getByRole('button', { name: '生成对白' });
    await expect(dialogueBtn).toBeVisible();
    await expect(dialogueBtn).toBeDisabled(); // 无场景且无参与角色

    // —— 检查：一致性检查 + 错字检查双入口 ——
    await panel.getByRole('button', { name: '检查', exact: true }).click();
    await expect(panel.getByText(/一致性检查比对角色卡 \/ 世界书/)).toBeVisible();
    await expect(panel.getByRole('button', { name: '一致性检查' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '错字检查' })).toBeVisible();

    // 备注：
    // - 「未配 Provider 时错误提示」分支 N/A——本环境已配置可用 Provider（手工记录 T4.2）
    // - 真实流式生成与中断三选项（保留/丢弃/继续补完）需真实 Key，见手工记录 T4.7，
    //   以上四个触发按钮一律只断言存在性、不点击
  });

  test('T4.3 ContextPanel 分区渲染与 token 头部', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);
    await railTab(tauriPage, '上下文').click();
    const panel = rightPanel(tauriPage);

    // 新书尚未发起任何 AI 调用：先断言空态
    await expect(panel.getByText('尚未发起 AI 调用')).toBeVisible();

    // 通过运行中实例的 app-context 模块注入一份最小快照到 orchestrator.lastContext
    // （纯内存写入，不发起任何 LLM 调用）。技巧见手工记录阶段 5「自动化代理访问技巧」：
    // 直接 import('/src/context/app-context.ts') 会因 Vite HMR 时间戳拿到未初始化的新模块，
    // 必须从 performance resource entries 取真实带时间戳 URL 再动态 import。
    const bookId = tauriPage.url().split('/').filter(Boolean).pop() ?? '';
    const injected = await tauriPage.evaluate(async (id: string) => {
      try {
        const url = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .find((n) => n.includes('/src/context/app-context'));
        if (!url) return false;
        const mod = (await import(url)) as { getAppContext: () => any };
        mod.getAppContext().orchestrator.lastContext.set(id, {
          bookId: id,
          mode: 'continue',
          at: Date.now(),
          totalTokens: 42,
          breakdown: [],
          ctx: {
            mode: 'continue',
            systemInstruction: '',
            enabledSkills: [],
            characters: [],
            worldbookEntries: [],
            segments: [],
            summaryChain: [],
            recentChapters: [],
            globalPrompts: [],
            forcedRefs: []
          }
        });
        return true;
      } catch {
        return false;
      }
    }, bookId);

    if (injected) {
      // 点面板「刷新」立即加载快照（面板自身还有 1.5s 轮询兜底）
      await panel.getByRole('button', { name: '刷新' }).click();

      // token 头部：「{模式} · 共 N tok」（模型徽标仅真实调用才有，见手工记录 T4.3）
      await expect(panel.getByText(/· 共 \d+ tok/)).toBeVisible();

      // 8 个分区标题齐全（名称与顺序以 ContextPanel.tsx 源码为准）
      const sections = [
        '全局提示词（',
        '作者指定引用（',
        '文风 Skill（',
        '角色卡（',
        '世界书 RAG（',
        '原文片段 RAG（',
        '前情摘要链（',
        '最近章节原文（'
      ];
      for (const s of sections) {
        // 分区标题统一渲染在 span.font-medium 内；内容区 Empty 文案（如「未注入全局提示词（…）」）
        // 与标题同前缀，getByText 会命中两处触发 strict violation，故限定 font-medium 标题元素
        await expect(panel.locator('span.font-medium', { hasText: s }).first()).toBeVisible();
      }
    }
    // 若模块注入不可行（injected=false），保留上方空态断言；
    // 真实 AI 调用后的完整注入清单（RAG 命中、摘要链内容等）需真实 Key，见手工记录 T4.3
  });

  test('T4.4 长文向导步骤①节拍表 UI（不触发生成）', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);
    // rail「长文」经 initialTab 打开 AIPanel 内部长文视图（同一 AIPanel，见手工记录环境备注）
    await railTab(tauriPage, 'longform').click();
    const panel = rightPanel(tauriPage);

    // 步骤条四步齐全：①节拍表 → ②成本确认 → ③生成进度 → ④接缝审阅
    for (const step of ['① 节拍表', '② 成本确认', '③ 生成进度', '④ 接缝审阅']) {
      await expect(panel.getByText(step)).toBeVisible();
    }

    // 节拍表区域控件：拍数 / 总字数 / 补充提示（注意节拍行是 input 非 textarea，手工记录踩坑）
    await expect(panel.getByText('拍数')).toBeVisible();
    await expect(panel.getByText('总字数')).toBeVisible();
    await expect(panel.getByPlaceholder(/补充提示（可选）/)).toBeVisible();

    // 「AI 生成初稿」触发 LLM，仅断言可见、绝不点击（真实生成需真实 Key，见手工记录 T4.4）
    await expect(panel.getByRole('button', { name: 'AI 生成初稿' })).toBeVisible();

    // 「从章节节拍导入」为纯本地读取（chapterService.getBeats），可安全点击：
    // 新章节无节拍 → toast 提示
    await panel.getByRole('button', { name: '从章节节拍导入' }).click();
    await expect(tauriPage.getByText(/当前章节暂无节拍/)).toBeVisible({ timeout: 3_000 });

    // 无节拍时无法进入步骤②（成本确认禁用）；目标章节提示指向当前章
    await expect(panel.getByRole('button', { name: '下一步：成本确认' })).toBeDisabled();
    await expect(panel.getByText(/目标章节：《第一章》/)).toBeVisible();

    // 完整四步链路（生成节拍 → 成本确认 → 进度/暂停 → 接缝审阅）触发 LLM，
    // 需真实 Key，见手工记录 T4.4
  });

  test('T4.5 Skill 文风包列表与勾选持久化（勾选后取消还原）', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);
    await railTab(tauriPage, 'skills').click();
    const panel = rightPanel(tauriPage);

    // 列表头（内置包数量）+ Skill 目录说明 + 导入/重新扫描入口
    await expect(panel.getByText(/文风 Skill（\d+）/)).toBeVisible();
    await expect(panel.getByText(/Skill 目录：/)).toBeVisible();
    await expect(panel.getByRole('button', { name: '导入' })).toBeVisible(); // 点击会弹原生对话框，不断言流程
    await expect(panel.getByRole('button', { name: '重新扫描' })).toBeVisible();

    // wuxia-classical 内置包勾选持久化验证：
    // 勾选 → 切 tab 触发面板重挂载后回来仍勾选（bookService.setEnabledSkills 落库）→ 取消还原
    const item = panel.locator('label', { hasText: 'wuxia-classical' });
    await expect(item).toHaveCount(1);
    const checkbox = item.getByRole('checkbox');

    if (!(await checkbox.isChecked())) {
      await checkbox.check();
    }
    await expect(checkbox).toBeChecked();

    await railTab(tauriPage, '统计').click();
    await railTab(tauriPage, 'Skill').click();
    await expect(item.getByRole('checkbox')).toBeChecked();

    // 取消还原，并再切走切回确认复位（不留勾选脏状态）
    await item.getByRole('checkbox').uncheck();
    await expect(item.getByRole('checkbox')).not.toBeChecked();
    await railTab(tauriPage, 'stats').click();
    await railTab(tauriPage, 'skills').click();
    await expect(item.getByRole('checkbox')).not.toBeChecked();
  });

  test('T4.6 角色采访六角度与 WhatIf 推演表单 UI', async ({ tauriPage }) => {
    await openEditorWithSavedText(tauriPage);
    const panel = rightPanel(tauriPage);

    // —— 角色采访 ——
    await railTab(tauriPage, '角色采访').click();
    await expect(panel.getByText('采访角度')).toBeVisible();

    // 新书无角色卡：角色下拉不渲染，setup 视图仅剩「采访角度」一个下拉
    const angleSelect = panel.getByRole('combobox');
    await expect(angleSelect).toHaveCount(1);

    // 六角度 option 齐全（INTERVIEW_ANGLE_LABEL 定义序，见 services/inspiration/types.ts）
    expect(await angleSelect.locator('option').allInnerTexts()).toEqual([
      '童年',
      '动机',
      '秘密',
      '关系',
      '对某事件看法',
      '自由'
    ]);

    // 无角色卡时「开始采访」天然禁用（防误触 LLM）；真实采访对话需真实 Key，见手工记录 T4.6
    await expect(panel.getByRole('button', { name: '开始采访' })).toBeDisabled();

    // —— 如果…会怎样 ——
    await railTab(tauriPage, 'whatif').click();
    await expect(panel.getByText(/给定一个剧情假设/)).toBeVisible();
    await expect(panel.getByPlaceholder(/假设，如：/)).toBeVisible();

    // 章节锚点 select（title 定位；本书仅 1 章 → 单 option「锚点：1. 第一章」）
    const anchorSel = panel.locator('select[title^="假设发生在该章之后"]');
    await expect(anchorSel).toBeVisible();
    await expect(anchorSel.locator('option')).toHaveCount(1);
    await expect(anchorSel).toContainText('锚点：1. 第一章');

    // 推演范围下拉：选项「推演 3 章 / 推演 5 章 / 推演 10 章」
    // （手工记录所称「推演 3 章」实为此 select 选项而非独立按钮）
    const combos = panel.getByRole('combobox');
    await expect(combos).toHaveCount(2);
    expect(await combos.nth(1).locator('option').allInnerTexts()).toEqual([
      '推演 3 章',
      '推演 5 章',
      '推演 10 章'
    ]);

    // 「开始推演」仅断言可见、不点击（触发 LLM，需真实 Key，见手工记录 T4.6）
    await expect(panel.getByRole('button', { name: '开始推演' })).toBeVisible();
  });
});
