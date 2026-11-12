<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onBackPress, onLoad, onPageScroll, onPullDownRefresh, onReachBottom, onShow, onUnload } from '@dcloudio/uni-app'
import NoteCalendar from '@/components/common/NoteCalendar.vue'
import NoteEmpty from '@/components/common/NoteEmpty.vue'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteActionSheet from '@/components/common/NoteActionSheet.vue'
import NoteSwipeRow from '@/components/common/NoteSwipeRow.vue'
import NoteTabBar from '@/components/common/NoteTabBar.vue'
import NoteUndoBar from '@/components/common/NoteUndoBar.vue'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import { useStorageModeStore } from '@/stores/storageMode'
import type { Note } from '@/api/types'
import { WEEKDAY_SHORT, dayKey, formatDayKey, formatTime, monthKey, parseDayKey, todayKey } from '@/utils/format'
import { haptic } from '@/utils/haptic'
import { renderNoteHtml } from '@/utils/richText'

const { themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const store = useNotesStore()
const storage = useStorageModeStore()

const STRIP_DAYS = 21
const SEARCH_DEBOUNCE = 280

const booted = ref(false)
const scrolled = ref(false)
const calendarShow = ref(false)
const timelineMenuOpen = ref(false)
const rowMenuOpen = ref(false)
const selectedMenuNote = ref<Note | null>(null)
const searchOpen = ref(false)
const searchFocus = ref(false)
const searchInput = ref('')
const swipedKey = ref('')
const undoToken = ref(0)
const dayCounts = ref<Record<string, number>>({})
const today = todayKey()

let searchTimer: ReturnType<typeof setTimeout> | null = null

// #ifdef H5
let titleObserver: IntersectionObserver | null = null

async function observeHeroTitle() {
  titleObserver?.disconnect()
  titleObserver = null
  await nextTick()
  if (searchOpen.value || typeof IntersectionObserver === 'undefined') return
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
  return `${base.getFullYear()}年${base.getMonth() + 1}月 · 周${WEEKDAY_SHORT[base.getDay()]}`
})
const heroYear = computed(() => (selectedDate.value ?? new Date()).getFullYear())

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
const stripAnchor = computed(() => `strip-${store.selectedDay || today}`)

const showSkeleton = computed(() => store.activeLoading && store.activeNotes.length === 0)
const showError = computed(() => Boolean(store.activeError) && store.activeNotes.length === 0)
const showEmpty = computed(() => !store.activeLoading && !store.activeError && store.activeNotes.length === 0)
const emptyIcon = computed(() => (store.keyword ? 'search' : store.selectedDay ? 'calendar' : 'journal'))
const emptyTitle = computed(() => {
  if (store.keyword) return '没有找到相关笔记'
  if (store.selectedDay) return '这一天还没有记录'
  return '开始记录你的时间轴'
})
const emptyDesc = computed(() => {
  if (store.keyword) return '换个关键词，或清空搜索查看全部记录'
  if (store.selectedDay) return '换个日期看看，或回到全部时间轴'
  return '点下方的 + 写下此刻的想法，时间轴会替你收好'
})
const emptyAction = computed(() => {
  if (store.keyword) return '清空搜索'
  if (store.selectedDay) return '查看全部'
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
  await storage.initialize()
  const valid = await auth.ensureValidSession()
  if (!valid) return
  try {
    await store.load()
  } catch {
    // 错误态由页面展示
  }
  booted.value = true
  void loadCounts()
})

onShow(() => {
  if (!booted.value) return
  void store
    .refreshActive()
    .then(() => loadCounts())
    .catch(() => {})
})

onUnload(() => {
  if (searchTimer) clearTimeout(searchTimer)
  // #ifdef H5
  titleObserver?.disconnect()
  // #endif
})

onPageScroll(({ scrollTop }) => {
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
  if (rowMenuOpen.value) { rowMenuOpen.value = false; return true }
  if (timelineMenuOpen.value) { timelineMenuOpen.value = false; return true }
  if (calendarShow.value) { calendarShow.value = false; return true }
  return false
})

function openMenu() {
  timelineMenuOpen.value = true
}

function runTimelineAction(action: string) {
  timelineMenuOpen.value = false
  if (action === 'refresh') {
    void store
      .refreshActive()
      .then(() => loadCounts())
      .catch(() => {})
  } else if (action === 'calendar') {
    void nextTick(() => { calendarShow.value = true })
  } else if (action === 'all') {
    clearFilters()
  }
}

function openSearch() {
  searchOpen.value = true
  searchFocus.value = true
}

function closeSearch() {
  searchOpen.value = false
  searchFocus.value = false
  if (searchTimer) clearTimeout(searchTimer)
  searchInput.value = ''
  if (store.keyword) void store.search('').catch(() => {})
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
  if (searchOpen.value) closeSearch()
  void store.selectDay('')
  uni.pageScrollTo({ scrollTop: 0, duration: 300 })
}

function retry() {
  if (store.selectedDay) {
    void store.selectDay(store.selectedDay).catch(() => {})
  } else {
    void store.load().catch(() => {})
  }
}

function onSelectDay(day: string) {
  if (searchOpen.value) closeSearch()
  void store.selectDay(day).catch(() => {})
  uni.pageScrollTo({ scrollTop: 0, duration: 300 })
}

function onStripPick(item: StripDay) {
  haptic('light')
  onSelectDay(store.selectedDay === item.key ? '' : item.key)
}

function openEditor(note?: Note) {
  swipedKey.value = ''
  uni.navigateTo({ url: note ? `/pages/editor/index?id=${note.id}` : '/pages/editor/index' })
}

function noteText(note: Note) {
  return (note.contentText ?? '').trim()
}

function requestDelete(note: Note) {
  haptic('warning')
  swipedKey.value = ''
  if (!store.removeWithUndo(note.id)) return
  undoToken.value += 1
}

function undoDelete() {
  if (!store.undoRemoval()) return
  haptic('success')
  uni.showToast({ title: '已恢复', icon: 'none' })
}

function openRowMenu(note: Note) {
  swipedKey.value = ''
  selectedMenuNote.value = note
  rowMenuOpen.value = true
}

function editSelectedNote() {
  const note = selectedMenuNote.value
  rowMenuOpen.value = false
  selectedMenuNote.value = null
  if (note) openEditor(note)
}

function deleteSelectedNote() {
  const note = selectedMenuNote.value
  rowMenuOpen.value = false
  selectedMenuNote.value = null
  if (note) requestDelete(note)
}

function runRowAction(action: string) {
  if (action === 'edit') editSelectedNote()
  else if (action === 'delete') deleteSelectedNote()
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
      :class="[themeClass, { 'note-dark': isDark, 'tl-page--search': searchOpen }]"
    >
      <view class="tl-nav note-material--thick" :class="{ 'tl-nav--edge': scrolled || searchOpen }">
        <text class="tl-nav__title" :class="{ 'tl-nav__title--on': scrolled || searchOpen }">
          {{ navTitle }}
        </text>
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
          <button class="tl-icon-btn" aria-label="更多操作" @tap="openMenu">
            <NoteIcon name="more" size="40rpx" />
          </button>
        </view>
      </view>

      <view v-if="searchOpen" class="tl-searchbar note-material--thick">
        <view class="note-field tl-searchbar__field">
          <NoteIcon name="search" size="32rpx" class="note-field__icon" />
          <input
            v-model="searchInput"
            class="note-field__input"
            :focus="searchFocus"
            placeholder="搜索笔记内容"
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
      </view>

      <view class="tl-body">
        <view v-if="!searchOpen" class="tl-hero">
          <text class="tl-hero__year" aria-hidden="true">{{ heroYear }}</text>
          <text class="tl-hero__eyebrow">{{ heroEyebrow }}</text>
          <text class="tl-hero__title">{{ heroTitle }}</text>
          <text class="tl-hero__meta">{{ heroMeta }}</text>
        </view>

        <view v-if="!searchOpen" class="tl-strip">
          <button
            class="tl-strip__all"
            :class="{ 'tl-strip__all--on': !store.selectedDay }"
            :aria-pressed="!store.selectedDay"
            aria-label="查看全部时间的笔记"
            @tap="onSelectDay('')"
          >
            <NoteIcon name="timeline" size="34rpx" />
            <text class="tl-strip__all-text">全部</text>
          </button>
          <scroll-view
            class="tl-strip__scroll"
            scroll-x
            :show-scrollbar="false"
            :scroll-into-view="stripAnchor"
            scroll-with-animation
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

        <view v-if="store.selectedDay || store.keyword" class="tl-filter">
          <NoteIcon :name="store.keyword ? 'search' : 'calendar'" size="28rpx" class="tl-filter__icon" />
          <text class="tl-filter__text">
            {{ store.keyword ? `关键词「${store.keyword}」` : formatDayKey(store.selectedDay) }}
          </text>
          <button class="tl-filter__clear" aria-label="清除筛选" @tap="clearFilters">
            <NoteIcon name="close" size="24rpx" />
          </button>
        </view>

        <view v-if="showSkeleton" class="tl-skeleton" aria-label="加载中" aria-busy="true">
          <view v-for="index in 4" :key="index" class="tl-skeleton__row">
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
          @action="store.keyword || store.selectedDay ? clearFilters() : openEditor()"
        />

        <template v-else>
          <view v-for="group in store.activeGroups" :key="group.key" class="tl-day">
            <view class="tl-day__head note-material">
              <text class="tl-day__label">{{ group.label }}</text>
              <text class="tl-day__date">{{ formatDayKey(group.key) }}</text>
              <text class="tl-day__count">{{ group.notes.length }} 条</text>
            </view>

            <view class="tl-day__list">
              <view v-for="note in group.notes" :key="note.id" class="tl-entry">
                <view class="tl-entry__rail" aria-hidden="true">
                  <view class="tl-entry__dot" />
                </view>
                <NoteSwipeRow
                  class="tl-entry__swipe"
                  :row-key="note.id"
                  :active-key="swipedKey"
                  :label="`删除 ${formatTime(note.createdAt)} 的笔记`"
                  :press-label="`编辑 ${formatTime(note.createdAt)} 的笔记，左右方向键可展开或收起删除操作`"
                  @open="swipedKey = $event"
                  @press="openEditor(note)"
                  @remove="requestDelete(note)"
                >
                  <view class="tl-card">
                    <view class="tl-card__head">
                      <text class="tl-card__time">{{ formatTime(note.createdAt) }}</text>
                      <button
                        class="tl-card__more"
                        :aria-label="`${formatTime(note.createdAt)} 笔记的更多操作`"
                        @tap.stop="openRowMenu(note)"
                      >
                        <NoteIcon name="more" size="32rpx" />
                      </button>
                    </view>

                    <rich-text
                      v-if="noteText(note)"
                      class="tl-card__rich"
                      :nodes="renderNoteHtml(note.content)"
                    />
                    <text v-else class="tl-card__blank">这条笔记只有图片</text>

                    <view v-if="note.tags?.length" class="tl-card__tags">
                      <text v-for="tag in note.tags" :key="tag" class="note-chip tl-card__tag">
                        #{{ tag }}
                      </text>
                    </view>

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
                      >
                        <image
                          v-if="store.imageUrl(path)"
                          class="tl-media__img"
                          :src="store.imageUrl(path)"
                          mode="aspectFit"
                          :alt="`${formatDayKey(group.key)} 笔记的第 ${imageIndex + 1} 张图片`"
                          lazy-load
                        />
                        <view v-else class="tl-media__placeholder">
                          <NoteIcon name="image" size="40rpx" />
                        </view>
                      </button>
                    </view>
                  </view>
                </NoteSwipeRow>
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

      <NoteCalendar
        v-model:show="calendarShow"
        :selected-day="store.selectedDay"
        @select="onSelectDay"
        @clear="clearFilters"
      />

      <NoteActionSheet
        v-model:show="timelineMenuOpen"
        title="时间轴"
        :items="[
          { value: 'refresh', label: '刷新记录', icon: 'refresh' },
          { value: 'calendar', label: '按日期查看', icon: 'calendar' },
          { value: 'all', label: '查看全部记录', icon: 'timeline' }
        ]"
        @select="runTimelineAction"
      />
      <NoteActionSheet
        v-model:show="rowMenuOpen"
        title="笔记操作"
        :items="[
          { value: 'edit', label: '编辑这条笔记', icon: 'edit' },
          { value: 'delete', label: '删除这条笔记', icon: 'trash', danger: true }
        ]"
        @select="runRowAction"
      />

      <NoteUndoBar
        :show="Boolean(store.pendingRemoval)"
        :token="undoToken"
        message="已删除 1 条笔记"
        @undo="undoDelete"
      />

      <NoteTabBar active="timeline" />
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.tl-page {
  --tl-nav-h: calc(88rpx + env(safe-area-inset-top));
  --tl-rail-x: 28rpx;

  padding-bottom: calc(var(--note-tabbar-height) + 40rpx);
  background: var(--note-bg);
}

.tl-page--search {
  --tl-nav-h: calc(184rpx + env(safe-area-inset-top));
}

.tl-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  height: var(--tl-nav-h);
  padding: env(safe-area-inset-top) 16rpx 0 32rpx;
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
  opacity: 0;
  transform: translate3d(0, 12rpx, 0);
  transition:
    opacity var(--note-duration) var(--note-ease),
    transform var(--note-duration) var(--note-ease);
}

.tl-nav__title--on {
  opacity: 1;
  transform: translate3d(0, 0, 0);
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
  background: var(--note-accent-soft);
}

.tl-icon-btn::after,
.tl-strip__all::after,
.tl-strip__day::after,
.tl-card__more::after,
.tl-media__item::after,
.tl-searchbar__clear::after,
.tl-searchbar__cancel::after,
.tl-filter__clear::after {
  border: 0;
}

.tl-searchbar {
  position: fixed;
  top: calc(88rpx + env(safe-area-inset-top));
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 96rpx;
  padding: 0 24rpx 12rpx;
}

.tl-searchbar__field {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  min-height: 72rpx;
  background: var(--note-fill);
}

.tl-searchbar__clear {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-surface);
  background: var(--note-text-3);
}

.tl-searchbar__cancel {
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
  padding: 28rpx 40rpx 36rpx;
  background: radial-gradient(ellipse at 100% 0%, rgba(var(--note-accent-rgb), 0.1), transparent 70%);
}

.tl-hero__year {
  position: absolute;
  right: 16rpx;
  top: -8rpx;
  color: var(--note-accent);
  opacity: 0.08;
  font-size: 170rpx;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -6rpx;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.tl-hero__eyebrow,
.tl-hero__title,
.tl-hero__meta {
  position: relative;
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
  font-size: var(--note-font-large);
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
  padding: 0 24rpx 28rpx 40rpx;
}

.tl-strip__all {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  width: 96rpx;
  height: 116rpx;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 24rpx;
  color: var(--note-text-2);
  background: var(--note-fill-2);
  transition:
    color var(--note-duration-fast) var(--note-ease),
    background-color var(--note-duration-fast) var(--note-ease);
}

.tl-strip__all--on {
  color: var(--note-accent);
  background: var(--note-accent-soft);
}

.tl-strip__all-text {
  font-size: var(--note-font-min);
  font-weight: 600;
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
  height: 116rpx;
  min-width: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 24rpx;
  background: var(--note-surface);
  box-shadow: var(--note-shadow-sm);
  transition:
    background-color var(--note-duration-fast) var(--note-ease),
    transform var(--note-duration-fast) var(--note-ease);
}

.tl-strip__day:active {
  transform: scale(0.94);
}

.tl-strip__weekday {
  color: var(--note-text-3);
  font-size: var(--note-font-min);
  font-weight: 600;
}

.tl-strip__day--weekend .tl-strip__weekday {
  color: var(--note-mood-memorial);
  opacity: 0.75;
}

.tl-strip__num {
  color: var(--note-text);
  font-size: var(--note-font-body);
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
  background: var(--note-accent);
  box-shadow: var(--note-shadow-accent);
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
  height: 68rpx;
  margin: 0 32rpx 20rpx;
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
  padding: 18rpx 40rpx;
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
  padding: 16rpx 40rpx 12rpx;
}

/* 连续轨道线，把一天里的记录串成一条时间轴。 */
.tl-day__list::before {
  content: '';
  position: absolute;
  top: 24rpx;
  bottom: 24rpx;
  left: calc(40rpx + var(--tl-rail-x));
  width: 2rpx;
  transform: translateX(-50%);
  border-radius: 2rpx;
  background: var(--note-separator);
}

.tl-entry {
  display: grid;
  grid-template-columns: 56rpx minmax(0, 1fr);
  align-items: start;
  padding-bottom: 20rpx;
}

.tl-entry__rail {
  position: relative;
  align-self: stretch;
}

.tl-entry__dot {
  position: absolute;
  top: 34rpx;
  left: var(--tl-rail-x);
  width: 16rpx;
  height: 16rpx;
  transform: translateX(-50%);
  border-radius: 50%;
  background: var(--note-accent);
  box-shadow: 0 0 0 6rpx var(--note-bg);
  transition: background-color var(--note-duration) var(--note-ease);
}

.tl-entry__swipe {
  min-width: 0;
}

.tl-card {
  padding: 24rpx 28rpx 28rpx;
  border: 1rpx solid var(--note-separator);
  border-radius: 28rpx;
  background: var(--note-surface);
  box-shadow: var(--note-shadow-sm);
  transition: background-color var(--note-duration-fast) var(--note-ease);
}

.tl-entry__swipe:active .tl-card {
  background: var(--note-surface-2);
}

.tl-card__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 12rpx;
}

.tl-card__time {
  flex: none;
  color: var(--note-accent);
  font-size: var(--note-font-subhead);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--note-track-title);
}

.tl-card__more {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  min-width: 44px;
  min-height: 44px;
  margin: -12rpx -12rpx -12rpx auto;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-text-3);
  background: transparent;
  transition: background-color var(--note-duration-fast) var(--note-ease);
}

.tl-card__more:active {
  background: var(--note-fill);
}

.tl-card__rich {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  overflow: hidden;
  color: var(--note-text);
  font-size: var(--note-font-body);
  line-height: 1.55;
  overflow-wrap: anywhere;
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

.tl-card__tag {
  height: 40rpx;
  padding: 0 14rpx;
  color: var(--note-accent);
  background: var(--note-accent-soft);
}

.tl-media {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8rpx;
  margin-top: 16rpx;
}

.tl-media--single {
  grid-template-columns: minmax(0, 1fr);
}

.tl-media__item {
  position: relative;
  aspect-ratio: 1;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--note-radius-sm);
  overflow: hidden;
  background: var(--note-fill-2);
}

.tl-media--single .tl-media__item {
  aspect-ratio: 4 / 3;
}

.tl-media__img {
  width: 100%;
  height: 100%;
}

.tl-media__placeholder {
  position: absolute;
  inset: 0;
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
  padding: 24rpx 32rpx;
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

@media (prefers-reduced-motion: reduce) {
  .tl-nav__title {
    transform: none;
  }
}
</style>
