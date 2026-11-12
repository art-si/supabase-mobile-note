export type StorageMode = 'local' | 'cloud'

export const STORAGE_MODE_KEY = 'note-storage-mode'

export function getStorageMode(): StorageMode {
  return uni.getStorageSync(STORAGE_MODE_KEY) === 'cloud' ? 'cloud' : 'local'
}

export function isLocalStorageMode() {
  return getStorageMode() === 'local'
}

export function persistStorageMode(mode: StorageMode) {
  uni.setStorageSync(STORAGE_MODE_KEY, mode)
}
