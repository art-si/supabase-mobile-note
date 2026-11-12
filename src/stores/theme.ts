import { defineStore } from 'pinia'

export const THEME_PRESETS = [
  { id: 'blue', name: '晴蓝', description: '经典明快', accent: '#007aff', accentDark: '#0a84ff' },
  { id: 'indigo', name: '靛夜', description: '沉静专注', accent: '#5856d6', accentDark: '#5e5ce6' },
  { id: 'teal', name: '青波', description: '清爽平和', accent: '#30b0c7', accentDark: '#40c8e0' }
] as const

export type ThemePresetId = (typeof THEME_PRESETS)[number]['id']

export const APPEARANCE_OPTIONS = [
  { id: 'auto', name: '自动' },
  { id: 'light', name: '浅色' },
  { id: 'dark', name: '深色' }
] as const

export type AppearanceMode = (typeof APPEARANCE_OPTIONS)[number]['id']

const STORAGE_KEY = 'note-theme'
const APPEARANCE_KEY = 'note-appearance'

function isThemePresetId(value: unknown): value is ThemePresetId {
  return THEME_PRESETS.some((preset) => preset.id === value)
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return APPEARANCE_OPTIONS.some((option) => option.id === value)
}

function savedPreset(): ThemePresetId {
  try {
    const value: unknown = uni.getStorageSync(STORAGE_KEY)
    return isThemePresetId(value) ? value : 'blue'
  } catch {
    return 'blue'
  }
}

function savedAppearance(): AppearanceMode {
  try {
    const value: unknown = uni.getStorageSync(APPEARANCE_KEY)
    return isAppearanceMode(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({ preset: savedPreset(), appearance: savedAppearance() }),
  getters: {
    currentPreset: (state) => THEME_PRESETS.find((preset) => preset.id === state.preset) || THEME_PRESETS[0]
  },
  actions: {
    selectPreset(preset: ThemePresetId): boolean {
      if (this.preset === preset) return true
      this.preset = preset
      try {
        uni.setStorageSync(STORAGE_KEY, preset)
        return true
      } catch {
        return false
      }
    },
    selectAppearance(mode: AppearanceMode): boolean {
      if (this.appearance === mode) return true
      this.appearance = mode
      try {
        uni.setStorageSync(APPEARANCE_KEY, mode)
        return true
      } catch {
        return false
      }
    }
  }
})