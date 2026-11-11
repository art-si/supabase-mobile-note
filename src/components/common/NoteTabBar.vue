<script setup lang="ts">
import NoteIcon from './NoteIcon.vue'
import type { NoteIconName } from './icon-glyphs'

type TabKey = 'timeline' | 'mine'

const props = defineProps<{ active: TabKey }>()

const items: Array<{ key: TabKey; label: string; icon: NoteIconName; url: string }> = [
  { key: 'timeline', label: '时间轴', icon: 'timeline', url: '/pages/timeline/index' },
  { key: 'mine', label: '我的', icon: 'mine', url: '/pages/mine/index' }
]

function go(key: TabKey) {
  if (key === props.active) return
  const item = items.find((entry) => entry.key === key)
  if (item) uni.reLaunch({ url: item.url })
}
</script>

<template>
  <view class="note-tabbar" role="navigation" aria-label="主导航">
    <button
      v-for="item in items"
      :key="item.key"
      class="note-tabbar__item"
      :class="{ 'note-tabbar__item--active': item.key === active }"
      :aria-current="item.key === active ? 'page' : undefined"
      :aria-label="item.label"
      @tap="go(item.key)"
    >
      <NoteIcon :name="item.icon" size="44rpx" />
      <text class="note-tabbar__label">{{ item.label }}</text>
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
  display: flex;
  height: var(--note-tabbar-height);
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--note-material);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1rpx solid var(--note-separator);
}

.note-tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 0 0;
  border: 0;
  background: transparent;
  color: var(--note-text-2);
  transition: color var(--note-duration-fast) var(--note-ease);
}

.note-tabbar__item--active {
  color: var(--note-accent);
}

.note-tabbar__label {
  font-size: var(--note-font-min);
  font-weight: 500;
  line-height: 1.2;
}
</style>