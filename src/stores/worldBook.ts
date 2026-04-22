import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WorldBook, WorldBookGroup, WorldBookEntry } from '@/types'
import { db } from '@/database'

export const useWorldBookStore = defineStore('worldBook', () => {
  const worldBooks = ref<WorldBook[]>([])
  const currentWorldBookId = ref<string | null>(null)
  const isInitialized = ref(false)
  const isLoading = ref(false)

  async function loadWorldBooksFromStorage() {
    if (isInitialized.value) return
    
    isLoading.value = true
    try {
      const savedWorldBooks = await db.worldBooks.toArray()
      const savedGroups = await db.worldBookGroups.toArray()
      const savedEntries = await db.worldBookEntries.toArray()

      const groupMap = new Map<string, WorldBookGroup>()
      savedGroups.forEach(group => {
        groupMap.set(group.id, { ...group, entries: [] })
      })

      savedEntries.forEach(entry => {
        const group = groupMap.get(entry.groupId)
        if (group) {
          group.entries.push(entry)
        }
      })

      worldBooks.value = savedWorldBooks.map(wb => ({
        ...wb,
        groups: savedGroups
          .filter(g => g.worldBookId === wb.id)
          .map(g => groupMap.get(g.id)!)
          .filter(Boolean)
      }))

      const savedCurrentWorldBookId = await db.settings.get('currentWorldBookId')
      if (savedCurrentWorldBookId) {
        currentWorldBookId.value = savedCurrentWorldBookId.value
      } else if (worldBooks.value.length > 0) {
        currentWorldBookId.value = worldBooks.value[0].id
      }
      
      isInitialized.value = true
    } catch (e) {
      console.error('加载世界书数据失败:', e)
      worldBooks.value = []
    } finally {
      isLoading.value = false
    }
  }

  async function saveWorldBooksToStorage() {
    try {
      await db.transaction('rw', [db.worldBooks, db.worldBookGroups, db.worldBookEntries], async () => {
        await db.worldBooks.clear()
        await db.worldBookGroups.clear()
        await db.worldBookEntries.clear()

        for (const worldBook of worldBooks.value) {
          const { groups, ...worldBookBase } = worldBook
          await db.worldBooks.add(worldBookBase)

          for (const group of groups) {
            const { entries, ...groupBase } = group
            await db.worldBookGroups.add({ ...groupBase, worldBookId: worldBook.id })

            for (const entry of entries) {
              await db.worldBookEntries.add({ ...entry, groupId: group.id })
            }
          }
        }
      })
    } catch (e) {
      console.error('保存世界书数据失败:', e)
    }
  }

  async function saveCurrentWorldBookToStorage() {
    if (currentWorldBookId.value) {
      await db.settings.put({ key: 'currentWorldBookId', value: currentWorldBookId.value })
    }
  }

  function generateId(): string {
    return 'wb_' + Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  const currentWorldBook = computed(() => {
    if (!currentWorldBookId.value) return null
    return worldBooks.value.find(wb => wb.id === currentWorldBookId.value) || null
  })

  const enabledWorldBooks = computed(() => {
    return worldBooks.value.filter(wb => wb.enabled)
  })

  async function addWorldBook(worldBookData: Partial<WorldBook> = {}): Promise<WorldBook> {
    const now = Date.now()
    const newWorldBook: WorldBook = {
      id: generateId(),
      name: worldBookData.name || '新世界书',
      description: worldBookData.description || '',
      groups: worldBookData.groups || [],
      scan_depth: worldBookData.scan_depth || 2,
      token_budget: worldBookData.token_budget || 2048,
      recursive_scanning: worldBookData.recursive_scanning || false,
      enabled: worldBookData.enabled !== undefined ? worldBookData.enabled : true,
      createdAt: now,
      updatedAt: now
    }

    worldBooks.value.push(newWorldBook)
    await saveWorldBooksToStorage()
    return newWorldBook
  }

  async function updateWorldBook(id: string, updates: Partial<WorldBook>): Promise<boolean> {
    const index = worldBooks.value.findIndex(wb => wb.id === id)
    if (index === -1) return false

    worldBooks.value[index] = {
      ...worldBooks.value[index],
      ...updates,
      updatedAt: Date.now()
    }

    await saveWorldBooksToStorage()
    return true
  }

  async function deleteWorldBook(id: string): Promise<boolean> {
    const index = worldBooks.value.findIndex(wb => wb.id === id)
    if (index === -1) return false

    worldBooks.value.splice(index, 1)

    if (currentWorldBookId.value === id) {
      currentWorldBookId.value = worldBooks.value.length > 0 ? worldBooks.value[0].id : null
      await saveCurrentWorldBookToStorage()
    }

    await saveWorldBooksToStorage()
    return true
  }

  async function addGroup(worldBookId: string, groupData: Partial<WorldBookGroup> = {}): Promise<WorldBookGroup | null> {
    const worldBook = worldBooks.value.find(wb => wb.id === worldBookId)
    if (!worldBook) return null

    const now = Date.now()
    const newGroup: WorldBookGroup = {
      id: generateId(),
      name: groupData.name || '新分组',
      description: groupData.description || '',
      entries: groupData.entries || [],
      enabled: groupData.enabled !== undefined ? groupData.enabled : true,
      createdAt: now,
      updatedAt: now
    }

    worldBook.groups.push(newGroup)
    worldBook.updatedAt = now
    await saveWorldBooksToStorage()
    return newGroup
  }

  async function updateGroup(worldBookId: string, groupId: string, updates: Partial<WorldBookGroup>): Promise<boolean> {
    const worldBook = worldBooks.value.find(wb => wb.id === worldBookId)
    if (!worldBook) return false

    const groupIndex = worldBook.groups.findIndex(g => g.id === groupId)
    if (groupIndex === -1) return false

    worldBook.groups[groupIndex] = {
      ...worldBook.groups[groupIndex],
      ...updates,
      updatedAt: Date.now()
    }

    worldBook.updatedAt = Date.now()
    await saveWorldBooksToStorage()
    return true
  }

  async function deleteGroup(worldBookId: string, groupId: string): Promise<boolean> {
    const worldBook = worldBooks.value.find(wb => wb.id === worldBookId)
    if (!worldBook) return false

    const groupIndex = worldBook.groups.findIndex(g => g.id === groupId)
    if (groupIndex === -1) return false

    worldBook.groups.splice(groupIndex, 1)
    worldBook.updatedAt = Date.now()
    await saveWorldBooksToStorage()
    return true
  }

  async function addEntry(worldBookId: string, groupId: string, entryData: Partial<WorldBookEntry> = {}): Promise<WorldBookEntry | null> {
    const worldBook = worldBooks.value.find(wb => wb.id === worldBookId)
    if (!worldBook) return null

    const group = worldBook.groups.find(g => g.id === groupId)
    if (!group) return null

    const now = Date.now()
    const newEntry: WorldBookEntry = {
      id: generateId(),
      key: entryData.key || '',
      keywords: entryData.keywords || [],
      content: entryData.content || '',
      enabled: entryData.enabled !== undefined ? entryData.enabled : true,
      insertion_order: entryData.insertion_order || 100,
      priority: entryData.priority || 10,
      position: entryData.position || 'before_char',
      case_sensitive: entryData.case_sensitive || false,
      use_regex: entryData.use_regex || false,
      tags: entryData.tags || [],
      createdAt: now,
      updatedAt: now
    }

    group.entries.push(newEntry)
    group.updatedAt = now
    worldBook.updatedAt = now
    await saveWorldBooksToStorage()
    return newEntry
  }

  async function updateEntry(worldBookId: string, groupId: string, entryId: string, updates: Partial<WorldBookEntry>): Promise<boolean> {
    const worldBook = worldBooks.value.find(wb => wb.id === worldBookId)
    if (!worldBook) return false

    const group = worldBook.groups.find(g => g.id === groupId)
    if (!group) return false

    const entryIndex = group.entries.findIndex(e => e.id === entryId)
    if (entryIndex === -1) return false

    group.entries[entryIndex] = {
      ...group.entries[entryIndex],
      ...updates,
      updatedAt: Date.now()
    }

    group.updatedAt = Date.now()
    worldBook.updatedAt = Date.now()
    await saveWorldBooksToStorage()
    return true
  }

  async function deleteEntry(worldBookId: string, groupId: string, entryId: string): Promise<boolean> {
    const worldBook = worldBooks.value.find(wb => wb.id === worldBookId)
    if (!worldBook) return false

    const group = worldBook.groups.find(g => g.id === groupId)
    if (!group) return false

    const entryIndex = group.entries.findIndex(e => e.id === entryId)
    if (entryIndex === -1) return false

    group.entries.splice(entryIndex, 1)
    group.updatedAt = Date.now()
    worldBook.updatedAt = Date.now()
    await saveWorldBooksToStorage()
    return true
  }

  async function setCurrentWorldBook(id: string) {
    currentWorldBookId.value = id
    await saveCurrentWorldBookToStorage()
  }

  function findWorldBookById(id: string): WorldBook | null {
    return worldBooks.value.find(wb => wb.id === id) || null
  }

  function scanTextForEntries(text: string, worldBookId?: string): WorldBookEntry[] {
    const matchedEntries: WorldBookEntry[] = []
    
    const booksToScan = worldBookId 
      ? [worldBooks.value.find(wb => wb.id === worldBookId)].filter(Boolean) as WorldBook[]
      : enabledWorldBooks.value

    for (const worldBook of booksToScan) {
      for (const group of worldBook.groups) {
        if (!group.enabled) continue

        for (const entry of group.entries) {
          if (!entry.enabled) continue

          const matched = entry.keywords.some(keyword => {
            if (entry.use_regex) {
              try {
                const regex = new RegExp(keyword, entry.case_sensitive ? 'g' : 'gi')
                return regex.test(text)
              } catch (e) {
                console.error('正则表达式错误:', e)
                return false
              }
            } else {
              const searchText = entry.case_sensitive ? text : text.toLowerCase()
              const searchKeyword = entry.case_sensitive ? keyword : keyword.toLowerCase()
              return searchText.includes(searchKeyword)
            }
          })

          if (matched) {
            matchedEntries.push(entry)
          }
        }
      }
    }

    return matchedEntries.sort((a, b) => b.priority - a.priority)
  }

  function exportWorldBook(id: string): string | null {
    const worldBook = worldBooks.value.find(wb => wb.id === id)
    if (!worldBook) return null
    return JSON.stringify(worldBook, null, 2)
  }

  async function importWorldBook(jsonData: string): Promise<boolean> {
    try {
      const imported = JSON.parse(jsonData)
      
      const now = Date.now()
      const newWorldBook: WorldBook = {
        ...imported,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
        groups: imported.groups.map((group: any) => ({
          ...group,
          id: generateId(),
          createdAt: now,
          updatedAt: now,
          entries: group.entries.map((entry: any) => ({
            ...entry,
            id: generateId(),
            createdAt: now,
            updatedAt: now
          }))
        }))
      }

      worldBooks.value.push(newWorldBook)
      await saveWorldBooksToStorage()
      return true
    } catch (e) {
      console.error('导入世界书数据失败:', e)
      return false
    }
  }

  return {
    worldBooks,
    currentWorldBookId,
    currentWorldBook,
    enabledWorldBooks,
    isInitialized,
    isLoading,
    loadWorldBooksFromStorage,
    saveWorldBooksToStorage,
    saveCurrentWorldBookToStorage,
    addWorldBook,
    updateWorldBook,
    deleteWorldBook,
    addGroup,
    updateGroup,
    deleteGroup,
    addEntry,
    updateEntry,
    deleteEntry,
    setCurrentWorldBook,
    findWorldBookById,
    scanTextForEntries,
    exportWorldBook,
    importWorldBook
  }
})
