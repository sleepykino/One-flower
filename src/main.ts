import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'quill/dist/quill.snow.css'
import App from './App.vue'
import { initializeDatabase } from './database'
import { migrateFromLocalStorage } from './database/migration'

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  
  app.use(pinia)
  app.use(ElementPlus)

  try {
    await initializeDatabase()
    await migrateFromLocalStorage()
    console.log('应用初始化完成')
  } catch (error) {
    console.error('应用初始化失败:', error)
  }

  app.mount('#app')
}

bootstrap()
