import { defineStore } from 'pinia'
import { createNote, deleteNote, listDayCounts, listNotes, listNotesByDay, updateNote } from '@/api/notes'
import { NOTE_IMAGE_SIGN_TTL, removeNoteImages, signNoteImages } from '@/api/noteImages'
import { countLocalNotesByDay, createLocalNote, deleteLocalNote, listLocalNotes, listLocalNotesByDay, updateLocalNote } from '@/api/localNotes'
import { clearLocalNoteImageUrlCache, resolveLocalNoteImage } from '@/api/localNoteImages'
import type { Note, NoteDraft } from '@/api/types'
import { dayKey, groupNotesByDay, monthKey, monthRange } from '@/utils/format'
import { getStorageMode } from '@/utils/storageMode'
import { useAuthStore } from './auth'

interface CachedImageUrl {
  url: string
  expiresAt: number
}

interface NotesState {
  notes: Note[]
  loaded: boolean
  loading: boolean
  refreshing: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string
  keyword: string
  selectedDay: string
  dayNotes: Note[]
  dayLoading: boolean
  dayError: string
  monthDays: Record<string, Record<string, number>>
  monthLoading: boolean
  imageUrls: Record<string, CachedImageUrl>
  pendingRemoval: Note | null
}

const UNDO_WINDOW_MS = 5000
let removalTimer: ReturnType<typeof setTimeout> | null = null
const hiddenRemovalIds = new Set<string>()
let removalEpoch = 0
let loadSequence = 0
let daySequence = 0

function insertByDate(list: Note[], note: Note) {
  if (list.some((item) => item.id === note.id)) return list
  return [...list, note].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function visibleNotes(notes: Note[]) {
  return notes.filter((note) => !hiddenRemovalIds.has(note.id))
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '网络异常，请稍后重试'
}

export const useNotesStore = defineStore('notes', {
  state: (): NotesState => ({
    notes: [],
    loaded: false,
    loading: false,
    refreshing: false,
    loadingMore: false,
    hasMore: false,
    error: '',
    keyword: '',
    selectedDay: '',
    dayNotes: [],
    dayLoading: false,
    dayError: '',
    monthDays: {},
    monthLoading: false,
    imageUrls: {},
    pendingRemoval: null
  }),
  getters: {
    dayGroups: (state) => groupNotesByDay(state.notes),
    activeNotes: (state) => (state.selectedDay ? state.dayNotes : state.notes),
    activeGroups: (state) => groupNotesByDay(state.selectedDay ? state.dayNotes : state.notes),
    activeLoading: (state) => (state.selectedDay ? state.dayLoading : state.loading),
    activeError: (state) => (state.selectedDay ? state.dayError : state.error),
    totalCount: (state) => state.notes.length,
    imageUrl: (state) => (path: string) => state.imageUrls[path]?.url ?? ''
  },
  actions: {
    async requireToken() {
      if (getStorageMode() === 'local') return ''
      const auth = useAuthStore()
      const valid = await auth.ensureValidSession()
      if (!valid || !auth.token) throw new Error('登录已过期，请重新登录')
      return auth.token
    },
    async resolveImages(notes: Note[]) {
      const margin = 10 * 60 * 1000
      const now = Date.now()
      const paths = [...new Set(notes.flatMap((note) => note.images))].filter((path) => {
        const cached = this.imageUrls[path]
        return !cached || cached.expiresAt < now + margin
      })
      if (!paths.length) return
      if (getStorageMode() === 'local') {
        try {
          const entries = await Promise.all(paths.map(async (path) => [
            path,
            { url: await resolveLocalNoteImage(path), expiresAt: Number.MAX_SAFE_INTEGER }
          ] as const))
          this.imageUrls = { ...this.imageUrls, ...Object.fromEntries(entries) }
        } catch {
          // 图片读取失败时保留时间轴占位图，重新进入笔记可再次读取。
        }
        return
      }
      try {
        const token = await this.requireToken()
        const signed = await signNoteImages(token, paths)
        const expiresAt = Date.now() + (NOTE_IMAGE_SIGN_TTL * 1000 - margin)
        const entries = Object.entries(signed).map(([path, url]) => [path, { url, expiresAt }])
        this.imageUrls = { ...this.imageUrls, ...Object.fromEntries(entries) }
      } catch {
        // 签名失败时时间轴显示占位图，下拉刷新可重试。
      }
    },
    async load() {
      const sequence = ++loadSequence
      this.loading = true
      this.error = ''
      try {
        const result = getStorageMode() === 'local'
          ? listLocalNotes({ keyword: this.keyword })
          : await listNotes(await this.requireToken(), { keyword: this.keyword })
        if (sequence !== loadSequence) return
        this.notes = visibleNotes(result.notes)
        this.hasMore = result.hasMore
        this.loaded = true
        void this.resolveImages(result.notes)
      } catch (error) {
        if (sequence !== loadSequence) return
        this.error = errorMessage(error)
        throw error
      } finally {
        if (sequence === loadSequence) this.loading = false
      }
    },
    async refresh() {
      if (this.refreshing) return
      this.refreshing = true
      this.error = ''
      try {
        const result = getStorageMode() === 'local'
          ? listLocalNotes({ keyword: this.keyword })
          : await listNotes(await this.requireToken(), { keyword: this.keyword })
        this.notes = visibleNotes(result.notes)
        this.hasMore = result.hasMore
        this.loaded = true
        void this.resolveImages(result.notes)
      } catch (error) {
        this.error = errorMessage(error)
        throw error
      } finally {
        this.refreshing = false
      }
    },
    async loadMore() {
      if (this.loadingMore || !this.hasMore || !this.notes.length) return
      this.loadingMore = true
      try {
        const last = this.notes[this.notes.length - 1]
        if (!last) return
        const keyword = this.keyword
        const result = getStorageMode() === 'local'
          ? listLocalNotes({ before: last.createdAt, keyword })
          : await listNotes(await this.requireToken(), { before: last.createdAt, keyword })
        if (keyword !== this.keyword || this.selectedDay) return
        this.notes = [...this.notes, ...visibleNotes(result.notes)]
        this.hasMore = result.hasMore
        void this.resolveImages(result.notes)
      } catch (error) {
        this.error = errorMessage(error)
        throw error
      } finally {
        this.loadingMore = false
      }
    },
    async search(keyword: string) {
      const nextKeyword = keyword.trim()
      if (nextKeyword !== this.keyword) {
        this.notes = []
        this.hasMore = false
      }
      this.keyword = nextKeyword
      this.loaded = false
      await this.load()
    },
    async selectDay(day: string) {
      const sequence = ++daySequence
      if (day !== this.selectedDay) this.dayNotes = []
      this.selectedDay = day
      this.dayError = ''
      if (!day) {
        this.dayNotes = []
        this.dayLoading = false
        return
      }
      this.dayLoading = true
      try {
        const notes = getStorageMode() === 'local'
          ? listLocalNotesByDay(day)
          : await listNotesByDay(await this.requireToken(), day)
        if (sequence !== daySequence) return
        this.dayNotes = visibleNotes(notes)
        void this.resolveImages(this.dayNotes)
      } catch (error) {
        if (sequence !== daySequence) return
        this.dayError = errorMessage(error)
        throw error
      } finally {
        if (sequence === daySequence) this.dayLoading = false
      }
    },
    async refreshActive() {
      if (this.selectedDay) {
        await this.selectDay(this.selectedDay)
      } else {
        await this.refresh()
      }
    },
    async loadMonthDays(year: number, month: number) {
      const key = monthKey(year, month)
      const cached = this.monthDays[key]
      if (cached) return cached
      this.monthLoading = true
      try {
        const range = monthRange(year, month)
        const counts = getStorageMode() === 'local'
          ? countLocalNotesByDay(range)
          : await listDayCounts(await this.requireToken(), range)
        this.monthDays = { ...this.monthDays, [key]: counts }
        return counts
      } catch {
        return {}
      } finally {
        this.monthLoading = false
      }
    },
    invalidateMonths() {
      this.monthDays = {}
    },
    async create(draft: NoteDraft) {
      const local = getStorageMode() === 'local'
      const token = local ? '' : await this.requireToken()
      const note = local ? createLocalNote(draft) : await createNote(token, draft)
      this.invalidateMonths()
      void this.resolveImages([note])
      if (this.selectedDay) {
        if (dayKey(note.createdAt) === this.selectedDay) this.dayNotes = [note, ...this.dayNotes]
      } else if (this.keyword) {
        await this.refresh()
      } else {
        this.notes = [note, ...this.notes]
      }
      return note
    },
    async update(id: string, draft: NoteDraft) {
      const local = getStorageMode() === 'local'
      const token = local ? '' : await this.requireToken()
      const previous = [...this.notes, ...this.dayNotes].find((item) => item.id === id)
      const note = local ? updateLocalNote(id, draft) : await updateNote(token, id, draft)
      this.invalidateMonths()
      this.notes = this.notes.map((item) => (item.id === id ? note : item))
      this.dayNotes = this.dayNotes.map((item) => (item.id === id ? note : item))
      void this.resolveImages([note])
      const removed = previous?.images.filter((path) => !draft.images.includes(path)) ?? []
      if (removed.length) {
        removeNoteImages(token, removed).catch(() => {})
      }
      return note
    },
    async remove(id: string) {
      const local = getStorageMode() === 'local'
      const token = local ? '' : await this.requireToken()
      const previous = [...this.notes, ...this.dayNotes].find((item) => item.id === id)
      if (local) deleteLocalNote(id)
      else await deleteNote(token, id)
      this.invalidateMonths()
      this.notes = this.notes.filter((item) => item.id !== id)
      this.dayNotes = this.dayNotes.filter((item) => item.id !== id)
      if (previous?.images.length) {
        removeNoteImages(token, previous.images).catch(() => {})
      }
    },
    // 滑动删除先本地移除，留出撤销窗口；窗口结束才真正落库，图片不会被提前清掉。
    removeWithUndo(id: string) {
      const note = [...this.notes, ...this.dayNotes].find((item) => item.id === id)
      if (!note) return null
      this.flushRemoval()
      hiddenRemovalIds.add(note.id)
      this.notes = this.notes.filter((item) => item.id !== id)
      this.dayNotes = this.dayNotes.filter((item) => item.id !== id)
      this.pendingRemoval = note
      removalTimer = setTimeout(() => {
        void this.commitRemoval().catch(() => {})
      }, UNDO_WINDOW_MS)
      return note
    },
    undoRemoval() {
      const note = this.pendingRemoval
      if (!note) return false
      if (removalTimer) clearTimeout(removalTimer)
      removalTimer = null
      this.pendingRemoval = null
      hiddenRemovalIds.delete(note.id)
      if (!this.keyword || (note.contentText ?? '').toLowerCase().includes(this.keyword.toLowerCase())) {
        this.notes = insertByDate(this.notes, note)
      }
      if (this.selectedDay) {
        if (dayKey(note.createdAt) === this.selectedDay) this.dayNotes = insertByDate(this.dayNotes, note)
      }
      return true
    },
    async commitRemoval() {
      const note = this.pendingRemoval
      if (!note) return
      if (removalTimer) clearTimeout(removalTimer)
      removalTimer = null
      this.pendingRemoval = null
      const epoch = removalEpoch
      try {
        const local = getStorageMode() === 'local'
        const token = local ? '' : await this.requireToken()
        if (local) deleteLocalNote(note.id)
        else await deleteNote(token, note.id)
        this.invalidateMonths()
        if (note.images.length) removeNoteImages(token, note.images).catch(() => {})
      } catch (error) {
        if (epoch !== removalEpoch) return
        hiddenRemovalIds.delete(note.id)
        if (!this.keyword || (note.contentText ?? '').toLowerCase().includes(this.keyword.toLowerCase())) {
          this.notes = insertByDate(this.notes, note)
        }
        if (this.selectedDay && dayKey(note.createdAt) === this.selectedDay) {
          this.dayNotes = insertByDate(this.dayNotes, note)
        }
        this.error = errorMessage(error)
        uni.showToast({ title: '删除失败，笔记已恢复', icon: 'none' })
        throw error
      }
    },
    flushRemoval() {
      if (!this.pendingRemoval) return
      void this.commitRemoval().catch(() => {})
    },
    reset() {
      if (removalTimer) clearTimeout(removalTimer)
      removalTimer = null
      removalEpoch += 1
      loadSequence += 1
      daySequence += 1
      hiddenRemovalIds.clear()
      this.notes = []
      this.loaded = false
      this.loading = false
      this.refreshing = false
      this.loadingMore = false
      this.hasMore = false
      this.error = ''
      this.keyword = ''
      this.selectedDay = ''
      this.dayNotes = []
      this.dayLoading = false
      this.dayError = ''
      this.monthDays = {}
      this.monthLoading = false
      this.imageUrls = {}
      clearLocalNoteImageUrlCache()
      this.pendingRemoval = null
    }
  }
})
