import type { Note, NoteDraft } from './types'
import type { NoteListResult } from './notes'
import { htmlToPlainText } from '@/utils/richText'
import { dayKey } from '@/utils/format'

const STORAGE_KEY = 'note-local-entries'
const PAGE_SIZE = 20

function readRows(): Note[] {
  let value: unknown = uni.getStorageSync(STORAGE_KEY)
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.filter((row): row is Note => {
    if (!row || typeof row !== 'object') return false
    const item = row as Partial<Note>
    return typeof item.id === 'string' && typeof item.content === 'string' && typeof item.createdAt === 'string'
  }).map((row) => ({
    ...row,
    userId: 'local-device',
    contentText: row.contentText || htmlToPlainText(row.content),
    mood: row.mood || 'calm',
    images: Array.isArray(row.images) ? row.images : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    updatedAt: row.updatedAt || row.createdAt
  }))
}

function writeRows(rows: Note[]) {
  try {
    uni.setStorageSync(STORAGE_KEY, rows)
  } catch (cause) {
    console.warn('[notes] local storage write failed', cause)
    throw new Error('本机存储空间不足，请清理设备空间后重试')
  }
}

function sortedRows(rows = readRows()) {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export function getAllLocalNotes() {
  return sortedRows()
}

export function saveLocalBackup(note: Note, previous?: Note): boolean {
  const rows = readRows()
  const current = rows.find(row => row.id === note.id)
  if (current ? !previous || current.updatedAt !== previous.updatedAt : Boolean(previous)) return false
  writeRows([{ ...note, userId: 'local-device', backupSourceUpdatedAt: note.updatedAt }, ...rows.filter(row => row.id !== note.id)])
  return true
}

export function listLocalNotes(options: { before?: string; keyword?: string } = {}): NoteListResult {
  const keyword = options.keyword?.trim().toLocaleLowerCase() || ''
  const rows = sortedRows().filter((note) => {
    if (options.before && note.createdAt >= options.before) return false
    return !keyword || `${note.contentText ?? ''} ${note.content} ${note.tags.join(' ')}`.toLocaleLowerCase().includes(keyword)
  })
  return { notes: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE }
}

export function listLocalNotesByDay(day: string): Note[] {
  return sortedRows().filter((note) => dayKey(note.createdAt) === day)
}

export function countLocalNotesByDay(range: { from: string; to: string }): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const note of readRows()) {
    if (note.createdAt < range.from || note.createdAt >= range.to) continue
    const key = dayKey(note.createdAt)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

export function createLocalNote(draft: NoteDraft): Note {
  const now = draft.createdAt || new Date().toISOString()
  const note: Note = {
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    userId: 'local-device',
    content: draft.content,
    contentText: htmlToPlainText(draft.content),
    mood: draft.mood || 'calm',
    images: [...draft.images],
    tags: [...draft.tags],
    createdAt: now,
    updatedAt: now
  }
  writeRows([note, ...readRows()])
  return note
}

export function updateLocalNote(id: string, draft: NoteDraft): Note {
  const rows = readRows()
  const index = rows.findIndex((note) => note.id === id)
  if (index < 0) throw new Error('笔记不存在，请刷新后重试')
  const previous = rows[index]!
  const note: Note = {
    ...previous,
    content: draft.content,
    contentText: htmlToPlainText(draft.content),
    mood: draft.mood || 'calm',
    images: [...draft.images],
    tags: [...draft.tags],
    createdAt: draft.createdAt || previous.createdAt,
    updatedAt: new Date().toISOString()
  }
  rows[index] = note
  writeRows(rows)
  return note
}

export function deleteLocalNote(id: string) {
  writeRows(readRows().filter((note) => note.id !== id))
}
