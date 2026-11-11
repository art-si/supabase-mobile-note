import { defineStore } from 'pinia'
import { createNote, deleteNote, listDayCounts, listNotes, listNotesByDay, updateNote } from '@/api/notes'
import { NOTE_IMAGE_SIGN_TTL, removeNoteImages, signNoteImages } from '@/api/noteImages'
import type { Note, NoteDraft } from '@/api/types'
import { dayKey, groupNotesByDay, monthKey, monthRange } from '@/utils/format'
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
    imageUrls: {}
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
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const token = await this.requireToken()
        const result = await listNotes(token, { keyword: this.keyword })
        this.notes = result.notes
        this.hasMore = result.hasMore
        this.loaded = true
        void this.resolveImages(result.notes)
      } catch (error) {
        this.error = errorMessage(error)
        throw error
      } finally {
        this.loading = false
      }
    },
    async refresh() {
      if (this.refreshing) return
      this.refreshing = true
      this.error = ''
      try {
        const token = await this.requireToken()
        const result = await listNotes(token, { keyword: this.keyword })
        this.notes = result.notes
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
        const token = await this.requireToken()
        const last = this.notes[this.notes.length - 1]
        if (!last) return
        const result = await listNotes(token, { before: last.createdAt, keyword: this.keyword })
        this.notes = [...this.notes, ...result.notes]
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
      this.keyword = keyword.trim()
      this.loaded = false
      await this.load()
    },
    async selectDay(day: string) {
      this.selectedDay = day
      this.dayError = ''
      if (!day) {
        this.dayNotes = []
        return
      }
      this.dayLoading = true
      try {
        const token = await this.requireToken()
        this.dayNotes = await listNotesByDay(token, day)
        void this.resolveImages(this.dayNotes)
      } catch (error) {
        this.dayError = errorMessage(error)
        throw error
      } finally {
        this.dayLoading = false
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
        const token = await this.requireToken()
        const counts = await listDayCounts(token, monthRange(year, month))
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
      const token = await this.requireToken()
      const note = await createNote(token, draft)
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
      const token = await this.requireToken()
      const previous = [...this.notes, ...this.dayNotes].find((item) => item.id === id)
      const note = await updateNote(token, id, draft)
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
      const token = await this.requireToken()
      const previous = [...this.notes, ...this.dayNotes].find((item) => item.id === id)
      await deleteNote(token, id)
      this.invalidateMonths()
      this.notes = this.notes.filter((item) => item.id !== id)
      this.dayNotes = this.dayNotes.filter((item) => item.id !== id)
      if (previous?.images.length) {
        removeNoteImages(token, previous.images).catch(() => {})
      }
    },
    reset() {
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
    }
  }
})