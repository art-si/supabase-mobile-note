export interface EditorTextDraft {
  html: string
  tags: string[]
  createdAt: string
  originalUpdatedAt: string
}

export function readEditorDraft(key: string): EditorTextDraft | null {
  try {
    const saved: unknown = uni.getStorageSync(key)
    const value: unknown = typeof saved === 'string' ? JSON.parse(saved) : saved
    if (!value || typeof value !== 'object') return null
    const draft = value as Partial<EditorTextDraft>
    if (typeof draft.html !== 'string' || draft.html.length > 100_000 ||
      typeof draft.createdAt !== 'string' || !Number.isFinite(Date.parse(draft.createdAt)) ||
      typeof draft.originalUpdatedAt !== 'string' || !Array.isArray(draft.tags) ||
      draft.tags.length > 8 || draft.tags.some(tag => typeof tag !== 'string' || tag.length > 20)) return null
    return draft as EditorTextDraft
  } catch (error) {
    console.warn('[editor] unable to read draft', error)
    return null
  }
}

export function saveEditorDraft(key: string, draft: EditorTextDraft) {
  uni.setStorageSync(key, JSON.stringify(draft))
}

export function clearEditorDraft(key: string) {
  uni.removeStorageSync(key)
}
