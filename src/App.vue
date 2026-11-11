<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'

let startupPromise: Promise<void> | null = null

function ensureSession() {
  if (startupPromise) return startupPromise

  startupPromise = (async () => {
    await useAuthStore().ensureValidSession()
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
  overflow-x: hidden;
  font-family: var(--note-font-family);
  font-weight: 400;
  font-synthesis: none;
  font-variant-numeric: tabular-nums;
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* #ifdef H5 */
html,
body {
  min-width: 320px;
  margin: 0;
  overflow-x: hidden;
  background: var(--note-bg);
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
  .tl-header,
  .note-tabbar,
  .tl-day__head {
    background: var(--note-surface) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}

@media (prefers-contrast: more) {
  .note-card,
  .note-tabbar {
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