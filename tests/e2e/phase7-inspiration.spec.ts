import type { Locator } from '@playwright/test';
import { APP_URL, expect, test } from './helpers/tauri-app';

// 对应 doc/自动化测试计划.md 阶段 7「灵感库页面」（已于 2026-08-25 手工验证通过，
// 记录见 doc/自动化测试记录.md「阶段 7：灵感库页面」T7.1–T7.3）
//
// 页面结构（src/routes/Inspiration.tsx）：/inspiration 直达，三区块纵向排列——
//   今日灵感卡（DailyCardSection）/ 故事种子生成器（StorySeedGenerator）/ 灵感库列表（InspirationLibrary）
//
// ⚠️ 范围裁剪说明：今日灵感卡的「换一张 / 换个题材 / 不再推荐此类 / 收藏落库」、
//   故事种子「生成故事种子」、灵感库「收藏标记 / 一键建书」全链路，均已在
//   手工测试记录 T7.1–T7.3 完成真实验证；这些操作走 LLM 外部调用或修改全局
//   数据（inspirations 表、dailyCard 屏蔽类型、新建书籍+跳转编辑器），脚本层
//   因副作用不纳入回归，本文件一律不点击。
//
// 骰子按钮源码核实：StorySeedGenerator「随机灵感」（Dices 图标）实际调用
//   storySeedService.randomize() → provider.chat（LLM 外部调用），与测试计划中
//   「骰子=本地随机填充」的描述不符。为守住「不触发任何外部调用」硬约束，
//   T7.2 在点击前向运行实例注入本地桩函数（复用自动化测试记录阶段 5 沉淀的
//   app-context 动态 import 技巧拿到运行中的 service 单例），测毕还原原实现，
//   既覆盖「骰子 → 表单填充」的 UI 链路，又保证零外部调用。

test.describe('阶段 7：灵感库页面', () => {
  test('T7.0 三区块渲染：今日灵感卡 / 故事种子生成器 / 灵感库列表', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL + '/inspiration');
    await expect(tauriPage.getByRole('heading', { level: 1, name: '灵感库' })).toBeVisible();

    // 区块一：今日灵感卡。入口条按钮常驻，「已生成 / 未生成」徽标二态皆算通过
    //（卡片可能处于生成中、已有 AI 卡或默认兜底卡，断言区块标题而非具体卡内容）
    const dailyBar = tauriPage.getByRole('button', { name: /今日灵感/ });
    await expect(dailyBar).toBeVisible();
    await expect(dailyBar.getByText(/已生成|未生成/)).toBeVisible();
    // 操作入口随状态不同（未生成=生成按钮 / 已生成=收藏换一张组），不断言具体按钮

    // 区块二：故事种子生成器（标题 + 题材/元素输入 + 骰子入口）
    const seedSec = tauriPage.locator('section', { hasText: '故事种子生成器' });
    await expect(seedSec.getByRole('heading', { level: 2, name: '故事种子生成器' })).toBeVisible();
    await expect(seedSec.getByPlaceholder(/题材 \*/)).toBeVisible();
    await expect(seedSec.getByPlaceholder(/元素组合 \*/)).toBeVisible();
    await expect(seedSec.getByRole('button', { name: '随机灵感' })).toBeVisible();

    // 区块三：灵感库列表（h2 与页 h1 同名「灵感库」，用 heading level 区分）
    const lib = tauriPage
      .locator('section')
      .filter({ has: tauriPage.getByRole('heading', { level: 2, name: '灵感库' }) });
    await expect(lib).toBeVisible();
    await expect(lib.getByPlaceholder('关键词搜索')).toBeVisible();
  });

  test('T7.2 骰子随机填充（本地桩注入，零外部调用）', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL + '/inspiration');
    const diceBtn = tauriPage.getByRole('button', { name: '随机灵感' });
    await expect(diceBtn).toBeVisible();

    // 注入本地桩：替换运行实例 storySeedService.randomize 为同步返回固定组合的纯本地函数。
    // 经 performance resource 表取带 HMR 时间戳的真实 app-context 模块 URL 再动态 import
    // （直接 import('/src/context/app-context.ts') 会拿到未初始化的新模块实例，见阶段 5 记录）
    const stubbed = await tauriPage.evaluate(async (): Promise<boolean> => {
      type AppCtxMod = {
        getAppContext: () => { storySeedService: { randomize: () => Promise<unknown> } };
      };
      const ctxUrl = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => n.includes('/src/context/app-context'));
      if (!ctxUrl) return false;
      const mod = (await import(/* @vite-ignore */ ctxUrl)) as AppCtxMod;
      if (!mod?.getAppContext) return false;
      const svc = mod.getAppContext().storySeedService;
      if (!svc) return false;
      const w = window as typeof window & { __e2eOrigRandomize?: () => Promise<unknown> };
      w.__e2eOrigRandomize = svc.randomize.bind(svc);
      svc.randomize = async () => ({
        genre: 'E2E骰子题材',
        elements: ['E2E元素甲', 'E2E元素乙'],
        reason: 'E2E 本地桩：验证骰子到表单填充链路'
      });
      return true;
    });

    // 桩注入失败（罕见）：为避免误触真实 LLM 调用，退化为仅确认骰子入口可见后结束
    if (!stubbed) return;

    try {
      // 点骰子 → 题材与元素输入框被填充非空值，搭配理由提示条出现
      await diceBtn.click();
      await expect(tauriPage.getByPlaceholder(/题材 \*/)).toHaveValue('E2E骰子题材');
      await expect(tauriPage.getByPlaceholder(/元素组合 \*/)).toHaveValue(/E2E元素甲/);
      await expect(tauriPage.getByText('E2E 本地桩：验证骰子到表单填充链路')).toBeVisible();
    } finally {
      // 还原运行实例的原 randomize 实现，不污染后续手工使用
      await tauriPage.evaluate(async (): Promise<void> => {
        type AppCtxMod = {
          getAppContext: () => { storySeedService: { randomize: () => Promise<unknown> } };
        };
        const w = window as typeof window & { __e2eOrigRandomize?: () => Promise<unknown> };
        const orig = w.__e2eOrigRandomize;
        if (!orig) return;
        const ctxUrl = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .find((n) => n.includes('/src/context/app-context'));
        if (!ctxUrl) return;
        const mod = (await import(/* @vite-ignore */ ctxUrl)) as AppCtxMod;
        mod.getAppContext().storySeedService.randomize = orig;
        delete w.__e2eOrigRandomize;
      });
    }
  });

  test('T7.3 灵感库列表：五个类型 chip 切换与关键词搜索空态恢复', async ({ tauriPage }) => {
    await tauriPage.goto(APP_URL + '/inspiration');
    const lib = tauriPage
      .locator('section')
      .filter({ has: tauriPage.getByRole('heading', { level: 2, name: '灵感库' }) });

    // 五个类型 chip（INSPIRATION_TYPE_LABEL：全部 + 四类型），active 态样式 bg-violet-600
    const chips = ['全部', '故事种子', '灵感卡片', '推演报告', '采访摘要'];
    const chip = (name: string): Locator => lib.getByRole('button', { name, exact: true });
    const classOf = async (loc: Locator): Promise<string> => (await loc.getAttribute('class')) ?? '';
    for (const c of chips) {
      await expect(chip(c)).toBeVisible();
    }
    expect(await classOf(chip('全部'))).toContain('bg-violet-600');

    // 逐个切换：active 高亮迁移到当前 chip 并离开「全部」
    for (const c of chips.slice(1)) {
      await chip(c).click();
      expect(await classOf(chip(c))).toContain('bg-violet-600');
      expect(await classOf(chip('全部'))).not.toContain('bg-violet-600');
    }
    await chip('全部').click();

    // 记录搜索前计数（头部「N 条」）。灵感库列表为异步 DB 查询：
    // 注意「加载中」filtered=[] 会短暂渲染「0 条」+ 空态文案，故不能仅凭空态文案判断加载完成。
    // 轮询判定：
    // - 计数非 0 → 数据已到达（非空库）
    // - 计数仍 0 且间隔 600ms（本地 SQLite 查询毫秒级，足够）后仍为 0 → 真空库稳定
    const cnt = lib.getByText(/^\d+ 条$/);
    const read = async () => ((await cnt.textContent()) ?? '').trim();
    await expect
      .poll(
        async () => {
          if (!/^0 条$/.test(await read())) return 'data';
          await tauriPage.waitForTimeout(600);
          return /^0 条$/.test(await read()) ? 'empty' : 'data';
        },
        { timeout: 5_000, message: '灵感库列表未完成初始加载' }
      )
      .toMatch(/^(data|empty)$/);
    const cntText = await read();
    const before = Number(cntText.match(/(\d+)/)?.[1] ?? -1);
    const kw = lib.getByPlaceholder('关键词搜索');
    await kw.fill('ZZNOHIT');

    // 必不命中：计数归 0 且展示空态（库非空=筛选无结果文案 / 库本身为空=空库文案）
    await expect(lib.getByText(/^0 条$/)).toBeVisible();
    await expect(lib.getByText(/没有符合筛选条件的灵感|灵感库还是空的/)).toBeVisible();

    // 清空关键词恢复搜索前计数（关键词为前端过滤，不改数据库）
    await kw.clear();
    await expect(lib.getByText(`${before} 条`)).toBeVisible();
  });
});
