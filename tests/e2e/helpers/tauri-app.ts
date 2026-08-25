import { chromium, test as base, expect as baseExpect, type Browser, type Page } from '@playwright/test';

/** WebView2 CDP 调试端口（仅 dev 构建开放，见 src-tauri/src/lib.rs） */
export const CDP_ENDPOINT = process.env.TAURI_CDP_URL ?? 'http://localhost:9222';
/** Vite dev server（strictPort） */
export const APP_URL = process.env.TAURI_APP_URL ?? 'http://localhost:5173';

/**
 * tauriPage fixture：连接运行中的 Tauri 应用并返回其主页面。
 * - 每条用例独立建立/断开 CDP 会话，互不残留
 * - 未启动 tauri dev 时给出明确报错
 */
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
        const context = browser.contexts()[0] ?? (await browser.newContext());
        let page = context.pages().find((p) => p.url().startsWith(APP_URL));
        if (!page) {
          page = await context.newPage();
          await page.goto(APP_URL + '/');
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
