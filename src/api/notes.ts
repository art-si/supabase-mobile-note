import { buildQuery, keysToCamel, request, restPath } from './supabase'
import type { Note, NoteDraft } from './types'
import { dayKey, dayRange } from '@/utils/format'

const PAGE_SIZE = 20

export interface NoteListResult {
  notes: Note[]
  hasMore: boolean
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
    body: { content: draft.content, mood: draft.mood, images: draft.images, tags: draft.tags },
    headers: { Prefer: 'return=representation' }
  })
  const note = keysToCamel<Note[]>(rows)[0]
  if (!note) throw new Error('保存失败，请稍后重试')
  return note
}

export async function updateNote(token: string, id: string, draft: NoteDraft): Promise<Note> {
  const rows = await request<unknown[]>(restPath('notes', buildQuery({ id: `eq.${id}` })), {
    method: 'PATCH',
    token,
    body: { content: draft.content, mood: draft.mood, images: draft.images, tags: draft.tags },
    headers: { Prefer: 'return=representation' }
  })
  const note = keysToCamel<Note[]>(rows)[0]
  if (!note) throw new Error('保存失败，请稍后重试')
  return note
}

export async function deleteNote(token: string, id: string): Promise<void> {
  await request(restPath('notes', buildQuery({ id: `eq.${id}` })), {
    method: 'DELETE',
    token
  })
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
