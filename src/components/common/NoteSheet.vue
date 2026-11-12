<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onUnmounted, ref, useSlots, watch } from 'vue'
import NoteIcon from './NoteIcon.vue'
import { projectMomentum, rubberband, spring } from '@/utils/spring'
import { getSystemInsets } from '@/utils/systemInsets'

const props = withDefaults(
  defineProps<{
    show: boolean
    title?: string
    label?: string
    zIndex?: number
  }>(),
  { title: '', label: '', zIndex: 60 }
)

const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const instance = getCurrentInstance()
const slots = useSlots()
const { bottom: safeBottom } = getSystemInsets()
const mounted = ref(false)
const scrimOn = ref(false)
const offset = ref<number | null>(null)
const dragging = ref(false)

let panelHeight = 0
let cancelSpring: (() => void) | null = null
let startY = 0
let dragOffset = 0
let lastY = 0
let lastTime = 0
let velocity = 0
let savedOverflow = ''
let mouseDown = false
let scrollLocked = false
let openSequence = 0
let lastTouchTime = 0

const panelStyle = computed(() =>
  offset.value === null ? undefined : { transform: `translate3d(0, ${offset.value}px, 0)` }
)
const dialogLabel = computed(() => props.label || props.title || '弹出面板')

function measure() {
  return new Promise<number>((resolve) => {
    uni
      .createSelectorQuery()
      .in(instance)
      .select('.note-sheet__panel')
      .boundingClientRect((rect) => {
        const height = Array.isArray(rect) ? rect[0]?.height : rect?.height
        resolve(height || 420)
      })
      .exec()
  })
}

// #ifdef H5
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') requestClose()
}
// #endif

function lockPageScroll(lock: boolean) {
  // #ifdef H5
  if (lock === scrollLocked) return
  scrollLocked = lock
  if (lock) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
  } else {
    document.body.style.overflow = savedOverflow
    window.removeEventListener('keydown', onKeydown)
  }
  // #endif
  void lock
}

async function open() {
  const sequence = ++openSequence
  cancelSpring?.()
  const wasMounted = mounted.value
  mounted.value = true
  lockPageScroll(true)
  await nextTick()
  panelHeight = await measure()
  if (sequence !== openSequence || !props.show) return
  const start = wasMounted ? offset.value ?? 0 : panelHeight
  offset.value = start
  scrimOn.value = true
  cancelSpring = spring(start, 0, {
    damping: 1,
    response: 0.4,
    onUpdate: (value) => {
      offset.value = value
    }
  })
}

function close() {
  openSequence += 1
  if (!mounted.value) return
  cancelSpring?.()
  dragging.value = false
  scrimOn.value = false
  const target = panelHeight || 420
  cancelSpring = spring(offset.value ?? 0, target, {
    damping: 1,
    response: 0.3,
    velocity: Math.max(0, velocity),
    onUpdate: (value) => {
      offset.value = value
    },
    onRest: () => {
      mounted.value = false
      offset.value = null
      velocity = 0
      lockPageScroll(false)
    }
  })
}

function requestClose() {
  emit('update:show', false)
}

watch(() => props.show, (value) => (value ? void open() : close()), { immediate: true })

onUnmounted(() => {
  openSequence += 1
  cancelSpring?.()
  if (mounted.value) lockPageScroll(false)
  // #ifdef H5
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  // #endif
})

function beginDrag(y: number) {
  cancelSpring?.()
  dragging.value = true
  startY = y
  lastY = y
  lastTime = Date.now()
  velocity = 0
  if (offset.value === null) offset.value = 0
  dragOffset = offset.value
}

function moveDrag(y: number) {
  if (!dragging.value) return
  const now = Date.now()
  const dt = Math.max(1, now - lastTime)
  velocity = ((y - lastY) / dt) * 1000
  lastY = y
  lastTime = now
  const delta = dragOffset + y - startY
  offset.value = delta >= 0 ? delta : rubberband(delta, 180)
}

function endDrag(cancelled = false) {
  if (!dragging.value) return
  dragging.value = false
  if (Date.now() - lastTime > 80) velocity = 0
  const current = offset.value ?? 0
  const projected = current + projectMomentum(velocity, 0.99)
  if (!cancelled && (projected > (panelHeight || 420) * 0.32 || velocity > 900)) {
    requestClose()
    return
  }
  cancelSpring = spring(current, 0, {
    damping: 0.9,
    response: 0.32,
    velocity,
    onUpdate: (value) => {
      offset.value = value
    }
  })
}

function onMouseDown(event: MouseEvent) {
  if (event.button !== 0 || Date.now() - lastTouchTime < 800) return
  mouseDown = true
  beginDrag(event.clientY)
  // #ifdef H5
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp, { once: true })
  // #endif
}
function onMouseMove(event: MouseEvent) {
  if (!mouseDown) return
  moveDrag(event.clientY)
}
function onMouseUp() {
  if (!mouseDown) return
  mouseDown = false
  // #ifdef H5
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  // #endif
  endDrag()
}
function onTouchStart(event: TouchEvent) {
  lastTouchTime = Date.now()
  const touch = event.touches[0]
  if (touch) beginDrag(touch.clientY)
}
function onTouchMove(event: TouchEvent) {
  const touch = event.touches[0]
  if (touch) moveDrag(touch.clientY)
}
function onTouchEnd() {
  endDrag()
}
function onTouchCancel() {
  endDrag(true)
}
</script>

<template>
  <view v-if="mounted" class="note-sheet" :style="{ zIndex }">
    <view
      class="note-sheet__scrim"
      :class="{ 'note-sheet__scrim--on': scrimOn }"
      aria-hidden="true"
      @tap="requestClose"
      @touchmove.stop.prevent
    />
    <view
      class="note-sheet__panel"
      :style="[panelStyle, { '--note-sheet-safe-bottom': `${safeBottom}px` }]"
      role="dialog"
      aria-modal="true"
      :aria-label="dialogLabel"
    >
      <view
        class="note-sheet__grip"
        aria-hidden="true"
        @mousedown="onMouseDown"
        @touchstart="onTouchStart"
        @touchmove.stop.prevent="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchCancel"
      >
        <view class="note-sheet__grip-bar" />
      </view>

      <view class="note-sheet__head">
        <text class="note-sheet__title">{{ title }}</text>
        <button class="note-sheet__close" aria-label="关闭面板" @tap="requestClose">
          <NoteIcon name="close" size="30rpx" />
        </button>
      </view>

      <scroll-view class="note-sheet__body" scroll-y :show-scrollbar="false">
        <slot />
      </scroll-view>

      <view v-if="slots.footer" class="note-sheet__footer">
        <slot name="footer" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.note-sheet {
  box-sizing: border-box;
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-right: var(--note-inset-right, env(safe-area-inset-right));
  padding-left: var(--note-inset-left, env(safe-area-inset-left));
}

.note-sheet__scrim {
  position: absolute;
  inset: 0;
  background: var(--note-scrim);
  opacity: 0;
  transition: opacity var(--note-duration-sheet) var(--note-ease-sheet);
}

.note-sheet__scrim--on {
  opacity: 1;
}

.note-sheet__panel {
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 640px;
  max-height: 86vh;
  max-height: 86dvh;
  max-height: min(86dvh, calc(100dvh - var(--note-inset-top, env(safe-area-inset-top)) - 12px));
  padding-bottom: max(var(--note-inset-bottom, env(safe-area-inset-bottom)), var(--note-sheet-safe-bottom, 0px));
  border-radius: var(--note-radius-xl) var(--note-radius-xl) 0 0;
  background: var(--note-surface);
  box-shadow: var(--note-shadow-floating);
  transform: translate3d(0, 100%, 0);
  will-change: transform;
}

.note-sheet__grip {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 44rpx;
  padding-top: 12rpx;
  touch-action: none;
  cursor: grab;
}

.note-sheet__grip-bar {
  width: 72rpx;
  height: 8rpx;
  border-radius: 4rpx;
  background: var(--note-separator-strong);
}

.note-sheet__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 8rpx 24rpx 12rpx 32rpx;
}

.note-sheet__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--note-text);
  font-size: var(--note-font-title3);
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: var(--note-track-title);
}

.note-sheet__close {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-text-2);
  background: var(--note-fill);
  transition: background-color var(--note-duration-fast) var(--note-ease);
}

.note-sheet__close::after {
  border: 0;
}

.note-sheet__close:active {
  background: var(--note-fill-2);
}

.note-sheet__body {
  flex: 1;
  min-height: 0;
  max-height: 68vh;
  max-height: 68dvh;
  overscroll-behavior: contain;
}

.note-sheet__footer {
  flex: none;
  padding: 16rpx 32rpx 24rpx;
  border-top: 1rpx solid var(--note-separator);
}

@media (prefers-reduced-motion: reduce) {
  .note-sheet__scrim {
    transition-duration: 120ms;
  }
}
</style>
