<script setup lang="ts">
import { watch } from 'vue'
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { useStorageModeStore } from '@/stores/storageMode'
import { useDarkMode } from '@/composables/useDarkMode'
// #ifdef H5
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
// #endif

let startupPromise: Promise<void> | null = null

const { isDark } = useDarkMode()

// #ifdef H5
// 手动外观与系统不一致时，页面外的 overscroll 区域也要跟着换色。
watch(
  isDark,
  (dark) => {
    const root = document.documentElement
    root.classList.toggle('note-appearance-dark', dark)
    root.classList.toggle('note-appearance-light', !dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
    if (Capacitor.getPlatform() === 'android') {
      void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
        .catch((error) => console.warn('system bar appearance update failed', error))
    }
  },
  { immediate: true }
)
// #endif

function ensureSession() {
  if (startupPromise) return startupPromise

  startupPromise = (async () => {
    const storage = useStorageModeStore()
    const initialization = storage.initialize()
    if (storage.mode === 'cloud') await initialization
    const auth = useAuthStore()
    if (await auth.ensureValidSession() && storage.mode === 'cloud')
      await auth.requireCloudAccess()
  })()
    .catch((error) => {
      console.warn('startup session check failed', error)
    })
    .finally(() => {
      startupPromise = null
    })

  return startupPromise
}

onLaunch(() => {
  // #ifdef H5
  if (Capacitor.getPlatform() === 'android') {
    void NativeApp.addListener('backButton', () => {
      if (document.querySelector('.note-sheet__scrim--on')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      } else if (getCurrentPages().length > 1) {
        uni.navigateBack()
      } else {
        void NativeApp.minimizeApp()
      }
    })
  }
  // #endif
  void ensureSession()
})

onShow(() => {
  void ensureSession()
})
</script>

<style lang="scss">
@use './styles/global.scss';

page {
  min-height: 100%;
  background: var(--note-bg);
  color: var(--note-text);
  font-family: var(--note-font-family);
  font-weight: 400;
  font-synthesis: none;
  font-variant-numeric: tabular-nums;
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* #ifndef H5 */
page {
  overflow-x: hidden;
}
/* #endif */

/* #ifdef H5 */
/* H5 必须让 window 保持唯一滚动容器：overflow-x:hidden 会把 body 变成滚动盒，
   连带失效 onPageScroll、onReachBottom、pageScrollTo 和 sticky 日期头。 */
html,
body {
  min-width: 320px;
  margin: 0;
  background: var(--note-bg);
}

html.note-appearance-dark,
html.note-appearance-dark body,
html.note-appearance-dark page {
  --note-bg: #000000;
  background: #000000;
}

html.note-appearance-light,
html.note-appearance-light body,
html.note-appearance-light page {
  --note-bg: #f2f2f7;
  background: #f2f2f7;
}

@supports (font: -apple-system-body) {
  html {
    font: -apple-system-body;
  }
}

@media (pointer: fine) {
  html {
    overscroll-behavior: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .note-material,
  .note-material--thick,
  .tl-nav,
  .tl-day__head,
  .note-tabbar,
  .note-navbar,
  .editor-toolbar {
    background: var(--note-surface) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}

@media (prefers-contrast: more) {
  .note-card,
  .note-tabbar,
  .tl-card {
    border: 1rpx solid var(--note-separator-strong);
  }
}
/* #endif */

view,
text,
button,
input,
textarea {
  box-sizing: border-box;
}

button::after {
  border: 0;
}

button,
[role='button'] {
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

button,
input,
textarea {
  font-family: inherit;
}

button {
  line-height: 1.2;
}

button:focus-visible,
[role='button']:focus-visible {
  outline: 4rpx solid rgba(var(--note-accent-rgb), 0.4);
  outline-offset: 4rpx;
}

input,
textarea {
  caret-color: var(--note-accent);
}
</style>
