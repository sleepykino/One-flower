import { db } from './db'
import type { Chapter } from '@/stores/chapter'
import type { Character, CharacterRelation, WorldBook, Collection } from '@/types'

interface LegacyChapter {
  id: string
  title: string
  content: string
  wordCount: number
  parentId: string | null
  children: LegacyChapter[]
  isExpanded?: boolean
  level: number
}

interface LegacyCharacter extends Character {}

interface LegacyWorldBook extends WorldBook {}

interface LegacyCollection extends Collection {}

interface LegacyAIProvider {
  id: string
  name: string
  type: string
  baseUrl: string
  apiKey: string
  models: any[]
  enabled: boolean
  isCustom?: boolean
  headers?: Record<string, string>
  bodyTemplate?: string
}

function flattenChapters(chapters: LegacyChapter[], result: Chapter[] = []): Chapter[] {
  chapters.forEach(chapter => {
    const flatChapter: Chapter = {
      id: chapter.id,
      title: chapter.title,
      content: chapter.content,
      wordCount: chapter.wordCount,
      parentId: chapter.parentId,
      level: chapter.level,
      isExpanded: chapter.isExpanded,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    result.push(flatChapter)
    
    if (chapter.children && chapter.children.length > 0) {
      flattenChapters(chapter.children, result)
    }
  })
  return result
}

export async function migrateFromLocalStorage(): Promise<boolean> {
  const migrationKey = 'indexeddb_migration_completed'
  
  if (localStorage.getItem(migrationKey) === 'true') {
    console.log('数据已迁移，跳过')
    return true
  }

  try {
    console.log('开始从 localStorage 迁移数据到 IndexedDB...')
    
    const chaptersData = localStorage.getItem('novelChapters')
    const charactersData = localStorage.getItem('characters')
    const worldBooksData = localStorage.getItem('worldBooks')
    const collectionsData = localStorage.getItem('collections')
    const aiProvidersData = localStorage.getItem('aiProviders')
    const customProvidersData = localStorage.getItem('customProviders')
    
    const settingsToMigrate = [
      { key: 'glmApiKey', value: localStorage.getItem('glmApiKey') },
      { key: 'glmTemperature', value: localStorage.getItem('glmTemperature') },
      { key: 'deepseekApiKey', value: localStorage.getItem('deepseekApiKey') },
      { key: 'deepseekTemperature', value: localStorage.getItem('deepseekTemperature') },
      { key: 'selectedStyle', value: localStorage.getItem('selectedStyle') },
      { key: 'stylePrompt', value: localStorage.getItem('stylePrompt') },
      { key: 'selectedProviderId', value: localStorage.getItem('selectedProviderId') },
      { key: 'selectedModelId', value: localStorage.getItem('selectedModelId') },
      { key: 'currentChapterId', value: localStorage.getItem('currentChapterId') },
      { key: 'currentCharacterId', value: localStorage.getItem('currentCharacterId') },
      { key: 'currentWorldBookId', value: localStorage.getItem('currentWorldBookId') }
    ]

    await db.transaction('rw', [
      db.chapters,
      db.characters,
      db.characterRelations,
      db.worldBooks,
      db.worldBookGroups,
      db.worldBookEntries,
      db.collections,
      db.aiProviders,
      db.settings
    ], async () => {
      if (chaptersData) {
        try {
          const chapters = JSON.parse(chaptersData) as LegacyChapter[]
          const flatChapters = flattenChapters(chapters)
          if (flatChapters.length > 0) {
            await db.chapters.bulkPut(flatChapters)
            console.log(`迁移 ${flatChapters.length} 个章节`)
          }
        } catch (e) {
          console.error('迁移章节数据失败:', e)
        }
      }

      if (charactersData) {
        try {
          const characters = JSON.parse(charactersData) as LegacyCharacter[]
          const relations: CharacterRelation[] = []
          
          for (const char of characters) {
            if (char.relations && char.relations.length > 0) {
              relations.push(...char.relations)
            }
          }
          
          if (characters.length > 0) {
            await db.characters.bulkPut(characters)
            console.log(`迁移 ${characters.length} 个角色`)
          }
          
          if (relations.length > 0) {
            await db.characterRelations.bulkPut(relations)
            console.log(`迁移 ${relations.length} 个角色关系`)
          }
        } catch (e) {
          console.error('迁移角色数据失败:', e)
        }
      }

      if (worldBooksData) {
        try {
          const worldBooks = JSON.parse(worldBooksData) as LegacyWorldBook[]
          
          for (const worldBook of worldBooks) {
            const { groups, ...worldBookBase } = worldBook
            
            await db.worldBooks.put(worldBookBase)
            
            if (groups && groups.length > 0) {
              for (const group of groups) {
                const { entries, ...groupBase } = group
                await db.worldBookGroups.put(groupBase)
                
                if (entries && entries.length > 0) {
                  await db.worldBookEntries.bulkPut(entries)
                }
              }
            }
          }
          console.log(`迁移 ${worldBooks.length} 个世界书`)
        } catch (e) {
          console.error('迁移世界书数据失败:', e)
        }
      }

      if (collectionsData) {
        try {
          const collections = JSON.parse(collectionsData) as LegacyCollection[]
          if (collections.length > 0) {
            await db.collections.bulkPut(collections)
            console.log(`迁移 ${collections.length} 个合集`)
          }
        } catch (e) {
          console.error('迁移合集数据失败:', e)
        }
      }

      const allProviders: LegacyAIProvider[] = []
      
      if (aiProvidersData) {
        try {
          const providers = JSON.parse(aiProvidersData) as LegacyAIProvider[]
          allProviders.push(...providers)
        } catch (e) {
          console.error('解析 AI providers 失败:', e)
        }
      }
      
      if (customProvidersData) {
        try {
          const customProviders = JSON.parse(customProvidersData) as LegacyAIProvider[]
          allProviders.push(...customProviders)
        } catch (e) {
          console.error('解析自定义 AI providers 失败:', e)
        }
      }
      
      if (allProviders.length > 0) {
        await db.aiProviders.bulkPut(allProviders)
        console.log(`迁移 ${allProviders.length} 个 AI 提供商`)
      }

      const validSettings = settingsToMigrate.filter(s => s.value !== null)
      if (validSettings.length > 0) {
        await db.settings.bulkPut(validSettings)
        console.log(`迁移 ${validSettings.length} 个设置项`)
      }
    })

    localStorage.setItem(migrationKey, 'true')
    console.log('数据迁移完成！')
    return true
  } catch (error) {
    console.error('数据迁移失败:', error)
    return false
  }
}

export async function checkMigrationStatus(): Promise<boolean> {
  return localStorage.getItem('indexeddb_migration_completed') === 'true'
}

export async function resetMigration() {
  localStorage.removeItem('indexeddb_migration_completed')
  console.log('迁移状态已重置')
}
