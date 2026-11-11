import type { NoteMood } from '@/api/types'
import type { NoteIconName } from '@/components/common/icon-glyphs'

export interface MoodInfo {
  id: NoteMood
  name: string
  icon: NoteIconName
  color: string
  soft: string
}

export const MOODS: MoodInfo[] = [
  { id: 'calm', name: '平静', icon: 'mood-calm', color: 'var(--note-mood-calm)', soft: 'var(--note-mood-calm-soft)' },
  { id: 'happy', name: '愉悦', icon: 'mood-happy', color: 'var(--note-mood-happy)', soft: 'var(--note-mood-happy-soft)' },
  { id: 'focused', name: '专注', icon: 'mood-focused', color: 'var(--note-mood-focused)', soft: 'var(--note-mood-focused-soft)' },
  { id: 'tired', name: '疲惫', icon: 'mood-tired', color: 'var(--note-mood-tired)', soft: 'var(--note-mood-tired-soft)' },
  { id: 'inspired', name: '灵感', icon: 'mood-inspired', color: 'var(--note-mood-inspired)', soft: 'var(--note-mood-inspired-soft)' },
  { id: 'memorial', name: '纪念', icon: 'mood-memorial', color: 'var(--note-mood-memorial)', soft: 'var(--note-mood-memorial-soft)' }
]

export function moodInfo(id: NoteMood): MoodInfo {
  return MOODS.find((mood) => mood.id === id) ?? MOODS[0]!
}