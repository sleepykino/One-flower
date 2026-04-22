import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Collection } from '@/types'
import { db } from '@/database'

export const useCollectionStore = defineStore('collection', () => {
  const collections = ref<Collection[]>([])
  const isInitialized = ref(false)
  const isLoading = ref(false)

  const defaultColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
    '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
  ]

  const defaultIcons = [
    '📚', '📖', '📕', '📗', '📘', '📙',
    '✨', '🌟', '💫', '🎭', '🎪', '🎨'
  ]

  async function loadCollectionsFromStorage() {
    if (isInitialized.value) return
    
    isLoading.value = true
    try {
      const savedCollections = await db.collections.toArray()
      collections.value = savedCollections
      isInitialized.value = true
    } catch (e) {
      console.error('加载合集数据失败:', e)
      collections.value = []
    } finally {
      isLoading.value = false
    }
  }

  async function saveCollectionsToStorage() {
    try {
      await db.collections.clear()
      await db.collections.bulkPut(collections.value)
    } catch (e) {
      console.error('保存合集数据失败:', e)
    }
  }

  function generateId(): string {
    return 'col_' + Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  const characterCollections = computed(() => {
    return collections.value.filter(c => c.type === 'character')
  })

  const worldbookCollections = computed(() => {
    return collections.value.filter(c => c.type === 'worldbook')
  })

  async function addCollection(collectionData: Partial<Collection> = {}): Promise<Collection> {
    const now = Date.now()
    const colorIndex = collections.value.length % defaultColors.length
    const iconIndex = collections.value.length % defaultIcons.length
    
    const newCollection: Collection = {
      id: generateId(),
      name: collectionData.name || '新合集',
      description: collectionData.description || '',
      type: collectionData.type || 'character',
      color: collectionData.color || defaultColors[colorIndex],
      icon: collectionData.icon || defaultIcons[iconIndex],
      createdAt: now,
      updatedAt: now
    }

    collections.value.push(newCollection)
    await saveCollectionsToStorage()
    return newCollection
  }

  async function updateCollection(id: string, updates: Partial<Collection>): Promise<boolean> {
    const index = collections.value.findIndex(c => c.id === id)
    if (index === -1) return false

    collections.value[index] = {
      ...collections.value[index],
      ...updates,
      updatedAt: Date.now()
    }

    await saveCollectionsToStorage()
    return true
  }

  async function deleteCollection(id: string): Promise<boolean> {
    const index = collections.value.findIndex(c => c.id === id)
    if (index === -1) return false

    collections.value.splice(index, 1)
    await saveCollectionsToStorage()
    return true
  }

  function getCollectionById(id: string): Collection | undefined {
    return collections.value.find(c => c.id === id)
  }

  return {
    collections,
    characterCollections,
    worldbookCollections,
    isInitialized,
    isLoading,
    loadCollectionsFromStorage,
    addCollection,
    updateCollection,
    deleteCollection,
    getCollectionById
  }
})
