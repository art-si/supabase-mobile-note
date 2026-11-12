<script setup lang="ts">
import NoteIcon from './NoteIcon.vue'

withDefaults(
  defineProps<{
    show: boolean
    message: string
    token?: number
    duration?: number
  }>(),
  { token: 0, duration: 5000 }
)

const emit = defineEmits<{ undo: [] }>()
</script>

<template>
  <view class="undo-bar" :class="{ 'undo-bar--on': show }" :aria-hidden="!show" role="status" aria-live="polite" aria-atomic="true">
    <NoteIcon name="trash" size="32rpx" class="undo-bar__icon" />
    <text class="undo-bar__text">{{ message }}</text>
    <button class="undo-bar__action" :tabindex="show ? 0 : -1" @tap="emit('undo')">撤销</button>
    <view
      v-if="show"
      :key="token"
      class="undo-bar__timer"
      :style="{ animationDuration: `${duration}ms` }"
      aria-hidden="true"
    />
  </view>
</template>

<style scoped lang="scss">
.undo-bar {
  position: fixed;
  left: 24rpx;
  right: 24rpx;
  bottom: calc(var(--note-tabbar-height) + 20rpx);
  z-index: 29;
  display: flex;
  align-items: center;
  gap: 16rpx;
  max-width: 640px;
  margin: 0 auto;
  padding: 0 12rpx 0 28rpx;
  height: 96rpx;
  overflow: hidden;
  border: 1rpx solid var(--note-separator);
  border-radius: 999rpx;
  background: var(--note-material-thick);
  backdrop-filter: blur(var(--note-blur-thick)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--note-blur-thick)) saturate(180%);
  box-shadow: var(--note-shadow-floating);
  opacity: 0;
  visibility: hidden;
  transform: translate3d(0, 24rpx, 0) scale(0.96);
  transition:
    opacity var(--note-duration) var(--note-ease),
    transform var(--note-duration) var(--note-ease),
    visibility 0s linear var(--note-duration);
}

.undo-bar--on {
  opacity: 1;
  visibility: visible;
  transform: translate3d(0, 0, 0) scale(1);
  transition:
    opacity var(--note-duration) var(--note-ease),
    transform var(--note-duration) var(--note-ease),
    visibility 0s;
}

.undo-bar__icon {
  flex: none;
  color: var(--note-text-2);
}

.undo-bar__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--note-text);
  font-size: var(--note-font-footnote);
  font-weight: 500;
}

.undo-bar__action {
  flex: none;
  height: 72rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 28rpx;
  border: 0;
  border-radius: 999rpx;
  color: var(--note-accent);
  background: var(--note-accent-soft);
  font-size: var(--note-font-subhead);
  font-weight: 700;
  transition: transform var(--note-duration-fast) var(--note-ease);
}

.undo-bar__action::after {
  border: 0;
}

.undo-bar__action:active {
  transform: scale(0.94);
}

.undo-bar__timer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4rpx;
  background: var(--note-accent);
  transform-origin: left center;
  animation: undo-drain linear forwards;
}

@keyframes undo-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .undo-bar {
    transform: none;
  }
}
</style>