import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { useDarkMode } from './useDarkMode'

export function usePageTheme() {
  const theme = useThemeStore()
  const { isDark } = useDarkMode()
  return {
    theme,
    isDark,
    themeName: computed(() => (isDark.value ? `note-${theme.preset}-dark` : `note-${theme.preset}`)),
    themeClass: computed(() => (isDark.value ? `note-theme-${theme.preset}-dark` : `note-theme-${theme.preset}`))
  }
}