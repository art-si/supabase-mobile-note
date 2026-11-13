import { defineStore } from 'pinia'
import { nextTick } from 'vue'
import { createNote, deleteNote, listDayCounts, listNotes, listNotesByDay, listNotesForImport, updateNote } from '@/api/notes'
import { NOTE_IMAGE_SIGN_TTL, removeNoteImages, signNoteImages, uploadNoteImage } from '@/api/noteImages'
import { countLocalNotesByDay, createLocalNote, deleteLocalNote, getAllLocalNotes, listLocalNotes, listLocalNotesByDay, updateLocalNote } from '@/api/localNotes'
import { clearLocalNoteImageUrlCache, resolveLocalNoteImage } from '@/api/localNoteImages'
import type { Note, NoteDraft } from '@/api/types'
import { dayKey, groupNotesByDay, monthKey, monthRange } from '@/utils/format'
import { getStorageMode } from '@/utils/storageMode'
import { useAuthStore } from './auth'

interface CachedImageUrl {
  url: string
  expiresAt: number
}

export interface LocalImportProgress {
  total: number
  completed: number
  phase: 'checking' | 'image' | 'note' | 'complete'
  imageIndex: number
  imageTotal: number
  imagePercent: number
}

interface LocalImportReceipt {
  cloudId: string
  sourceUpdatedAt: string
}

export interface LocalImportResult {
  added: number
  existing: number
  total: number
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

const IMPORTED_LOCAL_NOTES_KEY = 'note-imported-local-notes'
let loadSequence = 0
let daySequence = 0

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
    activeLoading: (state) => state.refreshing || (state.selectedDay ? state.dayLoading : state.loading),
    activeError: (state) => (state.selectedDay ? state.dayError : state.error),
    totalCount: (state) => state.notes.length,
    imageUrl: (state) => (path: string) => state.imageUrls[path]?.url ?? ''
  },
  actions: {
    async importLocalToCloud(token: string, userId: string, onProgress?: (progress: LocalImportProgress) => void): Promise<LocalImportResult> {
      if (!token || !userId) throw new Error('登录已过期，请重新登录后继续导入')
      const localNotes = getAllLocalNotes()
      const stored = uni.getStorageSync(IMPORTED_LOCAL_NOTES_KEY)
      let imported: Record<string, Record<string, LocalImportReceipt>> = {}
      try {
        const parsed: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [id, receipts] of Object.entries(parsed)) {
            if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts)) continue
            imported[id] = {}
            for (const [localId, receipt] of Object.entries(receipts)) {
              if (receipt && typeof receipt === 'object' && 'cloudId' in receipt && typeof receipt.cloudId === 'string' &&
                'sourceUpdatedAt' in receipt && typeof receipt.sourceUpdatedAt === 'string') {
                imported[id][localId] = { cloudId: receipt.cloudId, sourceUpdatedAt: receipt.sourceUpdatedAt }
              }
            }
          }
        }
      } catch {
        imported = {}
      }
      const receipts = imported[userId] ?? {}
      const progress: LocalImportProgress = {
        total: localNotes.length, completed: 0,
        phase: 'checking', imageIndex: 0, imageTotal: 0, imagePercent: 0
      }
      onProgress?.({ ...progress })
      const backupPrefix = `cloud-backup-${userId}-`
      const backupCloudId = (note: Note) => note.id.startsWith(backupPrefix) && note.backupSourceUpdatedAt === note.updatedAt
        ? note.id.slice(backupPrefix.length) : ''
      const candidates = await listNotesForImport(token, userId, localNotes.map(note => note.createdAt), [
        ...Object.values(receipts).map(receipt => receipt.cloudId), ...localNotes.map(backupCloudId).filter(Boolean)
      ])
      const available = new Map(candidates.map(note => [note.id, note]))
      const result: LocalImportResult = { added: 0, existing: 0, total: localNotes.length }
      const remember = (source: Note, cloud: Note) => {
        receipts[source.id] = { cloudId: cloud.id, sourceUpdatedAt: source.updatedAt }
        imported[userId] = receipts
        uni.setStorageSync(IMPORTED_LOCAL_NOTES_KEY, JSON.stringify(imported))
        available.delete(cloud.id)
        progress.completed += 1
        onProgress?.({ ...progress })
      }
      for (const note of localNotes) {
        const receipt = receipts[note.id]
        const previous = available.get(backupCloudId(note)) ?? (receipt?.sourceUpdatedAt === note.updatedAt ? available.get(receipt.cloudId) : undefined)
        const matching = previous ?? [...available.values()].find(cloud =>
          new Date(cloud.createdAt).getTime() === new Date(note.createdAt).getTime() && cloud.content === note.content &&
          cloud.mood === note.mood && cloud.images.length === note.images.length &&
          JSON.stringify([...cloud.tags].sort()) === JSON.stringify([...note.tags].sort()))
        if (matching) {
          result.existing += 1
          remember(note, matching)
          continue
        }
        const images: string[] = []
        progress.imageTotal = note.images.length
        for (const [index, path] of note.images.entries()) {
          progress.phase = 'image'
          progress.imageIndex = index + 1
          progress.imagePercent = 0
          onProgress?.({ ...progress })
          images.push(await uploadNoteImage(token, userId, path, percent => {
            progress.imagePercent = percent
            onProgress?.({ ...progress })
          }))
        }
        progress.phase = 'note'
        onProgress?.({ ...progress })
        const saved = await createNote(token, {
          content: note.content,
          mood: note.mood,
          images,
          tags: note.tags,
          createdAt: note.createdAt
        })
        result.added += 1
        remember(note, saved)
      }
      progress.phase = 'complete'
      onProgress?.({ ...progress })
      return result
    },
    async requireToken() {
      if (getStorageMode() === 'local') return ''
      const auth = useAuthStore()
      const valid = await auth.ensureValidSession()
      if (!valid || !auth.token) throw new Error('登录已过期，请重新登录')
      await auth.requireCloudAccess()
      return auth.token
    },
    async resolveImages(notes: Note[]) {
      const margin = 60 * 1000
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
        const expiresAt = Date.now() + NOTE_IMAGE_SIGN_TTL * 1000
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
        this.notes = result.notes
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
        const last = this.notes[this.notes.length - 1]
        if (!last) return
        const keyword = this.keyword
        const result = getStorageMode() === 'local'
          ? listLocalNotes({ before: last.createdAt, keyword })
          : await listNotes(await this.requireToken(), { before: last.createdAt, keyword })
        if (keyword !== this.keyword || this.selectedDay) return
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
        this.dayNotes = notes
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
      if (this.refreshing) return
      this.refreshing = true
      try {
        await nextTick()
        // Let the loading state paint even when local storage returns synchronously.
        // #ifdef H5
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
        // #endif
        if (this.selectedDay) {
          await this.selectDay(this.selectedDay)
        } else {
          await this.load()
        }
      } finally {
        this.refreshing = false
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
    reset() {
      loadSequence += 1
      daySequence += 1
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
    }
  }
})
