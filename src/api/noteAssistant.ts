import { keysToCamel, request } from './supabase'

export interface AssistantEntry {
  id: string
  text: string
  day: string
  time: string | null
}

export interface AssistantSource {
  id: string
  createdAt: string
  contentText: string | null
}

export interface AssistantSummary {
  count: number
  truncated: boolean
  highlights: Array<{ text: string; sources: AssistantSource[] }>
}

export interface AssistantSearch {
  rows: AssistantSource[]
  truncated: boolean
}

type AssistantRequest =
  | { action: 'split'; text: string; day: string }
  | { action: 'summary'; day: string }
  | { action: 'search'; text: string }

export async function requestNoteAssistant(token: string, input: AssistantRequest) {
  let timezone = ''
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* use device offset */ }
  const data = await request<unknown>('/functions/v1/note-assistant', {
    token,
    method: 'POST',
    timeoutMs: 65_000,
    body: { ...input, timezone, offset: new Date().getTimezoneOffset() }
  })
  return keysToCamel<unknown>(data)
}
