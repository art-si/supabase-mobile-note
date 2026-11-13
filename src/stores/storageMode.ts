import { defineStore } from 'pinia'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { fetchCloudStorageAccess } from '@/api/storageConfig'
import { getStorageMode, persistStorageMode, type StorageMode } from '@/utils/storageMode'

let initializationPromise: Promise<void> | null = null

export const useStorageModeStore = defineStore('storageMode', {
  state: () => ({
    mode: getStorageMode() as StorageMode,
    cloudAvailable: false,
    configError: '',
    initialized: false,
    loading: false
  }),
  actions: {
    hydrate() {
      this.mode = getStorageMode()
    },
    async initialize(retry = false) {
      if (this.initialized && !retry) return
      if (initializationPromise) {
        await initializationPromise
        return
      }

      this.loading = true
      this.configError = ''
      initializationPromise = (async () => {
        try {
          this.cloudAvailable = (await fetchCloudStorageAccess()) === 'login'
        } catch (error) {
          this.cloudAvailable = false
          this.configError = getUserFacingErrorMessage(error, '暂时无法获取云端配置，请重试')
          console.warn('storage config unavailable', error)
        } finally {
          this.hydrate()
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
