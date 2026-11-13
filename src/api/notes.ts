import { buildQuery, keysToCamel, request, restPath } from './supabase'
import type { Note, NoteDraft } from './types'
import { dayKey, dayRange } from '@/utils/format'

const PAGE_SIZE = 20

export interface NoteListResult {
  notes: Note[]
  hasMore: boolean
}

/** Reconcile source records with actual cloud rows, including previously imported IDs. */
export async function listNotesForImport(token: string, userId: string, dates: string[], ids: string[]): Promise<Note[]> {
  const notes: Note[] = []
  const uniqueDates = [...new Set(dates)]
  const uniqueIds = [...new Set(ids)]
  const batchSize = 30
  const pageSize = 200
  for (let start = 0; start < Math.max(uniqueDates.length, uniqueIds.length); start += batchSize) {
    const dateBatch = uniqueDates.slice(start, start + batchSize)
    const idBatch = uniqueIds.slice(start, start + batchSize)
    const filters = [dateBatch.length ? `created_at.in.(${dateBatch.join(',')})` : '', idBatch.length ? `id.in.(${idBatch.join(',')})` : ''].filter(Boolean)
    for (let offset = 0; ; offset += pageSize) {
      const rows = await request<unknown[]>(restPath('notes', buildQuery({
        select: '*', user_id: `eq.${userId}`, or: `(${filters.join(',')})`,
        order: 'id.asc', limit: pageSize, offset
      })), { token })
      notes.push(...keysToCamel<Note[]>(rows))
      if (rows.length < pageSize) break
    }
  }
  return [...new Map(notes.map(note => [note.id, note])).values()]
}

export async function listNotes(
  token: string,
  options: { before?: string; keyword?: string } = {}
): Promise<NoteListResult> {
  const params: Record<string, string | number | boolean | undefined> = {
    select: '*',
    order: 'created_at.desc,id.desc',
    limit: PAGE_SIZE + 1
  }
  if (options.before) params.created_at = `lt.${options.before}`
  const keyword = options.keyword?.trim().replace(/[,()*%]/g, '')
  if (keyword) params.content_text = `ilike.*${keyword}*`

  const rows = await request<unknown[]>(restPath('notes', buildQuery(params)), { token })
  const notes = keysToCamel<Note[]>(rows)
  return { notes: notes.slice(0, PAGE_SIZE), hasMore: notes.length > PAGE_SIZE }
}

export async function createNote(token: string, draft: NoteDraft): Promise<Note> {
  const rows = await request<unknown[]>(restPath('notes'), {
    method: 'POST',
    token,
    body: { content: draft.content, mood: draft.mood, images: draft.images, tags: draft.tags, ...(draft.createdAt ? { created_at: draft.createdAt } : {}) },
    headers: { Prefer: 'return=representation' }
  })
  const note = keysToCamel<Note[]>(rows)[0]
  if (!note) throw new Error('保存失败，请稍后重试')
  return note
}

export async function createNoteBatch(token: string, drafts: Array<NoteDraft & { id: string }>): Promise<void> {
  // A retry keeps the same IDs. An uncertain network response cannot produce duplicates.
  await request(restPath('notes', buildQuery({ on_conflict: 'id' })), {
    method: 'POST',
    token,
    body: drafts.map(draft => ({
      id: draft.id, content: draft.content, mood: draft.mood,
      images: draft.images, tags: draft.tags, created_at: draft.createdAt
    })),
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }
  })
}

export async function getCloudNote(token: string, userId: string, id: string): Promise<Note | undefined> {
  const rows = await request<unknown[]>(restPath('notes', buildQuery({ select: '*', id: `eq.${id}`, user_id: `eq.${userId}`, limit: 1 })), { token })
  return keysToCamel<Note[]>(rows)[0]
}

export async function listCloudBackupPage(token: string, userId: string, after: string, limit: number): Promise<Note[]> {
  const rows = await request<unknown[]>(restPath('notes', buildQuery({
    select: 'id,content,content_text,mood,images,tags,created_at,updated_at',
    user_id: `eq.${userId}`, id: after ? `gt.${after}` : undefined, order: 'id.asc', limit
  })), { token })
  return keysToCamel<Note[]>(rows)
}

export async function updateNote(token: string, id: string, draft: NoteDraft): Promise<Note> {
  const rows = await request<unknown[]>(restPath('notes', buildQuery({ id: `eq.${id}` })), {
    method: 'PATCH',
    token,
    body: { content: draft.content, mood: draft.mood, images: draft.images, tags: draft.tags, ...(draft.createdAt ? { created_at: draft.createdAt } : {}) },
    headers: { Prefer: 'return=representation' }
  })
  const note = keysToCamel<Note[]>(rows)[0]
  if (!note) throw new Error('保存失败，请稍后重试')
  return note
}

export async function deleteNote(token: string, id: string): Promise<void> {
  const deleted = await request<Array<{ id: string }>>(restPath('notes', buildQuery({ id: `eq.${id}`, select: 'id' })), {
    method: 'DELETE',
    token,
    headers: { Prefer: 'return=representation' }
  })
  if (deleted.length !== 1) throw new Error('未能删除笔记，请核对云端授权或刷新后重试')
}

export async function listNotesByDay(token: string, day: string): Promise<Note[]> {
  const { from, to } = dayRange(day)
  const rows = await request<unknown[]>(
    restPath(
      'notes',
      buildQuery({
        select: '*',
        order: 'created_at.desc,id.desc',
        and: `(created_at.gte.${from},created_at.lt.${to})`,
        limit: 500
      })
    ),
    { token }
  )
  return keysToCamel<Note[]>(rows)
}

export async function listDayCounts(
  token: string,
  range: { from: string; to: string }
): Promise<Record<string, number>> {
  const rows = await request<Array<{ created_at: string }>>(
    restPath(
      'notes',
      buildQuery({
        select: 'created_at',
        and: `(created_at.gte.${range.from},created_at.lt.${range.to})`,
        order: 'created_at.asc',
        limit: 1000
      })
    ),
    { token }
  )
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const key = dayKey(row.created_at)
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}
