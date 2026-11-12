<script setup lang="ts">
import NoteIcon from './NoteIcon.vue'
import type { NoteIconName } from './icon-glyphs'

withDefaults(
  defineProps<{
    icon: NoteIconName
    title: string
    description?: string
    actionText?: string
  }>(),
  {
    description: '',
    actionText: ''
  }
)

const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <view class="note-empty">
    <view class="note-empty__badge">
      <NoteIcon :name="icon" size="56rpx" />
    </view>
    <text class="note-empty__title">{{ title }}</text>
    <text v-if="description" class="note-empty__desc">{{ description }}</text>
    <button v-if="actionText" class="note-btn note-btn--secondary note-empty__action" @tap="emit('action')">
      {{ actionText }}
    </button>
  </view>
</template>

<style scoped lang="scss">
.note-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: min(96rpx, 8vh) 40rpx;
  text-align: center;
}

.note-empty__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  color: var(--note-text-3);
  background: var(--note-fill);
}

.note-empty__title {
  margin-top: 32rpx;
  color: var(--note-text);
  max-width: 100%;
  font-size: var(--note-font-body);
  font-weight: 600;
  line-height: 1.4;
  text-wrap: balance;
}

.note-empty__desc {
  margin-top: 12rpx;
  max-width: 480rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  line-height: 1.5;
  text-wrap: balance;
}

.note-empty__action {
  margin-top: 40rpx;
  max-width: 100%;
}

@media (max-height: 600px) and (orientation: landscape) {
  .note-empty {
    padding-block: 32rpx;
  }

  .note-empty__badge {
    width: 96rpx;
    height: 96rpx;
  }

  .note-empty__title {
    margin-top: 20rpx;
  }

  .note-empty__action {
    margin-top: 24rpx;
  }
}
</style>
