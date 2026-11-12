<script setup lang="ts">
import NoteIcon from './NoteIcon.vue'
import NoteSheet from './NoteSheet.vue'
import type { NoteIconName } from './icon-glyphs'

withDefaults(defineProps<{
  show: boolean
  title: string
  description?: string
  cancelText?: string
  items: Array<{ value: string; label: string; icon: NoteIconName; danger?: boolean }>
}>(), { description: '', cancelText: '取消' })

const emit = defineEmits<{
  'update:show': [value: boolean]
  select: [value: string]
}>()

function select(value: string) {
  emit('update:show', false)
  emit('select', value)
}
</script>

<template>
  <NoteSheet :show="show" :title="title" @update:show="emit('update:show', $event)">
    <view class="note-action-sheet">
      <text v-if="description" class="note-action-sheet__description">{{ description }}</text>
      <button
        v-for="item in items"
        :key="item.value"
        class="note-action-sheet__row"
        :class="{ 'note-action-sheet__row--danger': item.danger }"
        @tap="select(item.value)"
      >
        <view class="note-action-sheet__icon"><NoteIcon :name="item.icon" size="36rpx" /></view>
        <text class="note-action-sheet__label">{{ item.label }}</text>
        <NoteIcon name="chevron-right" size="28rpx" />
      </button>
    </view>
    <template #footer>
      <button class="note-btn note-btn--secondary note-action-sheet__cancel" @tap="emit('update:show', false)">
        {{ cancelText }}
      </button>
    </template>
  </NoteSheet>
</template>

<style scoped lang="scss">
.note-action-sheet {
  display: grid;
  gap: 10rpx;
  padding: 8rpx 32rpx 20rpx;
}

.note-action-sheet__description {
  padding: 0 0 12rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  line-height: 1.5;
}

.note-action-sheet__row {
  display: flex;
  align-items: center;
  gap: 18rpx;
  width: 100%;
  min-height: 60px;
  margin: 0;
  padding: 0 18rpx;
  border: 1rpx solid var(--note-separator);
  border-radius: var(--note-radius-md);
  color: var(--note-text);
  background: var(--note-surface-2);
  text-align: left;
  transition: background-color var(--note-duration-fast) var(--note-ease);
}

.note-action-sheet__row::after,
.note-action-sheet__cancel::after {
  border: 0;
}

.note-action-sheet__row:active {
  background: var(--note-fill);
}

.note-action-sheet__row > :last-child {
  flex: none;
  color: var(--note-text-3);
}

.note-action-sheet__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--note-radius-sm);
  color: var(--note-accent);
  background: var(--note-accent-soft);
}

.note-action-sheet__label {
  flex: 1;
  min-width: 0;
  font-size: var(--note-font-body);
  font-weight: 600;
  line-height: 1.3;
}

.note-action-sheet__row--danger {
  color: var(--note-danger);
  background: var(--note-danger-soft);
  border-color: var(--note-danger-soft);
}

.note-action-sheet__row--danger .note-action-sheet__icon,
.note-action-sheet__row--danger > :last-child {
  color: var(--note-danger);
}

.note-action-sheet__row--danger .note-action-sheet__icon {
  background: var(--note-danger-soft);
}

.note-action-sheet__cancel {
  width: 100%;
}
</style>
