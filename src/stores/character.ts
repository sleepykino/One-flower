import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Character, CharacterRelation } from '@/types'
import { db } from '@/database'

export const useCharacterStore = defineStore('character', () => {
  const characters = ref<Character[]>([])
  const currentCharacterId = ref<string | null>(null)
  const isInitialized = ref(false)
  const isLoading = ref(false)

  async function loadCharactersFromStorage() {
    if (isInitialized.value) return
    
    isLoading.value = true
    try {
      const savedCharacters = await db.characters.toArray()
      characters.value = savedCharacters

      const savedCurrentCharacterId = await db.settings.get('currentCharacterId')
      if (savedCurrentCharacterId) {
        currentCharacterId.value = savedCurrentCharacterId.value
      } else if (characters.value.length > 0) {
        currentCharacterId.value = characters.value[0].id
      }
      
      isInitialized.value = true
    } catch (e) {
      console.error('加载角色数据失败:', e)
      characters.value = []
    } finally {
      isLoading.value = false
    }
  }

  async function saveCharactersToStorage() {
    try {
      await db.characters.clear()
      await db.characters.bulkPut(characters.value)
    } catch (e) {
      console.error('保存角色数据失败:', e)
    }
  }

  async function saveCurrentCharacterToStorage() {
    if (currentCharacterId.value) {
      await db.settings.put({ key: 'currentCharacterId', value: currentCharacterId.value })
    }
  }

  function generateId(): string {
    return 'char_' + Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  const currentCharacter = computed(() => {
    if (!currentCharacterId.value) return null
    return characters.value.find(char => char.id === currentCharacterId.value) || null
  })

  const enabledCharacters = computed(() => {
    return characters.value.filter(char => char.enabled)
  })

  async function addCharacter(characterData: Partial<Character> = {}): Promise<Character> {
    const now = Date.now()
    const newCharacter: Character = {
      id: generateId(),
      name: characterData.name || '新角色',
      description: characterData.description || '',
      personality: characterData.personality || '',
      background: characterData.background || '',
      appearance: characterData.appearance || '',
      speech_style: characterData.speech_style || '',
      relationships: characterData.relationships || '',
      notes: characterData.notes || '',
      avatar: characterData.avatar,
      tags: characterData.tags || [],
      enabled: characterData.enabled !== undefined ? characterData.enabled : true,
      relations: characterData.relations || [],
      createdAt: now,
      updatedAt: now
    }

    characters.value.push(newCharacter)
    await saveCharactersToStorage()
    return newCharacter
  }

  async function updateCharacter(id: string, updates: Partial<Character>): Promise<boolean> {
    const index = characters.value.findIndex(char => char.id === id)
    if (index === -1) return false

    characters.value[index] = {
      ...characters.value[index],
      ...updates,
      updatedAt: Date.now()
    }

    await saveCharactersToStorage()
    return true
  }

  async function deleteCharacter(id: string): Promise<boolean> {
    const index = characters.value.findIndex(char => char.id === id)
    if (index === -1) return false

    characters.value.splice(index, 1)

    await db.characterRelations.where('fromCharacterId').equals(id).delete()
    await db.characterRelations.where('toCharacterId').equals(id).delete()

    if (currentCharacterId.value === id) {
      currentCharacterId.value = characters.value.length > 0 ? characters.value[0].id : null
      await saveCurrentCharacterToStorage()
    }

    await saveCharactersToStorage()
    return true
  }

  async function duplicateCharacter(id: string): Promise<Character | null> {
    const original = characters.value.find(char => char.id === id)
    if (!original) return null

    const now = Date.now()
    const duplicated: Character = {
      ...original,
      id: generateId(),
      name: `${original.name} (副本)`,
      createdAt: now,
      updatedAt: now
    }

    characters.value.push(duplicated)
    await saveCharactersToStorage()
    return duplicated
  }

  async function toggleCharacterEnabled(id: string): Promise<boolean> {
    const character = characters.value.find(char => char.id === id)
    if (!character) return false

    character.enabled = !character.enabled
    character.updatedAt = Date.now()
    await saveCharactersToStorage()
    return true
  }

  async function setCurrentCharacter(id: string) {
    currentCharacterId.value = id
    await saveCurrentCharacterToStorage()
  }

  function findCharacterById(id: string): Character | null {
    return characters.value.find(char => char.id === id) || null
  }

  function getCharactersByTag(tag: string): Character[] {
    return characters.value.filter(char => char.tags.includes(tag))
  }

  function exportCharacters(): string {
    return JSON.stringify(characters.value, null, 2)
  }

  async function importCharacters(jsonData: string): Promise<boolean> {
    try {
      const imported = JSON.parse(jsonData)
      if (!Array.isArray(imported)) return false

      const now = Date.now()
      const newCharacters = imported.map((char: any) => ({
        ...char,
        id: generateId(),
        createdAt: now,
        updatedAt: now
      }))

      characters.value.push(...newCharacters)
      await saveCharactersToStorage()
      return true
    } catch (e) {
      console.error('导入角色数据失败:', e)
      return false
    }
  }

  async function getCharacterRelations(characterId: string): Promise<CharacterRelation[]> {
    return await db.characterRelations
      .where('fromCharacterId')
      .equals(characterId)
      .toArray()
  }

  async function addCharacterRelation(relation: Omit<CharacterRelation, 'id' | 'createdAt' | 'updatedAt'>): Promise<CharacterRelation> {
    const now = Date.now()
    const newRelation: CharacterRelation = {
      ...relation,
      id: 'rel_' + Date.now().toString(36) + Math.random().toString(36).substr(2),
      createdAt: now,
      updatedAt: now
    }
    
    await db.characterRelations.add(newRelation)
    return newRelation
  }

  async function updateCharacterRelation(id: string, updates: Partial<CharacterRelation>): Promise<boolean> {
    try {
      await db.characterRelations.update(id, { ...updates, updatedAt: Date.now() })
      return true
    } catch {
      return false
    }
  }

  async function deleteCharacterRelation(id: string): Promise<boolean> {
    try {
      await db.characterRelations.delete(id)
      return true
    } catch {
      return false
    }
  }

  return {
    characters,
    currentCharacterId,
    currentCharacter,
    enabledCharacters,
    isInitialized,
    isLoading,
    loadCharactersFromStorage,
    saveCharactersToStorage,
    saveCurrentCharacterToStorage,
    addCharacter,
    updateCharacter,
    deleteCharacter,
    duplicateCharacter,
    toggleCharacterEnabled,
    setCurrentCharacter,
    findCharacterById,
    getCharactersByTag,
    exportCharacters,
    importCharacters,
    getCharacterRelations,
    addCharacterRelation,
    updateCharacterRelation,
    deleteCharacterRelation
  }
})
