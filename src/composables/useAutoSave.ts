import { ref } from 'vue'
import { db, type VersionSnapshot } from '@/database'

export function useAutoSave() {
  const lastSavedAt = ref<number>(0)
  const isAutoSaving = ref(false)
  const AUTO_SAVE_DELAY = 30000
  const MAX_VERSIONS_PER_CHAPTER = 50

  let pendingSave = false
  let currentQuill: any = null
  let currentChapterId: string | null = null
  let autoSaveInterval: number | null = null

  function init(quillRef: any, chapterId: string | null) {
    currentQuill = quillRef
    currentChapterId = chapterId
  }

  function updateChapterId(chapterId: string | null) {
    currentChapterId = chapterId
  }

  async function autoSave() {
    if (!currentQuill || !currentChapterId || isAutoSaving.value) return

    isAutoSaving.value = true
    try {
      const content = currentQuill.root.innerHTML
      const text = currentQuill.getText()
      const wordCount = text.replace(/\s/g, '').length

      const chapter = await db.chapters.get(currentChapterId)
      if (chapter) {
        await db.chapters.update(currentChapterId, {
          content,
          wordCount,
          updatedAt: Date.now()
        })
        lastSavedAt.value = Date.now()
      }
    } catch (e) {
      console.error('自动保存失败:', e)
    } finally {
      isAutoSaving.value = false
    }
  }

  async function createVersionSnapshot() {
    if (!currentQuill || !currentChapterId) return

    try {
      const content = currentQuill.root.innerHTML
      const text = currentQuill.getText()
      const wordCount = text.replace(/\s/g, '').length
      const chapter = await db.chapters.get(currentChapterId)

      const snapshot: VersionSnapshot = {
        id: 'vs_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
        chapterId: currentChapterId,
        content,
        wordCount,
        title: chapter?.title || '',
        createdAt: Date.now()
      }

      await db.versionSnapshots.put(snapshot)

      const allVersions = await db.versionSnapshots
        .where('chapterId')
        .equals(currentChapterId)
        .sortBy('createdAt')

      if (allVersions.length > MAX_VERSIONS_PER_CHAPTER) {
        const toDelete = allVersions.slice(0, allVersions.length - MAX_VERSIONS_PER_CHAPTER)
        await db.versionSnapshots.bulkDelete(toDelete.map(v => v.id))
      }
    } catch (e) {
      console.error('创建版本快照失败:', e)
    }
  }

  async function getVersionSnapshots(chapterId: string): Promise<VersionSnapshot[]> {
    return db.versionSnapshots
      .where('chapterId')
      .equals(chapterId)
      .sortBy('createdAt')
  }

  async function restoreVersion(snapshotId: string): Promise<VersionSnapshot | null> {
    const snapshot = await db.versionSnapshots.get(snapshotId)
    return snapshot || null
  }

  async function deleteVersion(snapshotId: string) {
    await db.versionSnapshots.delete(snapshotId)
  }

  function startAutoSave() {
    if (autoSaveInterval) return

    autoSaveInterval = window.setInterval(async () => {
      if (pendingSave) {
        await autoSave()
        pendingSave = false
      }
    }, AUTO_SAVE_DELAY)
  }

  function stopAutoSave() {
    if (autoSaveInterval) {
      clearInterval(autoSaveInterval)
      autoSaveInterval = null
    }
  }

  function markDirty() {
    pendingSave = true
  }

  return {
    lastSavedAt,
    isAutoSaving,
    init,
    updateChapterId,
    autoSave,
    createVersionSnapshot,
    getVersionSnapshots,
    restoreVersion,
    deleteVersion,
    markDirty,
    startAutoSave,
    stopAutoSave
  }
}
