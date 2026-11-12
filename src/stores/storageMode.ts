import { defineStore } from 'pinia'
import { fetchCloudStorageAvailability } from '@/api/storageConfig'
import { getStorageMode, persistStorageMode, type StorageMode } from '@/utils/storageMode'

let initializationPromise: Promise<void> | null = null

export const useStorageModeStore = defineStore('storageMode', {
  state: () => ({
    mode: getStorageMode() as StorageMode,
    cloudAvailable: false,
    initialized: false,
    loading: false
  }),
  actions: {
    hydrate() {
      this.mode = getStorageMode() === 'cloud' && this.cloudAvailable ? 'cloud' : 'local'
    },
    async initialize() {
      if (this.initialized) return
      if (initializationPromise) {
        await initializationPromise
        return
      }

      this.loading = true
      initializationPromise = (async () => {
        try {
          this.cloudAvailable = await fetchCloudStorageAvailability()
        } catch (error) {
          this.cloudAvailable = false
          console.warn('storage config unavailable; using local storage', error)
        } finally {
          this.hydrate()
          if (!this.cloudAvailable && getStorageMode() === 'cloud') {
            persistStorageMode('local')
            this.mode = 'local'
          }
          this.initialized = true
          this.loading = false
          initializationPromise = null
        }
      })()
      await initializationPromise
    },
    setMode(mode: StorageMode) {
      if (mode === 'cloud' && !this.cloudAvailable) return false
      persistStorageMode(mode)
      this.mode = mode
      return true
    }
  }
})
