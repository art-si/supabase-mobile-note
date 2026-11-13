<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import NoteIcon from './NoteIcon.vue'
import NoteSheet from './NoteSheet.vue'
import { useNotesStore } from '@/stores/notes'
import { WEEKDAY_SHORT, dayKey, formatDayKey, parseDayKey, todayKey } from '@/utils/format'
import { haptic } from '@/utils/haptic'

const props = defineProps<{
  show: boolean
  selectedDay: string
  selectedTime?: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  select: [day: string]
  time: [value: string]
  confirm: []
}>()

const store = useNotesStore()
const today = todayKey()
const initial = props.selectedDay ? parseDayKey(props.selectedDay) : new Date()
const viewYear = ref(initial.getFullYear())
const viewMonth = ref(initial.getMonth())
const counts = ref<Record<string, number>>({})

async function loadCounts() {
  counts.value = await store.loadMonthDays(viewYear.value, viewMonth.value)
}

watch(
  () => props.show,
  (open) => {
    if (!open) return
    const base = props.selectedDay ? parseDayKey(props.selectedDay) : new Date()
    viewYear.value = base.getFullYear()
    viewMonth.value = base.getMonth()
    if (props.selectedTime === undefined) void loadCounts()
  }
)

async function shiftMonth(delta: number) {
  const date = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = date.getFullYear()
  viewMonth.value = date.getMonth()
  counts.value = {}
  if (props.selectedTime === undefined) await loadCounts()
}

interface CalendarCell {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  count: number
}

const cells = computed<CalendarCell[]>(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1)
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate()
  const total = Math.ceil((first.getDay() + daysInMonth) / 7) * 7
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  const list: CalendarCell[] = []
  for (let index = 0; index < total; index++) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = dayKey(date.toISOString())
    list.push({
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === viewMonth.value,
      isToday: key === today,
      count: counts.value[key] || 0
    })
  }
  return list
})

const monthTotal = computed(() =>
  cells.value.filter((cell) => cell.inMonth).reduce((sum, cell) => sum + cell.count, 0)
)
const monthActiveDays = computed(() => cells.value.filter((cell) => cell.inMonth && cell.count > 0).length)
const selectedCount = computed(() => (props.selectedDay ? store.dayNotes.length : 0))
const summary = computed(() => {
  if (props.selectedDay) return `${formatDayKey(props.selectedDay)} · ${selectedCount.value} 条记录`
  return `本月 ${monthTotal.value} 条记录，分布在 ${monthActiveDays.value} 天`
})

function pick(cell: CalendarCell) {
  haptic('light')
  emit('select', cell.key)
  if (props.selectedTime === undefined) emit('update:show', false)
}

function pickToday() {
  haptic('light')
  emit('select', today)
  if (props.selectedTime === undefined) emit('update:show', false)
}

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))
const timeIndices = computed(() => (props.selectedTime ?? '00:00').split(':').map(Number))
function changeTime(event: { detail: { value: number[] } }) {
  const [hour, minute] = event.detail.value
  emit('time', hours[hour ?? 0] + ':' + minutes[minute ?? 0])
}
</script>

<template>
  <NoteSheet
    :show="show"
    :title="selectedTime === undefined ? '选择日期' : '记录时间'"
    :label="selectedTime === undefined ? '选择要查看的日期' : '选择笔记日期和时间'"
    @update:show="emit('update:show', $event)"
  >
    <view class="cal">
      <view class="cal__head">
        <button class="cal__nav" aria-label="上一个月" @tap="shiftMonth(-1)">
          <NoteIcon name="back" size="34rpx" />
        </button>
        <view class="cal__title-group">
          <text class="cal__title">{{ viewYear }}年{{ viewMonth + 1 }}月</text>
          <text v-if="selectedTime === undefined" class="cal__subtitle">{{ monthTotal }} 条记录</text>
        </view>
        <button class="cal__nav" aria-label="下一个月" @tap="shiftMonth(1)">
          <NoteIcon name="chevron-right" size="34rpx" />
        </button>
      </view>

      <view class="cal__week" aria-hidden="true">
        <text v-for="weekday in WEEKDAY_SHORT" :key="weekday" class="cal__weekday">{{ weekday }}</text>
      </view>

      <view class="cal__grid" :class="{ 'cal__grid--loading': store.monthLoading }">
        <button
          v-for="cell in cells"
          :key="cell.key"
          class="cal__cell"
          :class="{
            'cal__cell--out': !cell.inMonth,
            'cal__cell--today': cell.isToday,
            'cal__cell--selected': cell.key === selectedDay
          }"
          :aria-label="selectedTime === undefined ? `${formatDayKey(cell.key)}，${cell.count} 条记录` : formatDayKey(cell.key)"
          :aria-pressed="cell.key === selectedDay"
          @tap="pick(cell)"
        >
          <view class="cal__bubble">
            <text class="cal__num">{{ cell.day }}</text>
          </view>
          <view v-if="selectedTime === undefined" class="cal__dot" :class="{ 'cal__dot--on': cell.count > 0 }" aria-hidden="true" />
        </button>
      </view>

      <text v-if="selectedTime === undefined" class="cal__summary" role="status">{{ summary }}</text>
    </view>

    <view v-if="selectedTime !== undefined" class="cal__time">
      <text class="cal__time-label">时间 · {{ selectedTime }}</text>
      <picker-view class="cal__time-picker" :value="timeIndices" indicator-style="height: 44px" aria-label="选择小时和分钟" @change="changeTime">
        <picker-view-column><view v-for="hour in hours" :key="hour" class="cal__time-option">{{ hour }} 时</view></picker-view-column>
        <picker-view-column><view v-for="minute in minutes" :key="minute" class="cal__time-option">{{ minute }} 分</view></picker-view-column>
      </picker-view>
    </view>
    <template #footer>
      <view class="cal__actions">
        <button class="note-btn note-btn--secondary cal__btn" @tap="pickToday">回到今天</button>
        <button v-if="selectedTime !== undefined" class="note-btn note-btn--primary cal__btn" @tap="emit('confirm'); emit('update:show', false)">完成</button>
      </view>
    </template>
  </NoteSheet>
</template>

<style scoped lang="scss">
.cal__time {
  border-top: 1rpx solid var(--note-separator);
  margin: 0 24rpx;
  padding-top: 12rpx;
}
.cal__time-label {
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
}
.cal__time-picker {
  height: 132px;
  width: 100%;
}
.cal__time-option {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  color: var(--note-text);
  font-size: var(--note-font-body);
  font-variant-numeric: tabular-nums;
}
.cal {
  padding: 0 24rpx 20rpx;
}

.cal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4rpx 12rpx;
}

.cal__title-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rpx;
}

.cal__title {
  color: var(--note-text);
  font-size: var(--note-font-title3);
  font-weight: 700;
  letter-spacing: var(--note-track-title);
}

.cal__subtitle {
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  font-variant-numeric: tabular-nums;
}

.cal__nav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80rpx;
  height: 80rpx;
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

.cal__nav:active {
  background: var(--note-fill);
}

.cal__week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 14rpx 0 10rpx;
  border-top: 1rpx solid var(--note-separator);
}

.cal__weekday {
  text-align: center;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  font-weight: 600;
  letter-spacing: var(--note-track-caption);
}

.cal__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  transition: opacity var(--note-duration) var(--note-ease);
}

.cal__grid--loading {
  opacity: 0.45;
}

.cal__cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  height: 104rpx;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.cal__cell::after,
.cal__nav::after {
  border: 0;
}

.cal__bubble {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  transition: background-color var(--note-duration-fast) var(--note-ease);
}

.cal__cell:active .cal__bubble {
  background: var(--note-fill);
}

.cal__num {
  color: var(--note-text);
  font-size: var(--note-font-subhead);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.cal__cell--out .cal__num {
  color: var(--note-text-3);
}

.cal__cell--today .cal__bubble {
  box-shadow: inset 0 0 0 2rpx rgba(var(--note-accent-rgb), 0.45);
}

.cal__cell--today .cal__num {
  color: var(--note-accent);
  font-weight: 700;
}

.cal__cell--selected .cal__bubble,
.cal__cell--selected:active .cal__bubble {
  background: var(--note-accent);
  box-shadow: none;
}

.cal__cell--selected .cal__num {
  color: var(--note-accent-contrast);
  font-weight: 700;
}

.cal__dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: transparent;
}

.cal__dot--on {
  background: var(--note-accent);
}

.cal__summary {
  display: block;
  margin-top: 16rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid var(--note-separator);
  text-align: center;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  line-height: 1.5;
}

.cal__actions {
  display: flex;
  gap: 16rpx;
}

.cal__btn {
  flex: 1;
  padding: 0 16rpx;
}
</style>
