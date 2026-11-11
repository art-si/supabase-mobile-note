import { ref } from 'vue'

function detectDark(): boolean {
  // #ifdef H5
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  // #endif
  // #ifndef H5
  return uni.getSystemInfoSync().theme === 'dark'
  // #endif
}

const isDark = ref(detectDark())
let listening = false

export function useDarkMode() {
  if (!listening) {
    listening = true
    // #ifdef H5
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      isDark.value = event.matches
    })
    // #endif
    // #ifdef MP-WEIXIN
    uni.onThemeChange?.((result: { theme: string }) => {
      isDark.value = result.theme === 'dark'
    })
    // #endif
  }
  return { isDark }
}