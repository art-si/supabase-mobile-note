import { computed } from 'vue'
import { requestNoteAssistant } from '@/api/noteAssistant'
import { useAuthStore } from '@/stores/auth'
import { useStorageModeStore } from '@/stores/storageMode'
import { getStorageMode } from '@/utils/storageMode'

export function useNoteAssistant() {
  const auth = useAuthStore()
  const storage = useStorageModeStore()
  const available = computed(() => storage.mode === 'cloud' && auth.isLoggedIn && auth.cloudAccessGranted)

  async function cloudToken() {
    if (!available.value || getStorageMode() !== 'cloud') throw new Error('请在已授权的云端模式使用 AI')
    const user = auth.user?.id
    if (!await auth.ensureValidSession()) throw new Error('登录已过期，请重新登录')
    await auth.requireCloudAccess()
    if (!available.value || getStorageMode() !== 'cloud' || auth.user?.id !== user) {
      throw new Error('登录状态已变化，请重新打开')
    }
    return auth.token
  }

  async function run(input: Parameters<typeof requestNoteAssistant>[1]) {
    return requestNoteAssistant(await cloudToken(), input)
  }

  return { available, run, cloudToken }
}
