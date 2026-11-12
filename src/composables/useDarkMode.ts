import { computed, ref } from 'vue'
import { useThemeStore } from '@/stores/theme'

function detectDark(): boolean {
  // #ifdef H5
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  // #endif
  // #ifndef H5
  return uni.getSystemInfoSync().theme === 'dark'
  // #endif
}

const systemDark = ref(detectDark())
let listening = false

function listenSystemAppearance() {
  if (listening) return
  listening = true
  // #ifdef H5
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    systemDark.value = event.matches
  })
  // #endif
  // #ifdef MP-WEIXIN
  uni.onThemeChange?.((result: { theme: string }) => {
    systemDark.value = result.theme === 'dark'
  })
  // #endif
}

export function useDarkMode() {
  listenSystemAppearance()
  const theme = useThemeStore()
  const isDark = computed(() => {
    if (theme.appearance === 'auto') return systemDark.value
    return theme.appearance === 'dark'
  })
  return { isDark, systemDark }
}