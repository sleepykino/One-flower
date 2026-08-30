import { defineConfig } from '@playwright/test';

// UI E2E 层：CDP 直连运行中的 tauri dev（WebView2 调试端口 9222）。
// 前置条件：先启动 `npm run tauri dev`。无需 npx playwright install 下载浏览器内核。
export default defineConfig({
  testDir: 'tests/e2e',
  // 应用只有单一 WebView，必须串行执行避免 CDP 会话互相干扰
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    actionTimeout: 10_000,
    // CDP 直连真实 Tauri 窗口时禁用视口模拟：默认 1280×720 会经
    // Emulation.setDeviceMetricsOverride 把 WebView 视口/DPR 钉住，
    // 断开后不自动清除，残留导致应用页面被拉伸。设 null 保持原生视口，
    // 需要缩放的用例（如 T9.5）自行 setViewportSize 并在 finally 清理。
    viewport: null
  }
});
