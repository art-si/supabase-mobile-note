<script setup lang="ts">
import { computed, ref } from 'vue'
import NoteIcon from './NoteIcon.vue'
import { EMOJI_CATEGORIES, loadRecentEmojis, pushRecentEmoji } from '@/utils/emoji'

const emit = defineEmits<{
  pick: [emoji: string]
  close: []
}>()

const recent = ref<string[]>(loadRecentEmojis())
const active = ref(recent.value.length ? 'recent' : EMOJI_CATEGORIES[0]!.id)

const visibleEmojis = computed(() => {
  if (active.value === 'recent') return recent.value
  return EMOJI_CATEGORIES.find((category) => category.id === active.value)?.emojis ?? []
})

function onPick(emoji: string) {
  recent.value = pushRecentEmoji(emoji)
  emit('pick', emoji)
}
</script>

<template>
  <view class="emoji-panel">
    <view class="emoji-panel__head">
      <scroll-view scroll-x class="emoji-panel__tabs" :show-scrollbar="false">
        <view class="emoji-panel__tabs-row">
          <button
            v-if="recent.length"
            class="emoji-tab"
            :class="{ 'emoji-tab--active': active === 'recent' }"
            @mousedown.prevent
            @tap="active = 'recent'"
          >
            最近
          </button>
          <button
            v-for="category in EMOJI_CATEGORIES"
            :key="category.id"
            class="emoji-tab"
            :class="{ 'emoji-tab--active': active === category.id }"
            @mousedown.prevent
            @tap="active = category.id"
          >
            {{ category.name }}
          </button>
        </view>
      </scroll-view>
      <button class="emoji-panel__close" aria-label="收起表情面板" @mousedown.prevent @tap="emit('close')">
        <NoteIcon name="close" size="32rpx" />
      </button>
    </view>
    <scroll-view scroll-y class="emoji-panel__body">
      <view class="emoji-panel__grid">
        <button
          v-for="emoji in visibleEmojis"
          :key="emoji"
          class="emoji-cell"
          :aria-label="`插入表情 ${emoji}`"
          @mousedown.prevent
          @tap="onPick(emoji)"
        >
          <text class="emoji-cell__glyph">{{ emoji }}</text>
        </button>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped lang="scss">
.emoji-panel {
  overflow: hidden;
  border-radius: var(--note-radius-lg) var(--note-radius-lg) 0 0;
  background: var(--note-surface);
  box-shadow: var(--note-shadow-floating);
}

.emoji-panel__head {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 12rpx 12rpx 8rpx 16rpx;
  border-bottom: 1rpx solid var(--note-separator);
}

.emoji-panel__tabs {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.emoji-panel__tabs-row {
  display: inline-flex;
  gap: 8rpx;
}

.emoji-tab {
  height: 60rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 24rpx;
  border: 0;
  border-radius: 999rpx;
  background: transparent;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}

.emoji-tab--active {
  color: var(--note-accent);
  background: var(--note-accent-soft);
}

.emoji-panel__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60rpx;
  height: 60rpx;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-text-2);
  background: transparent;
}

.emoji-panel__body {
  height: 480rpx;
}

.emoji-panel__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 12rpx 8rpx calc(12rpx + env(safe-area-inset-bottom));
}

.emoji-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--note-radius-sm);
  background: transparent;
}

.emoji-cell:active {
  background: var(--note-fill);
}

.emoji-cell__glyph {
  font-size: 52rpx;
  line-height: 1;
}
</style>