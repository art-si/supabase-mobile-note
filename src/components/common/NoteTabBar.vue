<script setup lang="ts">
import NoteIcon from './NoteIcon.vue'
import type { NoteIconName } from './icon-glyphs'
import { useNotesStore } from '@/stores/notes'
import { haptic } from '@/utils/haptic'
import { getSystemInsets } from '@/utils/systemInsets'

type TabKey = 'timeline' | 'mine'

const props = defineProps<{ active: TabKey }>()
const { bottom: safeBottom } = getSystemInsets()

const items: Array<{ key: TabKey; label: string; icon: NoteIconName; url: string }> = [
  { key: 'timeline', label: '时间轴', icon: 'timeline', url: '/pages/timeline/index' },
  { key: 'mine', label: '设置', icon: 'settings', url: '/pages/mine/index' }
]

function go(key: TabKey) {
  if (key === props.active) return
  const item = items.find((entry) => entry.key === key)
  if (!item) return
  haptic('light')
  uni.reLaunch({ url: item.url })
}

function compose() {
  haptic('light')
  const day = useNotesStore().selectedDay
  uni.navigateTo({ url: `/pages/editor/index${day ? `?day=${day}` : ''}` })
}
</script>

<template>
  <view class="note-tabbar note-material--thick" :style="{ '--note-safe-bottom': `${safeBottom}px` }" role="navigation" aria-label="主导航">
    <button
      class="note-tabbar__item"
      :class="{ 'note-tabbar__item--active': active === 'timeline' }"
      :aria-current="active === 'timeline' ? 'page' : undefined"
      :aria-label="items[0]!.label"
      @tap="go('timeline')"
    >
      <NoteIcon :name="items[0]!.icon" size="44rpx" />
      <text class="note-tabbar__label">{{ items[0]!.label }}</text>
    </button>

    <button class="note-tabbar__compose" aria-label="写一条新笔记" @tap="compose">
      <NoteIcon name="add" size="44rpx" />
    </button>

    <button
      class="note-tabbar__item"
      :class="{ 'note-tabbar__item--active': active === 'mine' }"
      :aria-current="active === 'mine' ? 'page' : undefined"
      :aria-label="items[1]!.label"
      @tap="go('mine')"
    >
      <NoteIcon :name="items[1]!.icon" size="44rpx" />
      <text class="note-tabbar__label">{{ items[1]!.label }}</text>
    </button>
  </view>
</template>

<style scoped lang="scss">
.note-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: calc(var(--note-tabbar-height) + var(--note-inset-bottom));
  padding: 0 calc(12px + var(--note-inset-right)) var(--note-inset-bottom) calc(12px + var(--note-inset-left));
  border-top: 1rpx solid var(--note-separator);
  box-shadow: none;
}

.note-tabbar__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  height: 52px;
  min-height: 48px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--note-radius-md);
  background: transparent;
  color: var(--note-text-2);
  transition:
    color var(--note-duration-fast) var(--note-ease),
    transform var(--note-duration-fast) var(--note-ease);
}

.note-tabbar__item:active {
  transform: scale(0.94);
}

.note-tabbar__item--active {
  color: var(--note-accent);
}

.note-tabbar__item::after,
.note-tabbar__compose::after {
  border: 0;
}

.note-tabbar__label {
  font-size: var(--note-font-min);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: var(--note-track-caption);
}

.note-tabbar__compose {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  margin: 0 24rpx;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-accent-contrast);
  background: var(--note-accent-finish);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .23), var(--note-shadow-accent);
  transition: transform var(--note-duration-fast) var(--note-ease);
}

.note-tabbar__compose:active {
  transform: scale(0.96);
}
</style>
