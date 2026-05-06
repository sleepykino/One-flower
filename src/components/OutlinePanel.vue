<template>
  <div class="outline-panel">
    <div class="outline-header">
      <h4>
        <el-icon><List /></el-icon>
        文档大纲
      </h4>
      <el-button text size="small" @click="$emit('close')">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
    <div class="outline-content" v-if="headings.length > 0">
      <div
        v-for="(heading, index) in headings"
        :key="index"
        class="outline-item"
        :class="[
          'level-' + heading.level,
          { active: activeHeadingIndex === index }
        ]"
        :style="{ paddingLeft: (heading.level - 1) * 16 + 12 + 'px' }"
        @click="scrollToHeading(index)"
      >
        <span class="heading-marker">H{{ heading.level }}</span>
        <span class="heading-text">{{ heading.text }}</span>
      </div>
    </div>
    <div v-else class="outline-empty">
      <el-icon style="font-size: 32px; color: #dcdfe6;"><List /></el-icon>
      <p>暂无标题</p>
      <span>在编辑器中使用标题格式即可自动生成大纲</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { List, Close } from '@element-plus/icons-vue'

export interface HeadingItem {
  level: number
  text: string
  id: string
}

const props = defineProps<{
  editorElement: HTMLElement | null
}>()

defineEmits<{
  close: []
}>()

const headings = ref<HeadingItem[]>([])
const activeHeadingIndex = ref(-1)

function parseHeadings() {
  if (!props.editorElement) return

  const editor = props.editorElement.querySelector('.ql-editor')
  if (!editor) return

  const headingElements = editor.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const newHeadings: HeadingItem[] = []

  headingElements.forEach((el, index) => {
    const tagName = el.tagName.toLowerCase()
    const level = parseInt(tagName.charAt(1))
    const text = el.textContent?.trim() || ''

    if (!el.id) {
      el.id = 'heading-' + index
    }

    newHeadings.push({
      level,
      text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      id: el.id
    })
  })

  headings.value = newHeadings
}

function scrollToHeading(index: number) {
  const heading = headings.value[index]
  if (!heading || !props.editorElement) return

  const editor = props.editorElement.querySelector('.ql-editor')
  if (!editor) return

  const targetEl = editor.querySelector('#' + heading.id)
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    activeHeadingIndex.value = index

    targetEl.classList.add('heading-highlight')
    setTimeout(() => {
      targetEl.classList.remove('heading-highlight')
    }, 1500)
  }
}

function updateActiveHeading() {
  if (!props.editorElement || headings.value.length === 0) return

  const editor = props.editorElement.querySelector('.ql-editor')
  if (!editor) return

  const scrollTop = editor.scrollTop
  const editorRect = editor.getBoundingClientRect()
  const viewCenter = editorRect.top + editorRect.height / 3

  let closestIndex = -1
  let closestDistance = Infinity

  headings.value.forEach((heading, index) => {
    const el = editor.querySelector('#' + heading.id)
    if (!el) return

    const rect = el.getBoundingClientRect()
    const distance = Math.abs(rect.top - viewCenter)

    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = index
    }
  })

  if (closestIndex !== -1) {
    activeHeadingIndex.value = closestIndex
  }
}

let observer: MutationObserver | null = null
let scrollHandler: (() => void) | null = null

watch(() => props.editorElement, (newEl) => {
  cleanup()
  if (newEl) {
    setupObserver(newEl)
  }
})

function setupObserver(element: HTMLElement) {
  const editor = element.querySelector('.ql-editor')
  if (!editor) return

  observer = new MutationObserver(() => {
    parseHeadings()
  })

  observer.observe(editor, {
    childList: true,
    subtree: true,
    characterData: true
  })

  scrollHandler = () => {
    updateActiveHeading()
  }

  editor.addEventListener('scroll', scrollHandler)
  parseHeadings()
}

function cleanup() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  if (scrollHandler && props.editorElement) {
    const editor = props.editorElement.querySelector('.ql-editor')
    if (editor) {
      editor.removeEventListener('scroll', scrollHandler)
    }
    scrollHandler = null
  }
}

onMounted(() => {
  if (props.editorElement) {
    setupObserver(props.editorElement)
  }
})

onUnmounted(() => {
  cleanup()
})

defineExpose({
  parseHeadings,
  headings
})
</script>

<style scoped>
.outline-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
  border-left: 1px solid var(--border-color, #e5e7eb);
}

.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.outline-header h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
  margin: 0;
}

.outline-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.outline-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.outline-item:hover {
  background: var(--bg-secondary, #f3f1ee);
  color: var(--text-primary, #1f2937);
}

.outline-item.active {
  background: rgba(99, 102, 241, 0.08);
  border-left-color: var(--primary-color, #6366f1);
  color: var(--primary-color, #6366f1);
}

.outline-item.level-1 {
  font-weight: 600;
  font-size: 14px;
}

.outline-item.level-2 {
  font-weight: 500;
}

.outline-item.level-3 {
  font-size: 12px;
}

.heading-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 18px;
  border-radius: 4px;
  background: var(--bg-secondary, #f3f1ee);
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted, #9ca3af);
  flex-shrink: 0;
}

.outline-item.active .heading-marker {
  background: rgba(99, 102, 241, 0.15);
  color: var(--primary-color, #6366f1);
}

.heading-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-muted, #9ca3af);
  text-align: center;
}

.outline-empty p {
  margin: 12px 0 4px;
  font-size: 15px;
  color: var(--text-secondary, #6b7280);
}

.outline-empty span {
  font-size: 12px;
}
</style>
