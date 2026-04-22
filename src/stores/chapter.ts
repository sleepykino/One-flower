import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/database'

export interface Chapter {
  id: string
  title: string
  content: string
  wordCount: number
  parentId: string | null
  children: Chapter[]
  isExpanded?: boolean
  level: number
  createdAt?: number
  updatedAt?: number
}

export const useChapterStore = defineStore('chapter', () => {
  const chapters = ref<Chapter[]>([])
  const currentChapterId = ref<string | null>(null)
  const isInitialized = ref(false)
  const isLoading = ref(false)

  async function loadChaptersFromStorage() {
    if (isInitialized.value) return
    
    isLoading.value = true
    try {
      const savedChapters = await db.chapters.toArray()
      
      if (savedChapters.length > 0) {
        chapters.value = buildChapterTree(savedChapters)
      } else {
        await initializeDefaultChapter()
      }

      const savedCurrentChapterId = await db.settings.get('currentChapterId')
      if (savedCurrentChapterId) {
        currentChapterId.value = savedCurrentChapterId.value
      } else if (chapters.value.length > 0) {
        currentChapterId.value = chapters.value[0].id
      }
      
      isInitialized.value = true
    } catch (e) {
      console.error('加载章节数据失败:', e)
      chapters.value = []
    } finally {
      isLoading.value = false
    }
  }

  function buildChapterTree(flatChapters: Chapter[]): Chapter[] {
    const chapterMap = new Map<string, Chapter>()
    const rootChapters: Chapter[] = []

    flatChapters.forEach(chapter => {
      chapterMap.set(chapter.id, { ...chapter, children: [] })
    })

    flatChapters.forEach(chapter => {
      const node = chapterMap.get(chapter.id)!
      if (chapter.parentId) {
        const parent = chapterMap.get(chapter.parentId)
        if (parent) {
          parent.children.push(node)
        }
      } else {
        rootChapters.push(node)
      }
    })

    return rootChapters
  }

  async function initializeDefaultChapter() {
    const defaultChapter: Chapter = {
      id: generateId(),
      title: '第一章',
      content: '',
      wordCount: 0,
      parentId: null,
      children: [],
      isExpanded: true,
      level: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    chapters.value = [defaultChapter]
    await saveChaptersToStorage()
  }

  async function saveChaptersToStorage() {
    try {
      const flatChapters = flattenChaptersToArray(chapters.value)
      await db.chapters.clear()
      await db.chapters.bulkPut(flatChapters)
    } catch (e) {
      console.error('保存章节数据失败:', e)
    }
  }

  function flattenChaptersToArray(chapterList: Chapter[], result: Chapter[] = []): Chapter[] {
    chapterList.forEach(chapter => {
      const { children, ...flatChapter } = chapter
      result.push(flatChapter as Chapter)
      if (children.length > 0) {
        flattenChaptersToArray(children, result)
      }
    })
    return result
  }

  async function saveCurrentChapterToStorage() {
    if (currentChapterId.value) {
      await db.settings.put({ key: 'currentChapterId', value: currentChapterId.value })
    }
  }

  function generateId(): string {
    return 'chapter_' + Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  const currentChapter = computed(() => {
    if (!currentChapterId.value) return null
    return findChapterById(currentChapterId.value)
  })

  function findChapterById(id: string, chapterList: Chapter[] = chapters.value): Chapter | null {
    for (const chapter of chapterList) {
      if (chapter.id === id) {
        return chapter
      }
      if (chapter.children.length > 0) {
        const found = findChapterById(id, chapter.children)
        if (found) return found
      }
    }
    return null
  }

  async function addChapter(parentId: string | null = null, title: string = '新章节'): Promise<Chapter> {
    const parentChapter = parentId ? findChapterById(parentId) : null

    const newChapter: Chapter = {
      id: generateId(),
      title,
      content: '',
      wordCount: 0,
      parentId,
      children: [],
      isExpanded: true,
      level: parentChapter ? parentChapter.level + 1 : 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    if (parentId && parentChapter) {
      parentChapter.children.push(newChapter)
      parentChapter.isExpanded = true
    } else {
      chapters.value.push(newChapter)
    }

    await saveChaptersToStorage()
    return newChapter
  }

  async function updateChapterContent(id: string, content: string) {
    const chapter = findChapterById(id)
    if (chapter) {
      chapter.content = content
      chapter.wordCount = content.replace(/\s/g, '').length
      chapter.updatedAt = Date.now()
      await saveChaptersToStorage()
    }
  }

  async function updateChapterTitle(id: string, title: string) {
    const chapter = findChapterById(id)
    if (chapter) {
      chapter.title = title
      chapter.updatedAt = Date.now()
      await saveChaptersToStorage()
    }
  }

  async function deleteChapter(id: string): Promise<boolean> {
    const chapter = findChapterById(id)
    if (!chapter) return false

    if (!chapter.parentId) {
      return false
    }

    if (chapter.parentId) {
      const parent = findChapterById(chapter.parentId)
      if (parent) {
        const index = parent.children.findIndex(child => child.id === id)
        if (index !== -1) {
          parent.children.splice(index, 1)
        }
      }
    }

    if (currentChapterId.value === id) {
      currentChapterId.value = chapter.parentId
    }

    await saveChaptersToStorage()
    await saveCurrentChapterToStorage()
    return true
  }

  async function toggleChapterExpand(id: string) {
    const chapter = findChapterById(id)
    if (chapter) {
      chapter.isExpanded = !chapter.isExpanded
      await saveChaptersToStorage()
    }
  }

  async function moveChapter(id: string, newParentId: string | null, index?: number): Promise<boolean> {
    const chapter = findChapterById(id)
    if (!chapter) return false

    if (isDescendant(id, newParentId)) return false

    if (chapter.parentId) {
      const oldParent = findChapterById(chapter.parentId)
      if (oldParent) {
        const oldIndex = oldParent.children.findIndex(child => child.id === id)
        if (oldIndex !== -1) {
          oldParent.children.splice(oldIndex, 1)
        }
      }
    } else {
      const oldIndex = chapters.value.findIndex(ch => ch.id === id)
      if (oldIndex !== -1) {
        chapters.value.splice(oldIndex, 1)
      }
    }

    chapter.parentId = newParentId
    if (newParentId) {
      const newParent = findChapterById(newParentId)
      if (newParent) {
        chapter.level = newParent.level + 1
        newParent.isExpanded = true

        if (index !== undefined && index >= 0 && index <= newParent.children.length) {
          newParent.children.splice(index, 0, chapter)
        } else {
          newParent.children.push(chapter)
        }

        updateChildrenLevel(chapter)
      }
    } else {
      chapter.level = 0

      if (index !== undefined && index >= 0 && index <= chapters.value.length) {
        chapters.value.splice(index, 0, chapter)
      } else {
        chapters.value.push(chapter)
      }
    }

    await saveChaptersToStorage()
    return true
  }

  function isDescendant(ancestorId: string, descendantId: string | null): boolean {
    if (!descendantId) return false

    const descendant = findChapterById(descendantId)
    if (!descendant) return false

    let currentId = descendant.parentId
    while (currentId) {
      if (currentId === ancestorId) return true
      const parent = findChapterById(currentId)
      if (!parent) break
      currentId = parent.parentId
    }

    return false
  }

  function updateChildrenLevel(parent: Chapter) {
    parent.children.forEach(child => {
      child.level = parent.level + 1
      updateChildrenLevel(child)
    })
  }

  async function setCurrentChapter(id: string) {
    currentChapterId.value = id
    await saveCurrentChapterToStorage()
  }

  function flattenChapters(chapterList: Chapter[] = chapters.value, result: Chapter[] = []): Chapter[] {
    chapterList.forEach(chapter => {
      result.push(chapter)
      if (chapter.children.length > 0) {
        flattenChapters(chapter.children, result)
      }
    })
    return result
  }

  const flattenedChapters = computed(() => flattenChapters())

  return {
    chapters,
    currentChapterId,
    currentChapter,
    flattenedChapters,
    isInitialized,
    isLoading,
    loadChaptersFromStorage,
    saveChaptersToStorage,
    saveCurrentChapterToStorage,
    findChapterById,
    addChapter,
    updateChapterContent,
    updateChapterTitle,
    deleteChapter,
    toggleChapterExpand,
    moveChapter,
    setCurrentChapter,
    initializeDefaultChapter
  }
})
