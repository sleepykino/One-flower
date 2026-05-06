import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db, type WritingStat } from '@/database'

export const useWritingStatsStore = defineStore('writingStats', () => {
  const dailyGoal = ref(2000)
  const todayStats = ref<WritingStat | null>(null)
  const weeklyStats = ref<WritingStat[]>([])
  const isInitialized = ref(false)
  const sessionStartWordCount = ref(0)
  const sessionStartTime = ref(Date.now())

  const todayProgress = computed(() => {
    if (!todayStats.value) return 0
    return Math.min(100, Math.round((todayStats.value.wordCount / dailyGoal.value) * 100))
  })

  const todayWordsWritten = computed(() => {
    return todayStats.value?.wordCount || 0
  })

  const weeklyTotal = computed(() => {
    return weeklyStats.value.reduce((sum, s) => sum + s.wordCount, 0)
  })

  const weeklyAverage = computed(() => {
    if (weeklyStats.value.length === 0) return 0
    return Math.round(weeklyTotal.value / weeklyStats.value.length)
  })

  const streakDays = computed(() => {
    let streak = 0
    const sorted = [...weeklyStats.value].sort((a, b) => b.date.localeCompare(a.date))
    for (const stat of sorted) {
      if (stat.wordCount > 0) streak++
      else break
    }
    return streak
  })

  function getTodayKey(): string {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  async function loadStats() {
    if (isInitialized.value) return

    try {
      const goalSetting = await db.settings.get('dailyGoal')
      if (goalSetting) dailyGoal.value = Number(goalSetting.value) || 2000

      const todayKey = getTodayKey()
      const todayRecord = await db.writingStats.where('date').equals(todayKey).first()
      todayStats.value = todayRecord || {
        id: 'ws_' + Date.now().toString(36),
        date: todayKey,
        wordCount: 0,
        duration: 0,
        chaptersWorked: []
      }

      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const weekKey = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`
      weeklyStats.value = await db.writingStats.where('date').aboveOrEqual(weekKey).toArray()

      isInitialized.value = true
    } catch (e) {
      console.error('加载写作统计失败:', e)
    }
  }

  async function recordWordCount(wordsAdded: number, chapterId: string) {
    if (wordsAdded <= 0) return

    const todayKey = getTodayKey()
    if (!todayStats.value || todayStats.value.date !== todayKey) {
      todayStats.value = {
        id: 'ws_' + Date.now().toString(36),
        date: todayKey,
        wordCount: 0,
        duration: 0,
        chaptersWorked: []
      }
    }

    todayStats.value.wordCount += wordsAdded
    if (!todayStats.value.chaptersWorked.includes(chapterId)) {
      todayStats.value.chaptersWorked.push(chapterId)
    }

    await db.writingStats.put(todayStats.value)
  }

  async function updateDailyGoal(goal: number) {
    dailyGoal.value = goal
    await db.settings.put({ key: 'dailyGoal', value: goal })
  }

  async function recordSessionDuration() {
    if (!todayStats.value) return
    const elapsed = Math.round((Date.now() - sessionStartTime.value) / 60000)
    if (elapsed > 0) {
      todayStats.value.duration += elapsed
      await db.writingStats.put(todayStats.value)
    }
  }

  function startNewSession() {
    sessionStartWordCount.value = 0
    sessionStartTime.value = Date.now()
  }

  async function getLast7DaysStats(): Promise<WritingStat[]> {
    const result: WritingStat[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const stat = await db.writingStats.where('date').equals(key).first()
      result.push(stat || {
        id: '',
        date: key,
        wordCount: 0,
        duration: 0,
        chaptersWorked: []
      })
    }
    return result
  }

  return {
    dailyGoal,
    todayStats,
    weeklyStats,
    isInitialized,
    todayProgress,
    todayWordsWritten,
    weeklyTotal,
    weeklyAverage,
    streakDays,
    sessionStartWordCount,
    loadStats,
    recordWordCount,
    updateDailyGoal,
    recordSessionDuration,
    startNewSession,
    getLast7DaysStats
  }
})
