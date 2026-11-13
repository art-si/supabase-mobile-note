<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import type { AssistantEntry, AssistantSource, AssistantSummary, AssistantSearch } from '@/api/noteAssistant'
import { useNoteAssistant } from '@/composables/useNoteAssistant'
import { formatDateTime, formatDayKey, formatTime } from '@/utils/format'
import NoteSheet from './NoteSheet.vue'
import NoteIcon from './NoteIcon.vue'

const props = withDefaults(defineProps<{
  show: boolean
  action: 'split' | 'summary' | 'search'
  day: string
  seed?: string
  defaultTime?: string
  saving?: boolean
  saveError?: string
}>(), { seed: '', defaultTime: '', saving: false, saveError: '' })
const emit = defineEmits<{
  'update:show': [boolean]
  save: [AssistantEntry[]]
  source: [string]
}>()
const { run } = useNoteAssistant()
const input = ref('')
const entries = ref<AssistantEntry[] | null>(null)
const summary = ref<AssistantSummary | null>(null)
const search = ref<AssistantSearch | null>(null)
const busy = ref(false)
const error = ref('')
let sequence = 0
const title = computed(() => ({ split: 'AI 整理', summary: '当天小结', search: '智能搜索' })[props.action])
const ready = computed(() => props.action === 'summary' || Boolean(input.value.trim()))
const saveable = computed(() => entries.value?.length && entries.value.every(entry => entry.text.trim()))

watch(() => [props.show, props.action, props.day], () => {
  sequence++
  input.value = props.seed
  entries.value = null
  summary.value = null
  search.value = null
  error.value = ''
  busy.value = false
}, { immediate: true })

async function generate() {
  if (!ready.value || busy.value || props.saving) return
  const current = ++sequence
  busy.value = true
  error.value = ''
  try {
    if (props.action === 'split') {
      const data = await run({ action: 'split', day: props.day, text: input.value }) as { entries?: AssistantEntry[] }
      if (current === sequence) {
        if (!Array.isArray(data?.entries) || !data.entries.length) throw new Error('没有可整理的内容')
        entries.value = data.entries
      }
    } else if (props.action === 'summary') {
      const data = await run({ action: 'summary', day: props.day }) as AssistantSummary
      if (current === sequence) {
        if (!Array.isArray(data?.highlights)) throw new Error('未能生成小结，请重试')
        summary.value = data
      }
    } else {
      const data = await run({ action: 'search', text: input.value }) as AssistantSearch
      if (current === sequence) {
        if (!Array.isArray(data?.rows)) throw new Error('搜索未完成，请重试')
        search.value = data
      }
    }
  } catch (cause) {
    if (current === sequence) error.value = getUserFacingErrorMessage(cause, '暂时无法完成，请重试')
  } finally {
    if (current === sequence) busy.value = false
  }
}

function close(show: boolean) {
  if (!props.saving) emit('update:show', show)
}

function chooseDate(entry: AssistantEntry, event: { detail: { value: string } }) {
  entry.day = event.detail.value
}

function chooseTime(entry: AssistantEntry, event: { detail: { value: string } }) {
  entry.time = event.detail.value
}

function sourceLabel(row: AssistantSource) {
  return (props.action === 'summary' ? formatTime(row.createdAt) : formatDateTime(row.createdAt))
    + ' · ' + (row.contentText?.trim() || '查看原记录')
}
</script>

<template>
  <NoteSheet :show="show" :title="title" @update:show="close">
    <view class="note-ai" :aria-busy="busy || saving">
      <template v-if="entries">
        <text class="note-ai__muted">请核对文字和时间，再保存为独立笔记。</text>
        <view v-for="(entry, index) in entries" :key="entry.id" class="note-ai__entry">
          <view class="note-ai__tools">
            <picker mode="date" :value="entry.day" @change="chooseDate(entry, $event)">
              <button class="note-ai__link" :disabled="saving" :aria-label="`修改第 ${index + 1} 条的日期`">{{ entry.day }}</button>
            </picker>
            <picker mode="time" :value="entry.time || defaultTime" @change="chooseTime(entry, $event)">
              <button class="note-ai__link" :disabled="saving" :aria-label="`修改第 ${index + 1} 条的时间`">{{ entry.time || defaultTime }}</button>
            </picker>
            <button v-if="entries.length > 1" class="note-ai__link note-ai__remove" :disabled="saving" :aria-label="`移除第 ${index + 1} 条`" @tap="entries.splice(index, 1)">
              <NoteIcon name="close" size="30rpx" />
            </button>
          </view>
          <textarea v-model="entry.text" class="note-ai__input" auto-height :disabled="saving" :maxlength="1000" :aria-label="`第 ${index + 1} 条笔记`" />
        </view>
      </template>
      <template v-else-if="summary">
        <text class="note-ai__muted">{{ formatDayKey(day) }} · {{ summary.truncated ? '最近 ' : '' }}{{ summary.count }} 条记录</text>
        <text v-if="!summary.highlights.length" class="note-ai__empty">{{ summary.count ? '这一天没有可整理的文字内容。' : '这一天还没有云端记录。' }}</text>
        <view v-for="(item, index) in summary.highlights" :key="index" class="note-ai__entry">
          <text class="note-ai__highlight">{{ item.text }}</text>
          <button v-for="row in item.sources" :key="row.id" class="note-ai__source" @tap="emit('source', row.id)">{{ sourceLabel(row) }}</button>
        </view>
      </template>
      <template v-else>
        <template v-if="action === 'summary'">
          <text class="note-ai__muted">{{ formatDayKey(day) }} · 仅将当天的云端文字和标签交给 AI 整理，不发送图片。</text>
        </template>
        <template v-else>
          <text class="note-ai__label">{{ action === 'split' ? '要整理的文字' : '你想找什么？' }}</text>
          <textarea v-model="input" class="note-ai__input note-ai__input--query" auto-height
            :disabled="busy" :maxlength="action === 'split' ? 5000 : 160"
            :aria-label="action === 'split' ? '要整理的文字' : '搜索问题'"
            :placeholder="action === 'split' ? '例如：7点喝奶，9点吃辅食…' : '例如：上周哪天吃了山药粥…'"
            @input="search = null" />
          <text class="note-ai__muted">{{ action === 'split' ? '仅发送这段文字给 AI，确认后才会保存。' : 'AI 只解析问题；匹配的笔记直接从云端查找。' }}</text>
        </template>
        <template v-if="search">
          <text v-if="!search.rows.length" class="note-ai__empty">没有匹配记录，试试缩短关键词或换个日期。</text>
          <text v-if="search.truncated" class="note-ai__muted">显示最新 30 条，缩小日期范围可找到更早的记录。</text>
          <button v-for="row in search.rows" :key="row.id" class="note-ai__source" @tap="emit('source', row.id)">{{ sourceLabel(row) }}</button>
        </template>
      </template>
      <text v-if="busy" class="note-ai__muted" role="status">{{ action === 'search' ? '正在搜索…' : '正在整理…' }}</text>
      <text v-if="error || saveError" class="note-ai__error" role="alert">{{ error || saveError }}</text>
    </view>
    <template #footer>
      <view v-if="entries" class="note-ai__footer">
        <button class="note-btn note-btn--plain" :disabled="saving" @tap="entries = null">返回修改</button>
        <button class="note-btn note-btn--primary" :disabled="!saveable || saving" @tap="emit('save', entries)">{{ saving ? '保存中…' : `保存 ${entries.length} 条` }}</button>
      </view>
      <button v-else-if="!summary" class="note-btn note-btn--primary note-ai__submit" :disabled="busy || !ready" @tap="generate">
        {{ busy ? '请稍候…' : action === 'summary' ? '生成小结' : action === 'split' ? '整理文字' : '搜索' }}
      </button>
      <button v-else class="note-btn note-btn--secondary note-ai__submit" @tap="close(false)">完成</button>
    </template>
  </NoteSheet>
</template>

<style scoped lang="scss">
.note-ai { display: grid; gap: 12px; padding: 8px 16px 28px; }
.note-ai__label, .note-ai__highlight { color: var(--note-text); font-size: var(--note-font-subhead); font-weight: 600; line-height: 1.5; }
.note-ai__muted, .note-ai__error, .note-ai__empty { color: var(--note-text-2); font-size: var(--note-font-footnote); line-height: 1.5; overflow-wrap: anywhere; }
.note-ai__error { color: var(--note-danger); }
.note-ai__entry { display: grid; gap: 8px; min-width: 0; padding: 12px; border: 1px solid var(--note-separator); border-radius: var(--note-radius-md); }
.note-ai__tools, .note-ai__footer { display: flex; gap: 8px; align-items: center; }
.note-ai__footer .note-btn--primary { flex: 1; }
.note-ai__submit { width: 100%; }
.note-ai__link, .note-ai__source { display: block; min-height: 44px; padding: 8px; margin: 0; border: 0; background: transparent; color: var(--note-accent); font-size: var(--note-font-footnote); line-height: 1.45; }
.note-ai__link::after, .note-ai__source::after { border: 0; }
.note-ai__link:active, .note-ai__source:active { background: var(--note-fill); }
.note-ai__remove { margin-left: auto; min-width: 44px; }
.note-ai__source { width: 100%; text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; border-radius: var(--note-radius-sm); background: var(--note-fill-2); }
.note-ai__input { width: 100%; box-sizing: border-box; min-height: 48px; padding: 12px; border-radius: var(--note-radius-sm); background: var(--note-fill-2); color: var(--note-text); font-size: var(--note-font-subhead); line-height: 1.5; }
.note-ai__input--query { min-height: 72px; }
</style>
