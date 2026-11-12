export interface SessionUser {
  id: string
  email?: string
  phone?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

export interface Session {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  token_type?: string
  user: SessionUser
}

export type NoteMood = 'calm' | 'happy' | 'focused' | 'tired' | 'inspired' | 'memorial'

export interface Note {
  id: string
  userId: string
  content: string
  contentText?: string
  mood: NoteMood
  images: string[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface NoteDraft {
  content: string
  mood: NoteMood
  images: string[]
  tags: string[]
}
