import { onMounted, onUnmounted } from 'vue'

export interface ShortcutDef {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  description: string
  handler: () => void
  global?: boolean
}

const registeredShortcuts: ShortcutDef[] = []
const shortcutHandlers: ((e: KeyboardEvent) => void)[] = []

function matchesShortcut(e: KeyboardEvent, shortcut: ShortcutDef): boolean {
  const ctrlRequired = shortcut.ctrl ?? false
  const shiftRequired = shortcut.shift ?? false
  const altRequired = shortcut.alt ?? false
  const metaRequired = shortcut.meta ?? false

  const ctrlPressed = e.ctrlKey || e.metaKey
  const shiftPressed = e.shiftKey
  const altPressed = e.altKey
  const metaPressed = e.metaKey

  if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) return false
  if (ctrlRequired !== ctrlPressed) return false
  if (shiftRequired !== shiftPressed) return false
  if (altRequired !== altPressed) return false
  if (metaRequired !== metaPressed) return false

  return true
}

function createHandler(shortcuts: ShortcutDef[]): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

    for (const shortcut of shortcuts) {
      if (matchesShortcut(e, shortcut)) {
        if (isInputField && !shortcut.global && !(shortcut.ctrl || shortcut.meta)) {
          continue
        }
        e.preventDefault()
        shortcut.handler()
        break
      }
    }
  }
}

export function useShortcuts(shortcuts: ShortcutDef[]) {
  const handler = createHandler(shortcuts)

  onMounted(() => {
    document.addEventListener('keydown', handler)
    shortcutHandlers.push(handler)
    shortcuts.forEach(s => {
      const existing = registeredShortcuts.findIndex(
        rs => rs.key === s.key && rs.ctrl === s.ctrl && rs.shift === s.shift && rs.alt === s.alt
      )
      if (existing >= 0) {
        registeredShortcuts.splice(existing, 1)
      }
      registeredShortcuts.push(s)
    })
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handler)
    const idx = shortcutHandlers.indexOf(handler)
    if (idx >= 0) shortcutHandlers.splice(idx, 1)
    shortcuts.forEach(s => {
      const existing = registeredShortcuts.findIndex(
        rs => rs.key === s.key && rs.ctrl === s.ctrl && rs.shift === s.shift && rs.alt === s.alt
      )
      if (existing >= 0) registeredShortcuts.splice(existing, 1)
    })
  })

  return {
    getAllShortcuts: () => registeredShortcuts.slice()
  }
}

export function formatShortcut(shortcut: ShortcutDef): string {
  const parts: string[] = []
  if (shortcut.ctrl) parts.push('Ctrl')
  if (shortcut.shift) parts.push('Shift')
  if (shortcut.alt) parts.push('Alt')
  if (shortcut.meta) parts.push('Meta')
  parts.push(shortcut.key.toUpperCase())
  return parts.join('+')
}
