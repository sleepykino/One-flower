<template>
  <div class="search-replace-panel">
    <div class="search-header">
      <el-input
        v-model="searchQuery"
        placeholder="搜索文本..."
        clearable
        @input="performSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-button-group style="margin-left: 8px;">
        <el-button size="small" :type="caseSensitive ? 'primary' : 'default'" @click="caseSensitive = !caseSensitive">
          Aa
        </el-button>
        <el-button size="small" :type="useRegex ? 'primary' : 'default'" @click="useRegex = !useRegex">
          .*
        </el-button>
      </el-button-group>
      <el-button size="small" type="info" @click="$emit('close')" style="margin-left: 8px;">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>

    <div v-if="searchQuery" class="replace-row">
      <el-input
        v-model="replaceQuery"
        placeholder="替换为..."
        clearable
        size="small"
      />
      <el-button size="small" type="warning" @click="replaceCurrent" :disabled="!currentMatch">
        替换
      </el-button>
      <el-button size="small" type="danger" @click="replaceAll" :disabled="matches.length === 0">
        全部替换
      </el-button>
    </div>

    <div v-if="matches.length > 0" class="search-results">
      <div class="results-header">
        <span>{{ matches.length }} 个结果</span>
        <el-button-group size="small">
          <el-button @click="prevMatch" :disabled="matchIndex <= 0">
            <el-icon><ArrowUp /></el-icon>
          </el-button>
          <el-button @click="nextMatch" :disabled="matchIndex >= matches.length - 1">
            <el-icon><ArrowDown /></el-icon>
          </el-button>
        </el-button-group>
        <span>{{ matchIndex + 1 }} / {{ matches.length }}</span>
      </div>

      <div class="results-list">
        <div
          v-for="(match, index) in visibleMatches"
          :key="index"
          class="match-item"
          :class="{ active: matchIndex === match.originalIndex }"
          @click="goToMatch(match.originalIndex)"
        >
          <div class="match-chapter">{{ match.chapterTitle }}</div>
          <div class="match-context" v-html="match.highlightedContext"></div>
        </div>
      </div>
    </div>

    <div v-else-if="searchQuery && hasSearched" class="no-results">
      <el-icon><Search /></el-icon>
      <span>未找到匹配结果</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Close, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { db } from '@/database'

interface SearchMatch {
  chapterId: string
  chapterTitle: string
  position: number
  context: string
  highlightedContext: string
  originalIndex: number
}

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'go-to-chapter', chapterId: string): void
  (e: 'replace-in-chapter', chapterId: string, matches: SearchMatch[], replaceText: string): void
}>()

const searchQuery = ref('')
const replaceQuery = ref('')
const caseSensitive = ref(false)
const useRegex = ref(false)
const matches = ref<SearchMatch[]>([])
const matchIndex = ref(0)
const hasSearched = ref(false)

const currentMatch = computed(() => {
  if (matches.value.length === 0) return null
  return matches.value[matchIndex.value]
})

const visibleMatches = computed(() => {
  return matches.value.map((m, i) => ({ ...m, originalIndex: i }))
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function highlightContext(context: string, query: string): string {
  const escaped = escapeHtml(context)
  const queryEscaped = escapeHtml(query)
  try {
    const flags = caseSensitive.value ? 'g' : 'gi'
    const pattern = useRegex.value ? queryEscaped : queryEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${pattern})`, flags)
    return escaped.replace(regex, '<mark>$1</mark>')
  } catch {
    return escaped
  }
}

async function performSearch() {
  if (!searchQuery.value.trim()) {
    matches.value = []
    hasSearched.value = false
    return
  }

  hasSearched.value = true
  matches.value = []
  matchIndex.value = 0

  try {
    const chapters = await db.chapters.toArray()

    for (const chapter of chapters) {
      const content = chapter.content || ''
      const plainText = content.replace(/<[^>]*>/g, '')

      try {
        const flags = caseSensitive.value ? 'g' : 'gi'
        const pattern = useRegex.value ? searchQuery.value : searchQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(pattern, flags)
        let match: RegExpExecArray | null

        while ((match = regex.exec(plainText)) !== null) {
          const start = Math.max(0, match.index - 30)
          const end = Math.min(plainText.length, match.index + match[0].length + 30)
          const context = plainText.substring(start, end)

          matches.value.push({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            position: match.index,
            context,
            highlightedContext: highlightContext(context, searchQuery.value),
            originalIndex: matches.value.length
          })

          if (matches.value.length >= 200) break
        }
      } catch {
        continue
      }

      if (matches.value.length >= 200) break
    }
  } catch (e) {
    console.error('搜索失败:', e)
  }
}

function nextMatch() {
  if (matchIndex.value < matches.value.length - 1) {
    matchIndex.value++
    emit('go-to-chapter', currentMatch.value!.chapterId)
  }
}

function prevMatch() {
  if (matchIndex.value > 0) {
    matchIndex.value--
    emit('go-to-chapter', currentMatch.value!.chapterId)
  }
}

function goToMatch(index: number) {
  matchIndex.value = index
  if (currentMatch.value) {
    emit('go-to-chapter', currentMatch.value.chapterId)
  }
}

function replaceCurrent() {
  if (!currentMatch.value) return
  emit('replace-in-chapter', currentMatch.value.chapterId, [currentMatch.value!], replaceQuery.value)
  ElMessage.success('已替换')
  performSearch()
}

async function replaceAll() {
  try {
    await ElMessageBox.confirm(
      `确定要替换所有 ${matches.value.length} 个匹配项吗？此操作不可撤销。`,
      '全部替换确认',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
    )

    const groupedByChapter = new Map<string, SearchMatch[]>()
    for (const match of matches.value) {
      if (!groupedByChapter.has(match.chapterId)) {
        groupedByChapter.set(match.chapterId, [])
      }
      groupedByChapter.get(match.chapterId)!.push(match)
    }

    for (const [chapterId, chapterMatches] of groupedByChapter) {
      emit('replace-in-chapter', chapterId, chapterMatches, replaceQuery.value)
    }

    ElMessage.success(`已替换 ${matches.value.length} 处`)
    performSearch()
  } catch {
    // cancelled
  }
}

watch(searchQuery, () => {
  hasSearched.value = false
})
</script>

<style scoped>
.search-replace-panel {
  padding: 12px 16px;
  background: var(--card-bg, #fff);
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.search-header {
  display: flex;
  align-items: center;
}

.replace-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}

.replace-row .el-input {
  flex: 1;
}

.results-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.results-list {
  max-height: 300px;
  overflow-y: auto;
}

.match-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
  margin-bottom: 4px;
}

.match-item:hover {
  background: var(--bg-secondary, #f3f1ee);
}

.match-item.active {
  background: rgba(99, 102, 241, 0.1);
  border-left: 3px solid var(--primary-color, #6366f1);
}

.match-chapter {
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
  margin-bottom: 4px;
}

.match-context {
  font-size: 13px;
  color: var(--text-primary, #1f2937);
  line-height: 1.5;
  word-break: break-all;
}

.match-context :deep(mark) {
  background: rgba(244, 114, 182, 0.3);
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}

.no-results {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--text-muted, #9ca3af);
  font-size: 14px;
}
</style>
