import { ref } from 'vue'
import { db } from '@/database'

const isDark = ref(false)

export function useDarkMode() {
  function applyTheme(dark: boolean) {
    isDark.value = dark
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark')
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
      document.documentElement.classList.remove('dark')
    }
    db.settings.put({ key: 'darkMode', value: dark })
  }

  function toggleDark() {
    applyTheme(!isDark.value)
  }

  async function loadDarkModePreference() {
    try {
      const setting = await db.settings.get('darkMode')
      if (setting !== undefined) {
        applyTheme(setting.value)
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        applyTheme(prefersDark)
      }
    } catch (e) {
      console.error('加载暗黑模式设置失败:', e)
    }
  }

  return {
    isDark,
    toggleDark,
    applyTheme,
    loadDarkModePreference
  }
}
