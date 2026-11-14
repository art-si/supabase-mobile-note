<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onBackPress, onLoad, onPageScroll, onPullDownRefresh, onReachBottom, onResize, onShow, onUnload } from '@dcloudio/uni-app'
import NoteCalendar from '@/components/common/NoteCalendar.vue'
import NoteEmpty from '@/components/common/NoteEmpty.vue'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteTag from '@/components/common/NoteTag.vue'
import NoteWeather from '@/components/common/NoteWeather.vue'
import NoteTabBar from '@/components/common/NoteTabBar.vue'
import NoteAssistant from '@/components/common/NoteAssistant.vue'
import { useNoteAssistant } from '@/composables/useNoteAssistant'
import { usePageTheme } from '@/composables/usePageTheme'
import { CLOUD_ACCESS_DENIED, useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import { useStorageModeStore } from '@/stores/storageMode'
import { useWeatherStore } from '@/stores/weather'
import type { Note } from '@/api/types'
import { WEEKDAY_SHORT, dayKey, formatDayKey, formatTime, monthKey, parseDayKey, todayKey } from '@/utils/format'
import { haptic } from '@/utils/haptic'
import { renderNoteHtml } from '@/utils/richText'
import { getSystemInsets } from '@/utils/systemInsets'
import { prefersReducedMotion } from '@/utils/spring'

const { themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const store = useNotesStore()
const storage = useStorageModeStore()
const { available: aiAvailable } = useNoteAssistant()
const aiOpen = ref(false)
const aiAction = ref<'summary' | 'search'>('summary')
const weather = useWeatherStore()
const weatherShow = ref(false)
const { top: statusInset, bottom: safeBottom } = getSystemInsets()

const STRIP_DAYS = 21
const SEARCH_DEBOUNCE = 280

const booted = ref(false)
const scrolled = ref(false)
const calendarShow = ref(false)
const searchOpen = ref(false)
const searchFocus = ref(false)
const searchInput = ref('')
const dayCounts = ref<Record<string, number>>({})
const today = todayKey()
const dayBeforeSearch = ref(store.selectedDay || today)

let searchTimer: ReturnType<typeof setTimeout> | null = null

// #ifdef H5
let titleObserver: IntersectionObserver | null = null
let stripObserver: ResizeObserver | null = null

async function observeHeroTitle() {
  titleObserver?.disconnect()
  titleObserver = null
  stripObserver?.disconnect()
  stripObserver = null
  await nextTick()
  if (searchOpen.value) return
  const strip = document.querySelector('.tl-strip__scroll')
  if (strip && typeof ResizeObserver !== 'undefined') {
    stripObserver = new ResizeObserver(() => { void alignDateStrip() })
    stripObserver.observe(strip)
  }
  if (typeof IntersectionObserver === 'undefined') return
  const title = document.querySelector('.tl-hero__title')
  const nav = document.querySelector('.tl-nav')
  if (!title || !nav) return
  const navBottom = Math.ceil(nav.getBoundingClientRect().bottom)
  titleObserver = new IntersectionObserver(([entry]) => {
    if (entry) scrolled.value = entry.boundingClientRect.bottom <= navBottom
  }, { rootMargin: `-${navBottom}px 0px 0px 0px`, threshold: [0, 1] })
  titleObserver.observe(title)
}

onMounted(() => { void observeHeroTitle() })
watch(searchOpen, () => { void observeHeroTitle() })
// #endif

const selectedDate = computed(() => (store.selectedDay ? parseDayKey(store.selectedDay) : null))
const navTitle = computed(() => {
  if (store.keyword) return '搜索'
  if (selectedDate.value) return `${selectedDate.value.getMonth() + 1}月${selectedDate.value.getDate()}日`
  return '时光记事'
})
const heroTitle = computed(() => {
  if (store.keyword) return `“${store.keyword}”`
  if (selectedDate.value) return `${selectedDate.value.getMonth() + 1}月${selectedDate.value.getDate()}日`
  return '时光记事'
})
const heroEyebrow = computed(() => {
  const base = selectedDate.value ?? new Date()
  return `${base.getFullYear()}年 · 周${WEEKDAY_SHORT[base.getDay()]}`
})

const currentMonthPrefix = computed(() => {
  const now = new Date()
  return monthKey(now.getFullYear(), now.getMonth())
})
const monthTotal = computed(() =>
  Object.entries(dayCounts.value).reduce(
    (sum, [key, count]) => (key.startsWith(currentMonthPrefix.value) ? sum + count : sum),
    0
  )
)
const monthActiveDays = computed(
  () =>
    Object.entries(dayCounts.value).filter(
      ([key, count]) => key.startsWith(currentMonthPrefix.value) && count > 0
    ).length
)
const heroMeta = computed(() => {
  if (store.keyword) return `${store.activeNotes.length} 条匹配结果`
  if (store.selectedDay) return `${store.dayNotes.length} 条记录`
  return `本月 ${monthTotal.value} 条记录 · ${monthActiveDays.value} 天留下痕迹`
})

interface StripDay {
  key: string
  day: number
  weekday: string
  isToday: boolean
  isWeekend: boolean
  count: number
}

const stripDays = computed<StripDay[]>(() => {
  const now = new Date()
  const list: StripDay[] = []
  for (let offset = STRIP_DAYS - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    const key = dayKey(date.toISOString())
    list.push({
      key,
      day: date.getDate(),
      weekday: WEEKDAY_SHORT[date.getDay()] ?? '',
      isToday: offset === 0,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      count: dayCounts.value[key] || 0
    })
  }
  return list
})
const stripAnchor = ref('')

async function alignDateStrip() {
  // Uni scroll-view resets scroll-left on its first tick. Position afterwards,
  // including when reduced motion disables its animated scroll path.
  stripAnchor.value = ''
  await nextTick()
  const selected = stripDays.value.some(item => item.key === store.selectedDay) ? store.selectedDay : today
  stripAnchor.value = `strip-${selected}`
}

onMounted(() => { void alignDateStrip() })
onResize(() => { void alignDateStrip() })
watch([() => store.selectedDay, searchOpen], () => {
  if (!searchOpen.value) void alignDateStrip()
})

const showSkeleton = computed(() => store.activeLoading)
const cloudDenied = computed(() => storage.mode === 'cloud' && auth.cloudAccessDenied)
watch(cloudDenied, (denied) => {
  if (!denied) return
  store.reset()
  dayCounts.value = {}
})
const showError = computed(() => Boolean(store.activeError) && store.activeNotes.length === 0)
const showEmpty = computed(() => !store.activeLoading && !store.activeError && store.activeNotes.length === 0)
const emptyIcon = computed(() => (store.keyword ? 'search' : store.selectedDay ? 'calendar' : 'journal'))
const emptyTitle = computed(() => {
  if (store.keyword) return '没有找到相关笔记'
  if (store.selectedDay) return '这一天还没有记录'
  return '开始记录你的时间轴'
})
const emptyDesc = computed(() => {
  if (store.keyword) return '换个关键词，或清空搜索回到今天'
  if (store.selectedDay) return '点 + 记录这一天，或用日历选择其他日期'
  return '点下方的 + 写下此刻的想法，时间轴会替你收好'
})
const emptyAction = computed(() => {
  if (store.keyword) return '清空搜索'
  if (store.selectedDay) return '写一条'
  return '写第一条'
})

async function loadCounts() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (STRIP_DAYS - 1))
  const months: Array<[number, number]> = [[now.getFullYear(), now.getMonth()]]
  if (start.getFullYear() !== now.getFullYear() || start.getMonth() !== now.getMonth()) {
    months.push([start.getFullYear(), start.getMonth()])
  }
  const merged: Record<string, number> = {}
  for (const [year, month] of months) {
    Object.assign(merged, await store.loadMonthDays(year, month))
  }
  dayCounts.value = merged
}

onLoad(async () => {
  const initialization = storage.initialize()
  if (storage.mode === 'cloud') await initialization
  const valid = await auth.ensureValidSession()
  if (!valid) return
  try {
    await store.selectDay(store.selectedDay || today)
  } catch {
    // 错误态由页面展示
  }
  if (store.keyword) {
    searchInput.value = store.keyword
    searchOpen.value = true
    await store.selectDay('')
    await store.load().catch(() => {})
  }
  booted.value = true
  void loadCounts()
})

onShow(() => {
  void weather.refresh()
  if (!booted.value) return
  void refreshTimeline()
})

async function refreshTimeline() {
  try {
    await store.refreshActive()
    await loadCounts()
  } catch {
    // 错误态由页面展示，已有记录在刷新失败时继续保留。
  }
}

onUnload(() => {
  if (searchTimer) clearTimeout(searchTimer)
  // #ifdef H5
  titleObserver?.disconnect()
  stripObserver?.disconnect()
  // #endif
})

onPageScroll(({ scrollTop }) => {
  // #ifdef H5
  if (titleObserver) return
  // #endif
  const next = scrollTop > 24
  if (next !== scrolled.value) scrolled.value = next
})

onPullDownRefresh(async () => {
  try {
    await store.refreshActive()
    store.invalidateMonths()
    await loadCounts()
  } catch {
    // 错误态由页面展示
  } finally {
    uni.stopPullDownRefresh()
  }
})

onReachBottom(() => {
  if (store.selectedDay) return
  void store.loadMore().catch(() => {})
})

onBackPress(() => {
  if (aiOpen.value) { aiOpen.value = false; return true }
  if (weatherShow.value) { weatherShow.value = false; return true }
  if (calendarShow.value) {
    calendarShow.value = false
    return true
  }
  if (searchOpen.value) {
    closeSearch()
    return true
  }
  return false
})

function openSearch() {
  dayBeforeSearch.value = store.selectedDay || today
  searchOpen.value = true
  searchFocus.value = true
}

function closeSearch(restoreDay = true) {
  searchOpen.value = false
  searchFocus.value = false
  if (searchTimer) clearTimeout(searchTimer)
  searchInput.value = ''
  store.keyword = ''
  if (restoreDay) void store.selectDay(dayBeforeSearch.value).catch(() => {})
}

watch(searchInput, (value) => {
  if (!searchOpen.value) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (store.selectedDay) void store.selectDay('')
    void store.search(value).catch(() => {})
  }, SEARCH_DEBOUNCE)
})

function submitSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  if (store.selectedDay) void store.selectDay('')
  void store.search(searchInput.value).catch(() => {})
}

function clearSearchKeyword() {
  searchInput.value = ''
  searchFocus.value = true
}

function clearFilters() {
  if (searchOpen.value) { closeSearch(); return }
  void store.selectDay(today).catch(() => {})
  uni.pageScrollTo({ scrollTop: 0, duration: prefersReducedMotion() ? 0 : 300 })
}

function retry() {
  if (store.selectedDay) {
    void store.selectDay(store.selectedDay).catch(() => {})
  } else {
    void store.load().catch(() => {})
  }
}

function onSelectDay(day: string) {
  if (searchOpen.value) closeSearch(false)
  void store.selectDay(day).catch(() => {})
  uni.pageScrollTo({ scrollTop: 0, duration: prefersReducedMotion() ? 0 : 300 })
}

function onStripPick(item: StripDay) {
  haptic('light')
  onSelectDay(item.key)
}

let longPressed = false
function promptDelete(note: Note) {
  longPressed = true
  uni.showModal({
    title: '删除笔记？', content: '删除后无法恢复。', confirmText: '删除', confirmColor: '#ff3b30',
    success: async ({ confirm }) => {
      if (!confirm) return
      try {
        await store.remove(note.id)
        uni.showToast({ title: '已删除', icon: 'none' })
      } catch {
        uni.showToast({ title: '删除失败，请稍后重试', icon: 'none' })
      }
    }
  })
  setTimeout(() => { longPressed = false }, 800)
}

function openEditor(note?: Note) {
  uni.navigateTo({ url: note ? `/pages/editor/index?id=${note.id}` : `/pages/editor/index${store.selectedDay ? `?day=${store.selectedDay}` : ''}` })
}

function openAi(action: 'summary' | 'search') {
  if (!aiAvailable.value) return
  searchFocus.value = false
  uni.hideKeyboard()
  aiAction.value = action
  aiOpen.value = true
}

function openAiSource(id: string) {
  aiOpen.value = false
  uni.navigateTo({ url: `/pages/editor/index?id=${encodeURIComponent(id)}` })
}

function noteText(note: Note) {
  return (note.contentText ?? '').trim()
}

function previewNoteImage(note: Note, index: number) {
  const urls = note.images.map((path) => store.imageUrl(path)).filter(Boolean)
  const current = store.imageUrl(note.images[index] ?? '')
  if (!current || !urls.length) {
    uni.showToast({ title: '图片加载中，请稍后重试', icon: 'none' })
    return
  }
  uni.previewImage({ urls, current })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <view
      class="page tl-page"
      :class="[themeClass, { 'note-dark': isDark, 'tl-page--search': searchOpen, 'tl-page--ai-search': searchOpen && aiAvailable }]"
      :style="{ '--note-safe-bottom': `${safeBottom}px`, '--note-status-inset': `${statusInset}px` }"
    >
      <view class="tl-nav note-material--thick" :class="{ 'tl-nav--edge': scrolled || searchOpen }">
        <button v-if="!scrolled && !searchOpen" class="weather-trigger" :aria-label="`${weather.city?.name || '当前位置'}今日天气：${weather.headerLabel}${weather.fresh && weather.error ? '，缓存' : ''}，查看详情`" @tap="weatherShow = true">
          <NoteIcon :name="weather.icon" size="36rpx" />
          <text v-if="store.selectedDay !== today && weather.fresh" class="weather-trigger__meta">今日</text>
          <text class="weather-trigger__label" :class="{ 'weather-trigger__label--report': weather.fresh }">{{ weather.headerLabel }}</text>
          <text v-if="weather.fresh && weather.error" class="weather-trigger__meta">缓存</text>
        </button>
        <text v-else class="tl-nav__title">{{ navTitle }}</text>
        <view class="tl-nav__actions">
          <button
            class="tl-icon-btn"
            :class="{ 'tl-icon-btn--on': calendarShow || Boolean(store.selectedDay) }"
            aria-label="打开日历，按日期查看"
            @tap="calendarShow = true"
          >
            <NoteIcon name="calendar" size="40rpx" />
          </button>
          <button
            class="tl-icon-btn"
            :class="{ 'tl-icon-btn--on': searchOpen }"
            aria-label="搜索笔记"
            @tap="openSearch"
          >
            <NoteIcon name="search" size="40rpx" />
          </button>
          <button class="tl-icon-btn" aria-label="刷新记录" :disabled="store.activeLoading" @tap="refreshTimeline">
            <NoteIcon name="refresh" size="40rpx" />
          </button>
        </view>
      </view>

      <view v-if="searchOpen" class="tl-searchbar note-material--thick" :class="{ 'tl-searchbar--ai': aiAvailable }">
        <view class="note-field tl-searchbar__field">
          <NoteIcon name="search" size="32rpx" class="note-field__icon" />
          <input
            v-model="searchInput"
            class="note-field__input"
            :focus="searchFocus"
            placeholder="搜索笔记内容"
            aria-label="搜索笔记内容"
            placeholder-class="note-field__placeholder"
            confirm-type="search"
            @confirm="submitSearch"
          />
          <button
            v-if="searchInput"
            class="tl-searchbar__clear"
            aria-label="清空关键词"
            @tap="clearSearchKeyword"
          >
            <NoteIcon name="close" size="26rpx" />
          </button>
        </view>
        <button class="tl-searchbar__cancel" @tap="closeSearch">取消</button>
        <button v-if="aiAvailable" class="tl-ai-link tl-ai-link--search" @tap="openAi('search')">
          <NoteIcon name="sparkles" size="30rpx" /><text>智能搜索</text>
        </button>
      </view>

      <view class="tl-body">
        <view v-if="!searchOpen" class="tl-hero">
          <text class="tl-hero__eyebrow">{{ heroEyebrow }}</text>
          <text class="tl-hero__title">{{ heroTitle }}</text>
          <view class="tl-hero__detail">
            <text class="tl-hero__meta" :class="{ 'tl-hero__meta--paired': aiAvailable && store.dayNotes.length && !store.activeLoading }">{{ heroMeta }}</text>
            <button v-if="aiAvailable && store.dayNotes.length && !store.activeLoading" class="tl-ai-link" @tap="openAi('summary')">当天小结</button>
          </view>
        </view>

        <view v-if="!searchOpen" class="tl-strip">
          <scroll-view
            class="tl-strip__scroll"
            scroll-x
            :show-scrollbar="false"
            :scroll-into-view="stripAnchor"
            :scroll-with-animation="!prefersReducedMotion()"
          >
            <view class="tl-strip__track">
              <button
                v-for="item in stripDays"
                :id="`strip-${item.key}`"
                :key="item.key"
                class="tl-strip__day"
                :class="{
                  'tl-strip__day--on': store.selectedDay === item.key,
                  'tl-strip__day--today': item.isToday,
                  'tl-strip__day--weekend': item.isWeekend
                }"
                :aria-pressed="store.selectedDay === item.key"
                :aria-label="`${formatDayKey(item.key)}，${item.count} 条记录`"
                @tap="onStripPick(item)"
              >
                <text class="tl-strip__weekday">{{ item.weekday }}</text>
                <text class="tl-strip__num">{{ item.day }}</text>
                <view class="tl-strip__dot" :class="{ 'tl-strip__dot--on': item.count > 0 }" />
              </button>
            </view>
          </scroll-view>
        </view>

        <view v-if="store.keyword" class="tl-filter">
          <NoteIcon :name="store.keyword ? 'search' : 'calendar'" size="28rpx" class="tl-filter__icon" />
          <text class="tl-filter__text">
            {{ store.keyword ? `关键词「${store.keyword}」` : formatDayKey(store.selectedDay) }}
          </text>
          <button class="tl-filter__clear" aria-label="清除筛选" @tap="clearFilters">
            <NoteIcon name="close" size="24rpx" />
          </button>
        </view>

        <NoteEmpty
          v-if="cloudDenied"
          icon="warning"
          title="云端存储不可用"
          :description="CLOUD_ACCESS_DENIED"
          action-text="重新检查授权"
          @action="refreshTimeline"
        />

        <view v-else-if="showSkeleton" class="tl-skeleton" aria-label="加载中" aria-busy="true">
          <view v-for="index in 2" :key="index" class="tl-skeleton__row">
            <view class="tl-skeleton__dot" />
            <view class="tl-skeleton__card">
              <view class="tl-skeleton__line tl-skeleton__line--chip" />
              <view class="tl-skeleton__line" />
              <view class="tl-skeleton__line tl-skeleton__line--mid" />
            </view>
          </view>
        </view>

        <NoteEmpty
          v-else-if="showError"
          icon="warning"
          title="加载失败"
          :description="store.activeError"
          action-text="重试"
          @action="retry"
        />

        <NoteEmpty
          v-else-if="showEmpty"
          :icon="emptyIcon"
          :title="emptyTitle"
          :description="emptyDesc"
          :action-text="emptyAction"
          @action="store.keyword ? clearFilters() : openEditor()"
        />

        <template v-else>
          <view v-for="group in store.activeGroups" :key="group.key" class="tl-day">
            <view v-if="!store.selectedDay" class="tl-day__head note-material">
              <text class="tl-day__label">{{ group.label }}</text>
              <text class="tl-day__date">{{ formatDayKey(group.key) }}</text>
              <text class="tl-day__count">{{ group.notes.length }} 条</text>
            </view>

            <view class="tl-day__list">
              <view v-for="note in group.notes" :key="note.id" class="tl-entry">
                <view class="tl-entry__rail" aria-hidden="true">
                  <text class="tl-entry__time">{{ formatTime(note.createdAt) }}</text>
                </view>
                <view class="tl-card">
                  <button
                    class="tl-card__open"
                    :aria-label="`编辑 ${formatTime(note.createdAt)} 的笔记：${noteText(note).slice(0, 80) || '图片笔记'}`"
                    @longpress="promptDelete(note)"
                    @tap="!longPressed && openEditor(note)"
                    @keydown.enter.prevent="openEditor(note)"
                    @keydown.space.prevent="openEditor(note)"
                  >
                    <rich-text
                      v-if="noteText(note)"
                      class="tl-card__rich"
                      :nodes="renderNoteHtml(note.content)"
                    />
                    <text v-else class="tl-card__photo-label">图片笔记</text>
                    <view v-if="note.tags?.length" class="tl-card__tags">
                      <NoteTag v-for="tag in note.tags" :key="tag" :label="tag" />
                    </view>
                  </button>

                  <view
                    v-if="note.images.length"
                    class="tl-media"
                    :class="{ 'tl-media--single': note.images.length === 1 }"
                  >
                    <button
                      v-for="(path, imageIndex) in note.images"
                      :key="path"
                      class="tl-media__item"
                      :aria-label="`查看第 ${imageIndex + 1} 张图片`"
                      @tap.stop="previewNoteImage(note, imageIndex)"
                      @keydown.enter.stop.prevent="previewNoteImage(note, imageIndex)"
                      @keydown.space.stop.prevent="previewNoteImage(note, imageIndex)"
                    >
                      <image
                        v-if="store.imageUrl(path)"
                        class="tl-media__img"
                        :src="store.imageUrl(path)"
                        mode="widthFix"
                        :alt="`${formatDayKey(group.key)} 笔记的第 ${imageIndex + 1} 张图片`"
                        lazy-load
                      />
                      <view v-else class="tl-media__placeholder">
                        <NoteIcon name="image" size="40rpx" />
                      </view>
                    </button>
                  </view>
                </view>
              </view>
            </view>
          </view>

          <view class="tl-footer">
            <text v-if="store.loadingMore">正在加载更早的记录…</text>
            <text v-else-if="store.selectedDay">这一天的记录已全部显示</text>
            <text v-else-if="!store.hasMore">已经到底了 · 共 {{ store.notes.length }} 条</text>
          </view>
        </template>
      </view>

      <NoteWeather v-model:show="weatherShow" />
      <NoteAssistant v-if="aiAvailable" v-model:show="aiOpen" :action="aiAction"
        :day="store.selectedDay || dayBeforeSearch" :seed="searchInput" @source="openAiSource" />
      <NoteCalendar
        v-model:show="calendarShow"
        :selected-day="store.selectedDay"
        @select="onSelectDay"
      />

      <NoteTabBar active="timeline" />
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.tl-hero__detail { display: flex; align-items: center; gap: 12px; min-height: 44px; }
.tl-hero__detail .tl-hero__meta--paired { margin-top: 0; }
.tl-ai-link { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 4px; margin: 0; border: 0; background: transparent; color: var(--note-accent); font-size: var(--note-font-footnote); }
.tl-ai-link::after { border: 0; }
.tl-ai-link:active { opacity: .6; }
.tl-ai-link--search { flex: 0 0 100%; justify-content: flex-start; padding: 0; }
.weather-trigger {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-height: 44px;
  min-width: 0;
  max-width: 100%;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  color: var(--note-text-2);
  font-size: var(--note-font-subhead);
  text-align: left;
}
.weather-trigger::after { border: 0; }
.weather-trigger:active { opacity: 0.6; }
.weather-trigger__label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.weather-trigger__label--report { color: var(--note-text); font-weight: 600; }
.weather-trigger__meta { flex: none; white-space: nowrap; font-size: var(--note-font-caption); }
.weather-trigger, .tl-nav__title { animation: tl-nav-label-in var(--note-duration-fast) ease-out; }
@keyframes tl-nav-label-in { from { opacity: 0; } to { opacity: 1; } }
.tl-page {
  --tl-header-h: calc(44px + var(--note-inset-top));
  --tl-nav-h: var(--tl-header-h);
  --tl-rail-x: 48rpx;
  --tl-gutter: max(32rpx, 16px);

  padding-bottom: calc(var(--note-tabbar-height) + var(--note-inset-bottom) + 40rpx);
  background: var(--note-surface);
}

.tl-page--search {
  --tl-nav-h: calc(var(--tl-header-h) + max(112rpx, 56px));
}

.tl-page--ai-search {
  --tl-nav-h: calc(var(--tl-header-h) + max(112rpx, 56px) + 44px);
}

.tl-nav {
  position: fixed;
  top: 0;
  left: var(--note-inset-left);
  right: var(--note-inset-right);
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  height: var(--tl-header-h);
  padding: var(--note-inset-top) 16rpx 0 var(--tl-gutter);
}

/* 滚动边缘效果：内容压到导航下方时才出现分隔线。 */
.tl-nav::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1rpx;
  background: var(--note-separator);
  opacity: 0;
  transition: opacity var(--note-duration) var(--note-ease);
}

.tl-nav--edge::after {
  opacity: 1;
}

.tl-nav__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--note-text);
  font-size: var(--note-font-body);
  font-weight: 700;
  letter-spacing: var(--note-track-title);
}

.tl-nav__actions {
  display: flex;
  flex: none;
  align-items: center;
}

.tl-icon-btn {
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
  transition:
    background-color var(--note-duration-fast) var(--note-ease),
    transform var(--note-duration-fast) var(--note-ease);
}

.tl-icon-btn:active {
  background: var(--note-fill-2);
  transform: scale(0.92);
}

.tl-icon-btn--on {
  color: var(--note-accent);
}

.tl-icon-btn::after,
.tl-strip__day::after,
.tl-media__item::after,
.tl-searchbar__clear::after,
.tl-searchbar__cancel::after,
.tl-filter__clear::after {
  border: 0;
}

.tl-searchbar {
  position: fixed;
  top: var(--tl-header-h);
  left: var(--note-inset-left);
  right: var(--note-inset-right);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: max(112rpx, 56px);
  padding: 0 var(--tl-gutter) 12rpx;
}

.tl-searchbar--ai {
  flex-wrap: wrap;
  row-gap: 0;
  height: calc(max(112rpx, 56px) + 44px);
  padding-bottom: 0;
}

.tl-searchbar__field {
  flex: 1;
  min-width: 0;
  height: 44px;
  min-height: 44px;
  padding-right: 0;
  background: var(--note-fill);
}

.tl-searchbar__clear {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-surface);
  background: transparent;
  z-index: 0;
}

.tl-searchbar__clear::before {
  content: '';
  position: absolute;
  inset: 12px;
  z-index: -1;
  border-radius: 50%;
  background: var(--note-text-3);
}

.tl-searchbar__cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: 72rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 8rpx;
  border: 0;
  color: var(--note-accent);
  background: transparent;
  font-size: var(--note-font-body);
  font-weight: 500;
}

.tl-body {
  padding: calc(var(--tl-nav-h) + 8rpx) 0 0;
}

.tl-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 34rpx var(--tl-gutter) 28rpx;
  background: radial-gradient(ellipse at 92% 12%, rgba(var(--note-accent-rgb), .13), transparent 67%);
}

.tl-hero__eyebrow,
.tl-hero__title,
.tl-hero__meta {
  position: relative;
  z-index: 1;
}


.tl-hero__eyebrow {
  color: var(--note-accent);
  font-size: var(--note-font-caption);
  font-weight: 700;
  letter-spacing: var(--note-track-caption);
}

.tl-hero__title {
  margin-top: 6rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--note-text);
  font-size: var(--note-font-title1);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: var(--note-track-large);
}

.tl-hero__meta {
  margin-top: 8rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
}

.tl-strip {
  display: flex;
  align-items: stretch;
  gap: 12rpx;
  padding: 0 var(--tl-gutter) 24rpx;
}

.tl-strip__scroll {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.tl-strip__track {
  display: inline-flex;
  gap: 8rpx;
  padding-right: 8rpx;
}

.tl-strip__day {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  width: 88rpx;
  height: 100rpx;
  min-width: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 20rpx;
  background: var(--note-fill-2);
  box-shadow: none;
  transition:
    background-color var(--note-duration-fast) var(--note-ease),
    transform var(--note-duration-fast) var(--note-ease);
}

.tl-strip__day:active {
  transform: scale(0.94);
}

.tl-strip__weekday {
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
  font-weight: 600;
  line-height: 1.2;
}

.tl-strip__day--weekend .tl-strip__weekday {
  color: var(--note-danger);
}

.tl-strip__num {
  color: var(--note-text);
  font-size: var(--note-font-title3);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.tl-strip__dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: transparent;
}

.tl-strip__dot--on {
  background: var(--note-accent);
}

.tl-strip__day--today {
  box-shadow: inset 0 0 0 2rpx rgba(var(--note-accent-rgb), 0.45);
}

.tl-strip__day--today .tl-strip__num {
  color: var(--note-accent);
  font-weight: 700;
}

.tl-strip__day--on,
.tl-strip__day--on:active {
  background: var(--note-accent-finish);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .23);
}

.tl-strip__day--on .tl-strip__weekday,
.tl-strip__day--on .tl-strip__num {
  color: var(--note-accent-contrast);
  opacity: 1;
}

.tl-strip__day--on .tl-strip__dot--on {
  background: var(--note-accent-contrast);
}

.tl-filter {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-height: 44px;
  margin: 0 var(--tl-gutter) 20rpx;
  padding: 0 8rpx 0 20rpx;
  border-radius: 999rpx;
  background: var(--note-accent-soft);
}

.tl-filter__icon {
  flex: none;
  color: var(--note-accent);
}

.tl-filter__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--note-accent);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}

.tl-filter__clear {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-accent);
  background: transparent;
}

.tl-filter__clear:active {
  background: rgba(var(--note-accent-rgb), 0.16);
}

.tl-day__head {
  position: sticky;
  top: var(--tl-nav-h);
  z-index: 10;
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 18rpx var(--tl-gutter);
}

.tl-day__label {
  color: var(--note-text);
  font-size: var(--note-font-subhead);
  font-weight: 700;
  letter-spacing: var(--note-track-title);
}

.tl-day__date {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
}

.tl-day__count {
  flex: none;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tl-day__list {
  position: relative;
  padding: 16rpx var(--tl-gutter) 12rpx;
}

.tl-entry {
  position: relative;
  display: grid;
  grid-template-columns: 96rpx minmax(0, 1fr);
  column-gap: 16rpx;
  align-items: start;
  padding-bottom: 16rpx;
  min-height: 92rpx;
}
.tl-entry__rail {
  position: relative;
  align-self: stretch;
}
.tl-entry__rail::after {
  content: ''; position: absolute; top: 64rpx; bottom: -8rpx;
  left: 50%; width: 3rpx; transform: translateX(-50%); background: var(--note-accent);
}
.tl-entry:last-child .tl-entry__rail::after {
  display: none;
}
.tl-entry__time {
  display: block; position: relative; padding: 8rpx 0; border-radius: 12rpx;
  text-align: center; font-size: var(--note-font-subhead); line-height: 1.5;
  font-variant-numeric: tabular-nums; color: var(--note-text); background: var(--note-fill);
}
.tl-card {
  min-width: 0;
}
.tl-card__open {
  display: block;
  min-height: 44px;
  width: 100%;
  margin: 0;
  padding: 4px 0;
  border: 0;
  border-radius: var(--note-radius-sm);
  background: transparent;
  color: var(--note-text);
  text-align: left;
  line-height: inherit;
  white-space: normal;
  transition: background-color var(--note-duration-fast) var(--note-ease);
}
.tl-card__open::after { border: 0; }
.tl-card__open:active { background: var(--note-fill-2); }
.tl-card__photo-label {
  color: var(--note-text-2);
  font-size: var(--note-font-subhead);
}
.tl-card__rich {
  color: var(--note-text);
  font-size: var(--note-font-body);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.tl-card__rich :deep(p:last-child) {
  margin-bottom: 0 !important;
}

.tl-card__blank {
  color: var(--note-text-3);
  font-size: var(--note-font-footnote);
}

.tl-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 14rpx;
}

.tl-media {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 16rpx;
}

.tl-media--single {
  grid-template-columns: minmax(0, 1fr);
}

.tl-media__item {
  position: relative;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--note-radius-sm);
  overflow: hidden;
  background: transparent;
}

.tl-media--single .tl-media__item {
  width: 100%; max-width: 280rpx; justify-self: start;
}

.tl-media__img {
  display: block;
  width: 100%;
  height: auto;
}

.tl-media__placeholder {
  min-height: 160rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--note-text-3);
}

.tl-footer {
  padding: 16rpx 32rpx 40rpx;
  text-align: center;
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
}

.tl-skeleton {
  padding: 24rpx var(--tl-gutter);
}

.tl-skeleton__row {
  display: grid;
  grid-template-columns: 56rpx minmax(0, 1fr);
  align-items: start;
  padding-bottom: 20rpx;
}

.tl-skeleton__dot {
  width: 16rpx;
  height: 16rpx;
  margin: 34rpx 0 0 20rpx;
  border-radius: 50%;
  background: var(--note-fill);
  animation: tl-pulse 1.4s var(--note-ease) infinite;
}

.tl-skeleton__card {
  padding: 24rpx 20rpx;
  border-radius: var(--note-radius-md);
  background: var(--note-surface);
}

.tl-skeleton__line {
  height: 28rpx;
  margin-bottom: 16rpx;
  border-radius: 8rpx;
  background: var(--note-fill);
  animation: tl-pulse 1.4s var(--note-ease) infinite;
}

.tl-skeleton__line--chip {
  width: 34%;
  height: 32rpx;
  margin-bottom: 22rpx;
}

.tl-skeleton__line--mid {
  width: 68%;
  margin-bottom: 0;
}

@keyframes tl-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

</style>
