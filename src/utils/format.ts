import type { Note } from '@/api/types'

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
export const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六']

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function dayKey(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayKey() {
  return dayKey(new Date().toISOString())
}

export function parseDayKey(key: string) {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function dayRange(key: string) {
  const start = parseDayKey(key)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function monthKey(year: number, month: number) {
  return `${year}-${pad(month + 1)}`
}

export function monthRange(year: number, month: number) {
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function formatDayKey(key: string) {
  const date = parseDayKey(key)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function weekdayShort(key: string) {
  return WEEKDAY_SHORT[parseDayKey(key).getDay()]
}

export function formatTime(value: string) {
  const date = new Date(value)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatDateTime(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function dayLabel(value: string) {
  const date = new Date(value)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000)

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays > 1 && diffDays < 7) return WEEKDAYS[date.getDay()] ?? ''
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export interface NoteDayGroup {
  key: string
  label: string
  notes: Note[]
}

export function groupNotesByDay(notes: Note[]): NoteDayGroup[] {
  const groups: NoteDayGroup[] = []
  let current: NoteDayGroup | null = null
  for (const note of notes) {
    const key = dayKey(note.createdAt)
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(note.createdAt), notes: [] }
      groups.push(current)
    }
    current.notes.push(note)
  }
  return groups
}