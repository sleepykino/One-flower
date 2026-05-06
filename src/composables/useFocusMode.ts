import { ref, watch, onMounted, onUnmounted } from 'vue'

export function useFocusMode() {
  const isFocusMode = ref(false)
  const focusModeConfig = ref({
    hideHeader: true,
    hideSidebar: true,
    hideToolbar: true,
    hideWordCount: false,
    dimBackground: true,
    fontSize: 18,
    lineHeight: 2.0,
    maxWidth: 800
  })

  function enterFocusMode() {
    isFocusMode.value = true
    document.body.classList.add('focus-mode')
    applyFocusModeStyles()
  }

  function exitFocusMode() {
    isFocusMode.value = false
    document.body.classList.remove('focus-mode')
    removeFocusModeStyles()
  }

  function toggleFocusMode() {
    if (isFocusMode.value) {
      exitFocusMode()
    } else {
      enterFocusMode()
    }
  }

  function applyFocusModeStyles() {
    let style = document.getElementById('focus-mode-styles')
    if (!style) {
      style = document.createElement('style')
      style.id = 'focus-mode-styles'
      document.head.appendChild(style)
    }

    const config = focusModeConfig.value
    style.textContent = `
      body.focus-mode .app-header {
        display: ${config.hideHeader ? 'none' : 'flex'} !important;
        opacity: ${config.hideHeader ? '0' : '1'};
        transition: opacity 0.3s ease;
      }
      body.focus-mode .app-header:hover {
        opacity: 1 !important;
        display: flex !important;
      }
      body.focus-mode .sidebar-panel {
        display: ${config.hideSidebar ? 'none' : 'block'} !important;
      }
      body.focus-mode .editor-toolbar {
        display: ${config.hideToolbar ? 'none' : 'flex'} !important;
        opacity: ${config.hideToolbar ? '0' : '1'};
        transition: opacity 0.3s ease;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
        background: var(--card-bg, #fff);
      }
      body.focus-mode .editor-toolbar:hover {
        opacity: 1 !important;
        display: flex !important;
      }
      body.focus-mode .word-count {
        display: ${config.hideWordCount ? 'none' : 'block'} !important;
        opacity: 0.5;
        transition: opacity 0.3s ease;
      }
      body.focus-mode .word-count:hover {
        opacity: 1;
      }
      body.focus-mode .editor-container {
        position: relative;
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      body.focus-mode .editor-content {
        padding: 40px 60px !important;
      }
      body.focus-mode .ql-editor {
        font-size: ${config.fontSize}px !important;
        line-height: ${config.lineHeight} !important;
        max-width: ${config.maxWidth}px !important;
        margin: 0 auto !important;
        padding: 0 !important;
      }
      body.focus-mode .editor-panel {
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${config.dimBackground ? 'var(--bg-color, #faf9f7)' : 'var(--card-bg, #fff)'} !important;
      }
      body.focus-mode .editor-container {
        background: transparent !important;
        height: 100% !important;
        max-width: ${config.maxWidth + 120}px !important;
        margin: 0 auto !important;
      }
      body.focus-mode .app-body {
        background: ${config.dimBackground ? 'var(--bg-color, #faf9f7)' : 'var(--card-bg, #fff)'} !important;
      }
      body.focus-mode .focus-mode-exit-hint {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.6);
        color: white;
        padding: 8px 20px;
        border-radius: 20px;
        font-size: 13px;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
      }
      body.focus-mode .focus-mode-exit-hint.visible {
        opacity: 1;
      }
    `
  }

  function removeFocusModeStyles() {
    const style = document.getElementById('focus-mode-styles')
    if (style) {
      style.textContent = ''
    }
  }

  function updateFocusModeConfig(config: Partial<typeof focusModeConfig.value>) {
    focusModeConfig.value = { ...focusModeConfig.value, ...config }
    if (isFocusMode.value) {
      applyFocusModeStyles()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isFocusMode.value) {
      exitFocusMode()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault()
      toggleFocusMode()
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
    if (isFocusMode.value) {
      exitFocusMode()
    }
  })

  return {
    isFocusMode,
    focusModeConfig,
    enterFocusMode,
    exitFocusMode,
    toggleFocusMode,
    updateFocusModeConfig
  }
}
