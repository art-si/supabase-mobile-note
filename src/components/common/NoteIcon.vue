<script setup lang="ts">
import { computed } from 'vue'
import { iconGlyphs, type NoteIconName } from './icon-glyphs'

const props = withDefaults(
  defineProps<{
    name: NoteIconName
    size?: string | number
    color?: string
  }>(),
  {
    size: 36,
    color: ''
  }
)

const iconSize = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <view
    class="note-icon"
    :style="{ width: iconSize, height: iconSize, fontSize: iconSize, color: props.color || 'inherit' }"
    aria-hidden="true"
  >
    <text class="note-icon__glyph">{{ iconGlyphs[props.name] }}</text>
  </view>
</template>

<style scoped lang="scss">
.note-icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.note-icon__glyph {
  font-family: 'Note Icons' !important;
  font-size: inherit;
  font-style: normal;
  font-weight: 400 !important;
  font-synthesis: none;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
}
</style>