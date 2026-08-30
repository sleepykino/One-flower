import { chromium, test as base, expect as baseExpect, type Browser, type Page } from '@playwright/test';

/** WebView2 CDP 调试端口（仅 dev 构建开放，见 src-tauri/src/lib.rs） */
export const CDP_ENDPOINT = process.env.TAURI_CDP_URL ?? 'http://localhost:9222';
/** Vite dev server（strictPort） */
export const APP_URL = process.env.TAURI_APP_URL ?? 'http://localhost:5173';

/**
 * tauriPage fixture：连接运行中的 Tauri 应用并返回其主页面。
 * - 每条用例独立建立/断开 CDP 会话，互不残留
 * - 未启动 tauri dev 时给出明确报错
 * - P7.1：整个进程内仅首次连接时带 ?onboarding=off 重载一次，隔离引导自动触发
 *   （e2e 与真实应用共享数据目录，不预置/不污染引导状态；会话级模块标志保证
 *   SPA 跳转丢失参数后依旧关闭自动触发，不影响任何 phase spec 的既有行为）
 */
let onboardingIsolated = false;

export const test = base.extend<{ tauriPage: Page }>({
  tauriPage: [
    async ({ }, use) => {
      let browser: Browser;
      try {
        browser = await chromium.connectOverCDP(CDP_ENDPOINT);
      } catch {
        throw new Error(
          `无法连接 CDP ${CDP_ENDPOINT}。请先运行 \`npm run tauri dev\`（dev 构建开放 9222 调试端口）。`
        );
      }
      try {
        const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: null }));
        let page = context.pages().find((p) => p.url().startsWith(APP_URL));
        if (!page) {
          page = await context.newPage();
        }
        if (!onboardingIsolated && !page.url().includes('onboarding=')) {
          onboardingIsolated = true;
          await page.goto(APP_URL + '/?onboarding=off');
        }
        await use(page);
      } finally {
        // 断开连接；不会关闭用户的 Tauri 窗口（context 非本会话创建）
        await browser.close();
      }
    },
    { auto: true }
  ]
});

export const expect = baseExpect;
