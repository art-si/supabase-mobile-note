<script setup lang="ts">
import NoteIcon from './NoteIcon.vue'

withDefaults(defineProps<{ label: string; removable?: boolean }>(), { removable: false })
const emit = defineEmits<{ remove: [] }>()
</script>

<template>
  <view class="note-tag" :class="{ 'note-tag--removable': removable }">
    <view class="note-tag__content">
      <text class="note-tag__hash" aria-hidden="true">#</text>
      <text class="note-tag__label">{{ label }}</text>
    </view>
    <button v-if="removable" class="note-tag__remove" :aria-label="`移除标签 ${label}`" @tap="emit('remove')">
      <NoteIcon name="close" size="24rpx" />
    </button>
  </view>
</template>

<style scoped lang="scss">
.note-tag {
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  max-width: 100%;
  min-width: 0;
  min-height: 28px;
  padding: 4px 10px;
  border: 1rpx solid rgba(var(--note-accent-rgb), 0.12);
  border-radius: 12px;
  color: var(--note-accent);
  background: var(--note-accent-soft);
  font-size: var(--note-font-footnote);
  line-height: 1.3;
}
.note-tag--removable {
  min-height: 44px;
  padding: 0 0 0 12px;
  font-size: var(--note-font-subhead);
}
.note-tag__content {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}
.note-tag__hash { opacity: 0.7; }
.note-tag__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-tag__remove {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0 12px 12px 0;
  background: transparent;
  color: var(--note-accent);
  transition: background-color var(--note-duration-fast) var(--note-ease);
}
.note-tag__remove::after { border: 0; }
.note-tag__remove:active { background: var(--note-fill); }
</style>
