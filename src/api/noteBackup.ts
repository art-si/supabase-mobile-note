import { listCloudBackupPage } from './notes'
import { saveLocalBackup, getAllLocalNotes } from './localNotes'
import { downloadLocalNoteImage, removeLocalNoteImages } from './localNoteImages'
import { signNoteImages } from './noteImages'
import type { Note } from './types'

const PAGE_SIZE = 40
const IMPORT_RECEIPTS = 'note-imported-local-notes'
export interface BackupProgress { copied: number; updated: number; existing: number; image: number; images: number }

function importedIds(user: string) {
  const stored: unknown = uni.getStorageSync(IMPORT_RECEIPTS)
  try {
    const parsed: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, user)) {
      const receipts = (parsed as Record<string, unknown>)[user]
      if (receipts && typeof receipts === 'object' && !Array.isArray(receipts)) {
        return new Map(Object.entries(receipts).flatMap(([id, receipt]) =>
          receipt && typeof receipt === 'object' && 'cloudId' in receipt && typeof receipt.cloudId === 'string'
            ? [[receipt.cloudId, id] as const] : []))
      }
    }
  } catch (error) {
    console.warn('[notes] backup could not read import receipts', error)
  }
  return new Map<string, string>()
}

function fingerprint(note: Note) {
  return JSON.stringify([Date.parse(note.createdAt), note.content, note.mood, [...note.tags].sort(), note.images.length])
}

/** Copies snapshots. Local edits, local-only records and cloud data are never overwritten. */
export async function backupCloudNotes(
  user: string, tokenForPage: () => Promise<string>, assertActive: () => void,
  onProgress: (progress: BackupProgress) => void
): Promise<BackupProgress> {
  const existing = getAllLocalNotes()
  const local = new Map(existing.map(note => [note.id, note]))
  const receipts = importedIds(user)
  const linkedIds = new Set(receipts.values())
  const byContent = new Map<string, string[]>()
  for (const row of existing) {
    if (row.id.startsWith('cloud-backup-') || linkedIds.has(row.id) || row.images.length) continue
    const key = fingerprint(row)
    const ids = byContent.get(key) ?? []
    ids.push(row.id)
    byContent.set(key, ids)
  }
  const progress: BackupProgress = { copied: 0, updated: 0, existing: 0, image: 0, images: 0 }
  const report = () => onProgress({ ...progress })
  let cursor = ''
  for (;;) {
    const token = await tokenForPage()
    assertActive()
    const page = await listCloudBackupPage(token, user, cursor, PAGE_SIZE)
    assertActive()
    for (const note of page) {
      const id = `cloud-backup-${user}-${note.id}`
      const previous = local.get(id)
      const linked = receipts.get(note.id)
      const linkedNote = linked ? local.get(linked) : undefined
      const key = fingerprint(note)
      const same = !previous && (linkedNote && fingerprint(linkedNote) === key
        ? linked : note.images.length ? undefined : byContent.get(key)?.pop())
      if (same || (previous && (previous.backupSourceUpdatedAt !== previous.updatedAt || Date.parse(previous.updatedAt) >= Date.parse(note.updatedAt)))) {
        progress.existing++
        report()
        continue
      }
      const paths: string[] = []
      progress.images = note.images.length
      progress.image = 0
      try {
        const urls = await signNoteImages(token, note.images)
        for (const path of note.images) {
          assertActive()
          progress.image++
          report()
          const url = urls[path]
          if (!url) throw new Error('有图片无法从云端读取，请重试')
          paths.push(await downloadLocalNoteImage(url))
        }
        assertActive()
        const saved = { ...note, id, images: paths }
        if (saveLocalBackup(saved, previous)) {
          if (previous) {
            progress.updated++
            await removeLocalNoteImages(previous.images).catch(() => {})
          } else progress.copied++
          local.set(id, saved)
        } else {
          progress.existing++
          await removeLocalNoteImages(paths).catch(() => {})
        }
      } catch (error) {
        await removeLocalNoteImages(paths).catch(() => {})
        throw error
      }
      progress.images = progress.image = 0
      report()
    }
    if (page.length < PAGE_SIZE) return progress
    const next = page[page.length - 1]?.id
    if (!next || next === cursor) throw new Error('云端记录未能完整读取，请重试')
    cursor = next
  }
}
