import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false
  },
  build: {
    // 配置 chunk 大小警告阈值（单位：KB）
    chunkSizeWarningLimit: 500,
    
    // 代码分割策略
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 Vue 相关库分离为单独的 chunk
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          
          // Element Plus UI 库分离
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
          
          // 富文本编辑器分离
          'editor': ['quill'],
          
          // 工具库分离
          'utils': ['axios', 'dexie', 'jszip']
        },
        
        // 控制 chunk 命名
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    
    // 压缩选项：使用 Vite 默认 esbuild，避免类型错误
    minify: 'esbuild'
  }
})
