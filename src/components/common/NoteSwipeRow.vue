<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import NoteIcon from './NoteIcon.vue'
import { projectMomentum, rubberband, spring } from '@/utils/spring'

const props = defineProps<{
  rowKey: string
  activeKey: string
  label?: string
  pressLabel?: string
}>()

const emit = defineEmits<{
  open: [key: string]
  press: []
  remove: []
}>()

const ACTION_WIDTH = 88
const FULL_SWIPE_RATIO = 0.62
const LOCK_THRESHOLD = 10
const VELOCITY_WINDOW = 100

const offset = ref(0)
const dragging = ref(false)
const isOpen = computed(() => props.activeKey === props.rowKey)

let cancelSpring: (() => void) | null = null
let startX = 0
let startY = 0
let velocity = 0
let baseOffset = 0
let axis: 'none' | 'x' | 'y' = 'none'
let suppressClick = false
let mouseDown = false
let lastTouchTime = 0
let lastSampleTime = 0
let rowWidth = 375
let samples: Array<{ x: number; time: number }> = []

const trackStyle = computed(() => ({
  transform: `translate3d(${offset.value}px, 0, 0)`,
  transition: dragging.value ? 'none' : undefined
}))

const actionStyle = computed(() => {
  const revealed = Math.min(1, Math.max(0, -offset.value / ACTION_WIDTH))
  return { opacity: String(revealed), transform: `scale(${0.86 + revealed * 0.14})` }
})

function settle(target: number, initialVelocity: number) {
  cancelSpring?.()
  cancelSpring = spring(offset.value, target, {
    damping: 0.9,
    response: 0.32,
    velocity: initialVelocity,
    onUpdate: (value) => {
      offset.value = value
    }
  })
}

function close() {
  if (offset.value === 0) return
  settle(0, 0)
}

function begin(x: number, y: number) {
  startX = x
  startY = y
  velocity = 0
  axis = 'none'
  samples = []
  suppressClick = false
}

function trackVelocity(x: number, time: number) {
  samples.push({ x, time })
  samples = samples.filter((sample) => time - sample.time <= VELOCITY_WINDOW)
  const first = samples[0]
  if (!first || time === first.time) return
  velocity = ((x - first.x) / (time - first.time)) * 1000
  lastSampleTime = time
}

function move(x: number, y: number) {
  const dx = x - startX
  const dy = y - startY
  if (axis === 'none') {
    if (Math.abs(dx) < LOCK_THRESHOLD && Math.abs(dy) < LOCK_THRESHOLD) return
    if (Math.abs(dx) <= Math.abs(dy)) {
      axis = 'y'
      return
    }
    axis = 'x'
    cancelSpring?.()
    // 从屏幕上的当前位置接管，动画被打断时不会跳回逻辑目标值。
    baseOffset = offset.value - dx
    dragging.value = true
    suppressClick = true
    emit('open', props.rowKey)
  }
  if (axis !== 'x') return

  trackVelocity(x, Date.now())
  const raw = baseOffset + dx
  if (raw > 0) {
    offset.value = rubberband(raw, rowWidth)
  } else if (raw < -ACTION_WIDTH) {
    offset.value = -ACTION_WIDTH - rubberband(-ACTION_WIDTH - raw, rowWidth)
  } else {
    offset.value = raw
  }
}

function end(cancelled = false) {
  if (axis !== 'x') {
    axis = 'none'
    return
  }
  axis = 'none'
  dragging.value = false
  // 手指停下后再抬起不应沿用最后一次移动的旧速度。
  const releaseVelocity = Date.now() - lastSampleTime > 80 ? 0 : velocity
  const projected = offset.value + projectMomentum(releaseVelocity, 0.99)
  if (!cancelled && projected < -rowWidth * FULL_SWIPE_RATIO) {
    settle(-rowWidth, releaseVelocity)
    emit('remove')
    return
  }
  if (projected < -ACTION_WIDTH * 0.5) {
    settle(-ACTION_WIDTH, releaseVelocity)
    emit('open', props.rowKey)
    return
  }
  settle(0, releaseVelocity)
  if (isOpen.value) emit('open', '')
}

function onPress() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (isOpen.value && Math.abs(offset.value) > 1) {
    emit('open', '')
    return
  }
  emit('press')
}

function onRemove() {
  emit('remove')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onPress()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    emit('open', props.rowKey)
    settle(-ACTION_WIDTH, 0)
  } else if (event.key === 'ArrowRight' || event.key === 'Escape') {
    event.preventDefault()
    emit('open', '')
    close()
  }
}

// #ifdef H5
function removeMouseListeners() {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}
// #endif

function onMouseDown(event: MouseEvent) {
  if ((typeof event.button === 'number' && event.button !== 0) || Date.now() - lastTouchTime < 800) return
  mouseDown = true
  rowWidth = uni.getSystemInfoSync().windowWidth || rowWidth
  begin(event.clientX, event.clientY)
  // #ifdef H5
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp, { once: true })
  // #endif
}
function onMouseMove(event: MouseEvent) {
  if (!mouseDown) return
  move(event.clientX, event.clientY)
}
function onMouseUp() {
  if (!mouseDown) return
  mouseDown = false
  // #ifdef H5
  removeMouseListeners()
  // #endif
  end()
}
function onTouchStart(event: TouchEvent) {
  lastTouchTime = Date.now()
  const touch = event.touches[0]
  if (!touch) return
  rowWidth = uni.getSystemInfoSync().windowWidth || rowWidth
  begin(touch.clientX, touch.clientY)
}
function onTouchMove(event: TouchEvent) {
  const touch = event.touches[0]
  if (touch) move(touch.clientX, touch.clientY)
}
function onTouchEnd() {
  end()
}
function onTouchCancel() {
  end(true)
}

watch(
  () => props.activeKey,
  (key) => {
    if (key !== props.rowKey && !dragging.value) close()
  }
)

onUnmounted(() => {
  cancelSpring?.()
  // #ifdef H5
  removeMouseListeners()
  // #endif
})

defineExpose({ close })
</script>

<template>
  <view class="swipe" :class="{ 'swipe--dragging': dragging }">
    <view class="swipe__action" :style="actionStyle" :aria-hidden="!isOpen && !dragging">
      <button
        class="swipe__delete"
        :tabindex="isOpen ? 0 : -1"
        :aria-label="label || '删除这条笔记'"
        @tap.stop="onRemove"
      >
        <NoteIcon name="trash" size="36rpx" />
        <text class="swipe__delete-text">删除</text>
      </button>
    </view>
    <view
      class="swipe__track"
      :style="trackStyle"
      role="button"
      tabindex="0"
      :aria-label="pressLabel || '打开这条笔记'"
      @mousedown="onMouseDown"
      @keydown="onKeydown"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchCancel"
      @tap="onPress"
    >
      <slot />
    </view>
  </view>
</template>

<style scoped lang="scss">
.swipe {
  position: relative;
  overflow: hidden;
  border-radius: 28rpx;
}

.swipe__action {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  width: 88px;
  transform-origin: right center;
}

.swipe__delete {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--note-radius-md);
  color: #ffffff;
  background: var(--note-danger);
  font-size: var(--note-font-caption);
  font-weight: 600;
}

.swipe__delete::after {
  border: 0;
}

.swipe__delete-text {
  letter-spacing: var(--note-track-caption);
}

.swipe__track {
  position: relative;
  border-radius: var(--note-radius-md);
  touch-action: pan-y;
  will-change: transform;
}

.swipe--dragging {
  cursor: grabbing;
  user-select: none;
  -webkit-user-select: none;
}

@media (hover: hover) and (pointer: fine) {
  .swipe__delete:hover {
    filter: brightness(0.94);
  }
}
</style>
