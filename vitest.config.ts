import { defineConfig } from 'vitest/config';

// 单测层：仅覆盖纯函数/服务层逻辑，运行于 node 环境，不依赖 Tauri 运行时。
// 注意：独立于 vite.config.ts，避免引入 react 插件与浏览器相关配置。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.{ts,tsx}']
  }
});
