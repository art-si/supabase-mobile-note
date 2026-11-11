import { defineStore } from 'pinia'

export const THEME_PRESETS = [
  { id: 'blue', name: '晴蓝', description: '经典明快', accent: '#007aff', accentDark: '#0a84ff' },
  { id: 'indigo', name: '靛夜', description: '沉静专注', accent: '#5856d6', accentDark: '#5e5ce6' },
  { id: 'teal', name: '青波', description: '清爽平和', accent: '#30b0c7', accentDark: '#40c8e0' }
] as const

export type ThemePresetId = (typeof THEME_PRESETS)[number]['id']

const STORAGE_KEY = 'note-theme'

function isThemePresetId(value: unknown): value is ThemePresetId {
  return THEME_PRESETS.some((preset) => preset.id === value)
}

function savedPreset(): ThemePresetId {
  try {
    const value: unknown = uni.getStorageSync(STORAGE_KEY)
    return isThemePresetId(value) ? value : 'blue'
  } catch {
    return 'blue'
  }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({ preset: savedPreset() }),
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
    }
  }
})