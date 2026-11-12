<script setup lang="ts">
import NoteIcon from './NoteIcon.vue'
import { getSystemInsets } from '@/utils/systemInsets'

withDefaults(
  defineProps<{
    title?: string
    back?: boolean
  }>(),
  {
    title: '',
    back: false
  }
)
const { top: statusInset } = getSystemInsets()

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.reLaunch({ url: '/pages/timeline/index' })
}
</script>

<template>
  <view class="note-navbar" :style="{ '--note-status-inset': `${statusInset}px` }">
    <view class="note-navbar__side">
      <button v-if="back" class="note-navbar__back" aria-label="返回上一页" hover-class="note-navbar__back--pressed" @tap="goBack">
        <NoteIcon name="back" size="40rpx" />
      </button>
      <slot v-else name="left" />
    </view>
    <view class="note-navbar__title"><slot name="title">{{ title }}</slot></view>
    <view class="note-navbar__side note-navbar__side--right">
      <slot name="right" />
    </view>
  </view>
</template>

<style scoped lang="scss">
.note-navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: minmax(44px, auto) minmax(0, 1fr) minmax(44px, auto);
  align-items: center;
  gap: 8rpx;
  height: var(--note-nav-height);
  padding: var(--note-inset-top) calc(8px + var(--note-inset-right)) 0 calc(8px + var(--note-inset-left));
  background: var(--note-material);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1rpx solid var(--note-separator);
}

.note-navbar__side {
  display: flex;
  align-items: center;
  min-width: 88rpx;
  min-height: 44px;
}

.note-navbar__side--right {
  justify-content: flex-end;
}

.note-navbar__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  color: var(--note-text);
  font-size: var(--note-font-subhead);
  font-weight: 600;
}

.note-navbar__back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88rpx;
  height: 88rpx;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-accent);
  background: transparent;
  transition: background-color var(--note-duration-fast) var(--note-ease);
}

.note-navbar__back--pressed,
.note-navbar__back:active {
  background: var(--note-fill);
}
</style>
