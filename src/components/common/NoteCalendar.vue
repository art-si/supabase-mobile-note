<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import NoteIcon from './NoteIcon.vue'
import { useNotesStore } from '@/stores/notes'
import { WEEKDAY_SHORT, dayKey, formatDayKey, parseDayKey, todayKey } from '@/utils/format'

const props = defineProps<{
  show: boolean
  selectedDay: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  select: [day: string]
  clear: []
}>()

const store = useNotesStore()
const today = todayKey()
const initial = props.selectedDay ? parseDayKey(props.selectedDay) : new Date()
const viewYear = ref(initial.getFullYear())
const viewMonth = ref(initial.getMonth())
const counts = ref<Record<string, number>>({})

watch(
  () => props.show,
  async (open) => {
    if (!open) return
    const base = props.selectedDay ? parseDayKey(props.selectedDay) : new Date()
    viewYear.value = base.getFullYear()
    viewMonth.value = base.getMonth()
    counts.value = await store.loadMonthDays(viewYear.value, viewMonth.value)
  }
)

async function shiftMonth(delta: number) {
  const date = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = date.getFullYear()
  viewMonth.value = date.getMonth()
  counts.value = await store.loadMonthDays(viewYear.value, viewMonth.value)
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

const selectedCount = computed(() => (props.selectedDay ? store.dayNotes.length : 0))

function pick(cell: CalendarCell) {
  emit('select', cell.key)
  emit('update:show', false)
}

function pickToday() {
  emit('select', today)
  emit('update:show', false)
}

function clear() {
  emit('clear')
  emit('update:show', false)
}
</script>

<template>
  <wd-popup
    :model-value="show"
    position="bottom"
    round
    safe-area-inset-bottom
    :z-index="100"
    custom-class="note-calendar-popup"
    @update:model-value="emit('update:show', $event)"
  >
    <view class="cal">
      <view class="cal__grabber" aria-hidden="true" />
      <view class="cal__head">
        <button class="cal__nav" aria-label="上一个月" @tap="shiftMonth(-1)">
          <NoteIcon name="back" size="36rpx" />
        </button>
        <text class="cal__title">{{ viewYear }}年{{ viewMonth + 1 }}月</text>
        <button class="cal__nav" aria-label="下一个月" @tap="shiftMonth(1)">
          <NoteIcon name="chevron-right" size="36rpx" />
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
          :aria-label="`${formatDayKey(cell.key)}，${cell.count} 条记录`"
          :aria-pressed="cell.key === selectedDay"
          @tap="pick(cell)"
        >
          <view class="cal__bubble">
            <text class="cal__num">{{ cell.day }}</text>
            <view v-if="cell.count" class="cal__dot" />
          </view>
        </button>
      </view>

      <view class="cal__foot">
        <text class="cal__summary">
          {{ selectedDay ? `${formatDayKey(selectedDay)} · ${selectedCount} 条记录` : '点击日期，查看当天的记录' }}
        </text>
        <view class="cal__actions">
          <button class="note-btn note-btn--secondary cal__btn" @tap="pickToday">回到今天</button>
          <button class="note-btn note-btn--plain cal__btn" @tap="clear">查看全部</button>
        </view>
      </view>
    </view>
  </wd-popup>
</template>

<style scoped lang="scss">
.cal {
  padding: 16rpx 24rpx 24rpx;
  background: var(--note-surface);
}

.cal__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 0 auto 16rpx;
  border-radius: 4rpx;
  background: var(--note-separator-strong);
}

.cal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8rpx;
}

.cal__title {
  color: var(--note-text);
  font-size: var(--note-font-title3);
  font-weight: 700;
}

.cal__nav {
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
}

.cal__nav:active {
  background: var(--note-fill);
}

.cal__week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-top: 16rpx;
}

.cal__weekday {
  text-align: center;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  font-weight: 600;
}

.cal__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-top: 8rpx;
  transition: opacity var(--note-duration) var(--note-ease);
}

.cal__grid--loading {
  opacity: 0.5;
}

.cal__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 92rpx;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.cal__bubble {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76rpx;
  height: 76rpx;
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
}

.cal__cell--out .cal__num {
  color: var(--note-text-3);
}

.cal__cell--today .cal__bubble {
  box-shadow: inset 0 0 0 2rpx var(--note-accent);
}

.cal__cell--today .cal__num {
  color: var(--note-accent);
  font-weight: 700;
}

.cal__cell--selected .cal__bubble,
.cal__cell--selected:active .cal__bubble {
  background: var(--note-accent);
}

.cal__cell--selected .cal__num {
  color: var(--note-accent-contrast);
  font-weight: 700;
}

.cal__dot {
  position: absolute;
  bottom: 8rpx;
  left: 50%;
  transform: translateX(-50%);
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: var(--note-accent);
}

.cal__cell--selected .cal__dot {
  background: var(--note-accent-contrast);
}

.cal__foot {
  margin-top: 16rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid var(--note-separator);
}

.cal__summary {
  display: block;
  text-align: center;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
}

.cal__actions {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.cal__btn {
  flex: 1;
  padding: 0 16rpx;
}
</style>

<style lang="scss">
.note-calendar-popup {
  background: var(--note-surface);
}
</style>