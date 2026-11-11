<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import NoteCalendar from '@/components/common/NoteCalendar.vue'
import NoteEmpty from '@/components/common/NoteEmpty.vue'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteTabBar from '@/components/common/NoteTabBar.vue'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import type { Note } from '@/api/types'
import { WEEKDAY_SHORT, formatDayKey, formatTime, parseDayKey, todayKey } from '@/utils/format'
import { moodInfo } from '@/utils/moods'
import { renderNoteHtml } from '@/utils/richText'

const { themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const store = useNotesStore()

const booted = ref(false)
const calendarShow = ref(false)
const searchOpen = ref(false)
const searchInput = ref('')

const headerDate = computed(() => (store.selectedDay ? parseDayKey(store.selectedDay) : new Date()))
const headerMonth = computed(() => headerDate.value.getMonth() + 1)
const headerDay = computed(() => headerDate.value.getDate())
const headerWeekday = computed(() => `周${WEEKDAY_SHORT[headerDate.value.getDay()]}`)
const headerYear = computed(() => headerDate.value.getFullYear())

const showSkeleton = computed(() => store.activeLoading && store.activeNotes.length === 0)
const showError = computed(() => Boolean(store.activeError) && store.activeNotes.length === 0)
const showEmpty = computed(() => !store.activeLoading && !store.activeError && store.activeNotes.length === 0)
const emptyTitle = computed(() => {
  if (store.selectedDay) return '这一天还没有记录'
  if (store.keyword) return '没有找到相关笔记'
  return '开始记录你的时间轴'
})
const emptyDesc = computed(() => {
  if (store.selectedDay) return '换个日期看看，或为这一天补上一条记录'
  if (store.keyword) return '试试其他关键词'
  return '点击右下角的 +，写下此刻的想法'
})

onLoad(async () => {
  const valid = await auth.ensureValidSession()
  if (!valid) return
  try {
    await store.load()
  } catch {
    // 错误态由页面展示
  }
  booted.value = true
})

onShow(() => {
  if (!booted.value) return
  void store.refreshActive().catch(() => {})
})

onPullDownRefresh(async () => {
  try {
    await store.refreshActive()
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

function openMenu() {
  uni.showActionSheet({
    itemList: ['刷新列表', '回到今天'],
    success: ({ tapIndex }) => {
      if (tapIndex === 0) {
        void store.refreshActive().catch(() => {})
      } else {
        void store.selectDay('')
        uni.pageScrollTo({ scrollTop: 0, duration: 300 })
      }
    }
  })
}

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value && store.keyword) {
    searchInput.value = ''
    void store.search('').catch(() => {})
  }
}

function submitSearch() {
  if (store.selectedDay) void store.selectDay('')
  void store.search(searchInput.value).catch(() => {})
}

function clearSearch() {
  searchInput.value = ''
  void store.search('').catch(() => {})
}

function retry() {
  if (store.selectedDay) {
    void store.selectDay(store.selectedDay).catch(() => {})
  } else {
    void store.load().catch(() => {})
  }
}

function onSelectDay(day: string) {
  void store.selectDay(day).catch(() => {})
  uni.pageScrollTo({ scrollTop: 0, duration: 300 })
}

function onClearDay() {
  void store.selectDay('')
}

function openEditor(note?: Note) {
  uni.navigateTo({ url: note ? `/pages/editor/index?id=${note.id}` : '/pages/editor/index' })
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
    <view class="page tl-page" :class="[themeClass, { 'note-dark': isDark, 'tl-page--search': searchOpen }]">
      <view class="tl-header">
        <text class="tl-header__year" aria-hidden="true">{{ headerYear }}</text>
        <view class="tl-header__row">
          <button class="tl-header__btn" aria-label="更多操作" @tap="openMenu">
            <NoteIcon name="more" size="40rpx" />
          </button>
          <button
            class="tl-leaf"
            :class="{ 'tl-leaf--active': Boolean(store.selectedDay) }"
            aria-label="打开日历，选择日期"
            @tap="calendarShow = true"
          >
            <view class="tl-leaf__cap">{{ headerMonth }}月</view>
            <view class="tl-leaf__body">
              <text class="tl-leaf__day">{{ headerDay }}</text>
              <text class="tl-leaf__week">{{ headerWeekday }}</text>
            </view>
          </button>
          <button
            class="tl-header__btn"
            :class="{ 'tl-header__btn--active': searchOpen }"
            aria-label="搜索笔记"
            @tap="toggleSearch"
          >
            <NoteIcon name="search" size="40rpx" />
          </button>
        </view>
        <view v-if="searchOpen" class="tl-search">
          <view class="note-field tl-search__field">
            <NoteIcon name="search" size="32rpx" class="note-field__icon" />
            <input
              v-model="searchInput"
              class="note-field__input"
              placeholder="搜索笔记内容"
              placeholder-class="note-field__placeholder"
              confirm-type="search"
              @confirm="submitSearch"
            />
            <button v-if="searchInput" class="tl-search__clear" aria-label="清空搜索" @tap="clearSearch">
              <NoteIcon name="close" size="28rpx" />
            </button>
          </view>
        </view>
      </view>

      <view class="tl-content">
        <view v-if="store.selectedDay" class="tl-filter">
          <text class="tl-filter__label">{{ formatDayKey(store.selectedDay) }}</text>
          <button class="tl-filter__clear" aria-label="取消日期筛选，查看全部" @tap="onClearDay">
            查看全部
            <NoteIcon name="close" size="24rpx" />
          </button>
        </view>

        <view v-if="showSkeleton" class="tl-skeleton" aria-label="加载中">
          <view v-for="index in 4" :key="index" class="tl-skeleton__entry">
            <view class="tl-skeleton__chip" />
            <view class="tl-skeleton__rail" />
            <view class="tl-skeleton__body">
              <view class="tl-skeleton__line tl-skeleton__line--short" />
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
          icon="journal"
          :title="emptyTitle"
          :description="emptyDesc"
          :action-text="store.keyword ? '' : '写第一条'"
          @action="openEditor()"
        />

        <template v-else>
          <view v-for="group in store.activeGroups" :key="group.key" class="tl-day">
            <view class="tl-day__head">
              <text class="tl-day__label">{{ group.label }}</text>
              <text class="tl-day__count">{{ group.notes.length }} 条</text>
            </view>
            <view
              v-for="(note, index) in group.notes"
              :key="note.id"
              class="tl-entry"
              role="button"
              :aria-label="`编辑 ${formatTime(note.createdAt)} 的笔记`"
              @tap="openEditor(note)"
            >
              <view class="tl-entry__time">
                <text>{{ formatTime(note.createdAt) }}</text>
              </view>
              <view class="tl-entry__rail" aria-hidden="true">
                <view
                  class="tl-entry__dot"
                  :style="{ background: moodInfo(note.mood).color }"
                />
                <view v-if="index < group.notes.length - 1" class="tl-entry__line" />
              </view>
              <view class="tl-entry__body">
                <view class="tl-entry__mood" :style="{ color: moodInfo(note.mood).color }">
                  <NoteIcon :name="moodInfo(note.mood).icon" size="26rpx" />
                  <text>{{ moodInfo(note.mood).name }}</text>
                </view>
                <rich-text
                  v-if="noteText(note)"
                  class="tl-entry__rich"
                  :nodes="renderNoteHtml(note.content)"
                />
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
                      mode="aspectFill"
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

          <view v-if="!store.selectedDay" class="tl-footer">
            <text v-if="store.loadingMore">加载中…</text>
            <text v-else-if="!store.hasMore && store.notes.length > 0">已加载全部</text>
          </view>
        </template>
      </view>

      <button class="tl-fab" aria-label="写笔记" @tap="openEditor()">
        <NoteIcon name="add" size="48rpx" />
      </button>

      <NoteTabBar active="timeline" />

      <NoteCalendar
        v-model:show="calendarShow"
        :selected-day="store.selectedDay"
        @select="onSelectDay"
        @clear="onClearDay"
      />
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.tl-page {
  --tl-header-h: calc(224rpx + env(safe-area-inset-top));

  padding-bottom: calc(var(--note-tabbar-height) + 48rpx);
}

.tl-page--search {
  --tl-header-h: calc(320rpx + env(safe-area-inset-top));
}

.tl-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  padding-top: env(safe-area-inset-top);
  background: var(--note-material);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1rpx solid var(--note-separator);
  overflow: hidden;
}

.tl-header__year {
  position: absolute;
  top: calc(env(safe-area-inset-top) - 24rpx);
  left: 50%;
  transform: translateX(-50%);
  color: var(--note-text-3);
  opacity: 0.55;
  font-size: 200rpx;
  font-weight: 800;
  letter-spacing: 8rpx;
  line-height: 1;
  pointer-events: none;
  user-select: none;
}

.tl-header__row {
  position: relative;
  display: grid;
  grid-template-columns: 88rpx minmax(0, 1fr) 88rpx;
  align-items: center;
  justify-items: center;
  height: 224rpx;
  padding: 0 24rpx;
}

.tl-header__btn {
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
  transition: background-color var(--note-duration-fast) var(--note-ease);
}

.tl-header__btn:active,
.tl-header__btn--active {
  background: var(--note-fill);
}

.tl-leaf {
  display: flex;
  flex-direction: column;
  width: 148rpx;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 24rpx;
  overflow: hidden;
  background: var(--note-surface);
  box-shadow: var(--note-shadow-md);
  transition: transform var(--note-duration-fast) var(--note-ease);
}

.tl-leaf:active {
  transform: scale(0.96);
}

.tl-leaf__cap {
  padding: 8rpx 0;
  color: var(--note-accent-contrast);
  background: var(--note-accent);
  font-size: var(--note-font-caption);
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.tl-leaf__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10rpx 0 14rpx;
}

.tl-leaf__day {
  color: var(--note-text);
  font-size: 64rpx;
  font-weight: 700;
  line-height: 1.05;
}

.tl-leaf__week {
  margin-top: 2rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  font-weight: 500;
}

.tl-leaf--active {
  box-shadow: 0 0 0 4rpx rgba(var(--note-accent-rgb), 0.3), var(--note-shadow-md);
}

.tl-search {
  position: relative;
  padding: 0 24rpx 20rpx;
}

.tl-search__field {
  height: 76rpx;
  min-height: 76rpx;
  background: var(--note-fill);
}

.tl-search__clear {
  display: flex;
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
  color: var(--note-text-2);
  background: transparent;
}

.tl-content {
  padding: calc(var(--tl-header-h) + 16rpx) 32rpx 0;
}

.tl-filter {
  display: inline-flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 16rpx;
  padding: 12rpx 12rpx 12rpx 28rpx;
  border-radius: 999rpx;
  background: var(--note-accent-soft);
}

.tl-filter__label {
  color: var(--note-accent);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}

.tl-filter__clear {
  display: flex;
  align-items: center;
  gap: 6rpx;
  height: 56rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 20rpx;
  border: 0;
  border-radius: 999rpx;
  color: var(--note-accent);
  background: var(--note-surface);
  font-size: var(--note-font-caption);
  font-weight: 600;
}

.tl-day__head {
  position: sticky;
  top: var(--tl-header-h);
  z-index: 10;
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding: 20rpx 0 12rpx;
  background: var(--note-material);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

.tl-day__label {
  color: var(--note-text);
  font-size: var(--note-font-title3);
  font-weight: 700;
}

.tl-day__count {
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
  font-weight: 500;
}

.tl-entry {
  display: grid;
  grid-template-columns: 108rpx 40rpx minmax(0, 1fr);
  align-items: start;
  transition: opacity var(--note-duration-fast) var(--note-ease);
}

.tl-entry:active {
  opacity: 0.6;
}

.tl-entry__time {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  margin-top: 12rpx;
  border-radius: var(--note-radius-sm);
  background: var(--note-fill);
  color: var(--note-text);
  font-size: var(--note-font-footnote);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tl-entry__rail {
  position: relative;
  align-self: stretch;
}

.tl-entry__dot {
  position: absolute;
  top: 44rpx;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  box-shadow: 0 0 0 4rpx var(--note-bg);
}

.tl-entry__line {
  position: absolute;
  top: 44rpx;
  bottom: -44rpx;
  left: 50%;
  width: 4rpx;
  transform: translateX(-50%);
  border-radius: 2rpx;
  background: var(--note-accent);
  opacity: 0.7;
}

.tl-entry__body {
  min-width: 0;
  padding: 16rpx 0 48rpx 16rpx;
}

.tl-entry__mood {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: var(--note-font-caption);
  font-weight: 600;
}

.tl-entry__rich {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
  margin-top: 8rpx;
  color: var(--note-text);
  font-size: var(--note-font-body);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.tl-media {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8rpx;
  margin-top: 16rpx;
}

.tl-media--single {
  grid-template-columns: minmax(0, 480rpx);
}

.tl-media__item {
  position: relative;
  aspect-ratio: 1;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--note-radius-md);
  overflow: hidden;
  background: var(--note-fill);
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
  padding: 24rpx 0 48rpx;
  text-align: center;
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
}

.tl-fab {
  position: fixed;
  right: 32rpx;
  bottom: calc(var(--note-tabbar-height) + 32rpx);
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  min-width: 56px;
  min-height: 56px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-accent-contrast);
  background: var(--note-accent);
  box-shadow: var(--note-shadow-accent);
  transition: transform var(--note-duration-fast) var(--note-ease);
}

.tl-fab:active {
  transform: scale(0.92);
}

.tl-skeleton__entry {
  display: grid;
  grid-template-columns: 108rpx 40rpx minmax(0, 1fr);
  align-items: start;
  padding-bottom: 48rpx;
}

.tl-skeleton__chip {
  height: 64rpx;
  margin-top: 12rpx;
  border-radius: var(--note-radius-sm);
  background: var(--note-fill);
  animation: tl-pulse 1.4s var(--note-ease) infinite;
}

.tl-skeleton__rail {
  position: relative;
  align-self: stretch;
}

.tl-skeleton__rail::before {
  content: '';
  position: absolute;
  top: 44rpx;
  bottom: -4rpx;
  left: 50%;
  width: 4rpx;
  transform: translateX(-50%);
  background: var(--note-fill);
}

.tl-skeleton__body {
  padding: 16rpx 0 0 16rpx;
}

.tl-skeleton__line {
  height: 30rpx;
  margin-bottom: 16rpx;
  border-radius: 8rpx;
  background: var(--note-fill);
  animation: tl-pulse 1.4s var(--note-ease) infinite;
}

.tl-skeleton__line--short {
  width: 30%;
}

.tl-skeleton__line--mid {
  width: 70%;
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