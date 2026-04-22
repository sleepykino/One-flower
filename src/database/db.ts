import Dexie, { type Table } from 'dexie'
import type { Chapter } from '@/stores/chapter'
import type { Character, CharacterRelation, WorldBook, WorldBookGroup, WorldBookEntry, Collection, AIProvider } from '@/types'
import type { NovelMap } from '@/types/map'

export interface Setting {
  key: string
  value: any
}

class NovelDatabase extends Dexie {
  chapters!: Table<Chapter, string>
  characters!: Table<Character, string>
  characterRelations!: Table<CharacterRelation, string>
  worldBooks!: Table<WorldBook, string>
  worldBookGroups!: Table<WorldBookGroup, string>
  worldBookEntries!: Table<WorldBookEntry, string>
  collections!: Table<Collection, string>
  aiProviders!: Table<AIProvider, string>
  settings!: Table<Setting, string>
  maps!: Table<NovelMap, string>

  constructor() {
    super('NovelDB')
    
    this.version(4).stores({
      chapters: 'id, parentId, level, wordCount, createdAt, updatedAt',
      characters: 'id, name, enabled, collectionId, createdAt, updatedAt',
      characterRelations: 'id, fromCharacterId, toCharacterId, relationType, createdAt, updatedAt',
      worldBooks: 'id, name, enabled, collectionId, createdAt, updatedAt',
      worldBookGroups: 'id, worldBookId, name, enabled, createdAt, updatedAt',
      worldBookEntries: 'id, groupId, key, enabled, priority, createdAt, updatedAt',
      collections: 'id, type, name, createdAt, updatedAt',
      aiProviders: 'id',
      settings: 'key',
      maps: 'id, type, name, createdAt, updatedAt'
    }).upgrade(async (tx) => {
      console.log('数据库版本升级，清除旧的 AI 提供商数据')
      await tx.table('aiProviders').clear()
    })
  }
}

export const db = new NovelDatabase()

export async function initializeDatabase() {
  try {
    await db.open()
    console.log('数据库初始化成功')
    return true
  } catch (error) {
    console.error('数据库初始化失败:', error)
    return false
  }
}

export async function clearAllData() {
  try {
    await db.transaction('rw', [
      db.chapters,
      db.characters,
      db.characterRelations,
      db.worldBooks,
      db.worldBookGroups,
      db.worldBookEntries,
      db.collections,
      db.aiProviders,
      db.settings,
      db.maps
    ], async () => {
      await Promise.all([
        db.chapters.clear(),
        db.characters.clear(),
        db.characterRelations.clear(),
        db.worldBooks.clear(),
        db.worldBookGroups.clear(),
        db.worldBookEntries.clear(),
        db.collections.clear(),
        db.aiProviders.clear(),
        db.settings.clear(),
        db.maps.clear()
      ])
    })
    console.log('所有数据已清除')
    return true
  } catch (error) {
    console.error('清除数据失败:', error)
    return false
  }
}

export async function exportAllData() {
  try {
    const data = {
      chapters: await db.chapters.toArray(),
      characters: await db.characters.toArray(),
      characterRelations: await db.characterRelations.toArray(),
      worldBooks: await db.worldBooks.toArray(),
      worldBookGroups: await db.worldBookGroups.toArray(),
      worldBookEntries: await db.worldBookEntries.toArray(),
      collections: await db.collections.toArray(),
      aiProviders: await db.aiProviders.toArray(),
      settings: await db.settings.toArray(),
      maps: await db.maps.toArray(),
      exportedAt: Date.now()
    }
    return data
  } catch (error) {
    console.error('导出数据失败:', error)
    return null
  }
}

export async function importAllData(data: any) {
  try {
    await db.transaction('rw', [
      db.chapters,
      db.characters,
      db.characterRelations,
      db.worldBooks,
      db.worldBookGroups,
      db.worldBookEntries,
      db.collections,
      db.aiProviders,
      db.settings,
      db.maps
    ], async () => {
      await Promise.all([
        data.chapters?.length && db.chapters.bulkPut(data.chapters),
        data.characters?.length && db.characters.bulkPut(data.characters),
        data.characterRelations?.length && db.characterRelations.bulkPut(data.characterRelations),
        data.worldBooks?.length && db.worldBooks.bulkPut(data.worldBooks),
        data.worldBookGroups?.length && db.worldBookGroups.bulkPut(data.worldBookGroups),
        data.worldBookEntries?.length && db.worldBookEntries.bulkPut(data.worldBookEntries),
        data.collections?.length && db.collections.bulkPut(data.collections),
        data.aiProviders?.length && db.aiProviders.bulkPut(data.aiProviders),
        data.settings?.length && db.settings.bulkPut(data.settings),
        data.maps?.length && db.maps.bulkPut(data.maps)
      ])
    })
    console.log('数据导入成功')
    return true
  } catch (error) {
    console.error('导入数据失败:', error)
    return false
  }
}
