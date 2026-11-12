<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBackPress, onLoad } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteNavBar from '@/components/common/NoteNavBar.vue'
import NoteTabBar from '@/components/common/NoteTabBar.vue'
import NoteActionSheet from '@/components/common/NoteActionSheet.vue'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import { useStorageModeStore } from '@/stores/storageMode'
import { APPEARANCE_OPTIONS, THEME_PRESETS } from '@/stores/theme'
import { dayKey, formatDayKey } from '@/utils/format'

const { theme, themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const store = useNotesStore()
const storage = useStorageModeStore()
const confirmOpen = ref(false)
const pendingAction = ref<'local' | 'cloud' | 'logout'>('local')

const account = computed(() => {
  if (storage.mode === 'local') return '仅保存在此设备'
  const user = auth.user
  if (!user) return ''
  if (user.email) return user.email
  if (user.phone) return user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  return ''
})

const displayName = computed(() => {
  if (storage.mode === 'local') return '本机记录'
  const user = auth.user
  const metaName = user?.user_metadata?.name
  if (typeof metaName === 'string' && metaName.trim()) return metaName.trim()
  const email = user?.email
  if (email) return email.split('@')[0] || email
  const phone = user?.phone
  if (phone) return `用户${phone.slice(-4)}`
  return '时光记录者'
})

const avatarChar = computed(() => displayName.value.slice(0, 1).toUpperCase())

const noteCount = computed(() => (store.hasMore ? `${store.notes.length}+` : String(store.notes.length)))
const latestDay = computed(() => {
  const first = store.notes[0]
  return first ? formatDayKey(dayKey(first.createdAt)) : '暂无'
})

onLoad(async () => {
  await storage.initialize()
  storage.hydrate()
  const valid = await auth.ensureValidSession()
  if (!valid) return
  if (!store.loaded) {
    try {
      await store.load()
    } catch {
      // 统计加载失败时保持占位
    }
  }
})

onBackPress(() => {
  if (!confirmOpen.value) return false
  confirmOpen.value = false
  return true
})

function switchStorageMode(mode: 'local' | 'cloud') {
  if (mode === storage.mode) return
  if (mode === 'cloud' && !storage.cloudAvailable) {
    uni.showToast({ title: '云端存储暂未开放，请联系管理员', icon: 'none' })
    return
  }
  pendingAction.value = mode
  confirmOpen.value = true
}

function logout() {
  pendingAction.value = 'logout'
  confirmOpen.value = true
}

async function confirmMineAction() {
  const action = pendingAction.value
  store.reset()
  if (action === 'logout') {
    await auth.logout()
    return
  }
  auth.clearSession(false)
  storage.setMode(action)
  uni.reLaunch({ url: action === 'local' ? '/pages/timeline/index' : '/pages/login/index' })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <view class="page mine-page" :class="[themeClass, { 'note-dark': isDark }]">
      <NoteNavBar title="我的" />

      <view class="mine-body">
        <view class="mine-profile note-card">
          <view class="mine-avatar" aria-hidden="true">{{ avatarChar }}</view>
          <view class="mine-profile__copy">
            <text class="mine-profile__eyebrow">{{ storage.mode === 'local' ? '本机空间' : '云端空间' }}</text>
            <text class="mine-profile__name">{{ displayName }}</text>
            <text class="mine-profile__account">{{ account }}</text>
          </view>
        </view>

        <view class="mine-stats note-card">
          <view class="mine-stat">
            <text class="mine-stat__value">{{ noteCount }}</text>
            <text class="mine-stat__label">时间轴笔记</text>
          </view>
          <view class="mine-stats__divider" aria-hidden="true" />
          <view class="mine-stat">
            <text class="mine-stat__value mine-stat__value--small">{{ latestDay }}</text>
            <text class="mine-stat__label">最近记录</text>
          </view>
        </view>

        <text class="mine-section-title">外观设置</text>
        <view class="mine-section note-card">
          <view class="mine-row">
            <view class="mine-row__label">
              <NoteIcon name="palette" size="34rpx" />
              <text>主题色</text>
            </view>
            <view class="mine-swatches">
              <button
                v-for="preset in THEME_PRESETS"
                :key="preset.id"
                class="mine-swatch"
                :class="{ 'mine-swatch--active': theme.preset === preset.id }"
                :style="{ background: isDark ? preset.accentDark : preset.accent }"
                :aria-label="`主题色：${preset.name}`"
                :aria-pressed="theme.preset === preset.id"
                @tap="theme.selectPreset(preset.id)"
              >
                <NoteIcon v-if="theme.preset === preset.id" name="check" size="28rpx" color="#ffffff" />
              </button>
            </view>
          </view>
          <text class="mine-caption">{{ theme.currentPreset.name }} · {{ theme.currentPreset.description }}</text>
          <view class="mine-row mine-row--border">
            <view class="mine-row__label">
              <NoteIcon name="settings" size="34rpx" />
              <text>外观</text>
            </view>
          </view>
          <view class="mine-appearance" role="group" aria-label="外观模式">
            <button
              v-for="option in APPEARANCE_OPTIONS"
              :key="option.id"
              class="mine-appearance__option"
              :class="{ 'mine-appearance__option--active': theme.appearance === option.id }"
              :aria-pressed="theme.appearance === option.id"
              @tap="theme.selectAppearance(option.id)"
            >{{ option.name }}</button>
          </view>
        </view>

        <text class="mine-section-title">数据存储</text>
        <view class="mine-section note-card">
          <button
            class="mine-storage-option"
            :class="{ 'mine-storage-option--active': storage.mode === 'local' }"
            :aria-pressed="storage.mode === 'local'"
            @tap="switchStorageMode('local')"
          >
            <NoteIcon name="phone" size="38rpx" />
            <view class="mine-storage-option__copy">
              <text class="mine-storage-option__title">本机存储</text>
              <text class="mine-storage-option__desc">只保存在这台设备 · 无需登录</text>
            </view>
            <text v-if="storage.mode === 'local'" class="mine-storage-option__state">正在使用</text>
            <NoteIcon v-if="storage.mode === 'local'" name="check" size="32rpx" />
          </button>
          <view v-if="storage.cloudAvailable" class="mine-storage-divider" />
          <button
            v-if="storage.cloudAvailable"
            class="mine-storage-option"
            :class="{ 'mine-storage-option--active': storage.mode === 'cloud' }"
            :aria-pressed="storage.mode === 'cloud'"
            @tap="switchStorageMode('cloud')"
          >
            <NoteIcon name="cloud" size="38rpx" />
            <view class="mine-storage-option__copy">
              <text class="mine-storage-option__title">Supabase 云端</text>
              <text class="mine-storage-option__desc">登录后在云端保存，可跨设备访问</text>
            </view>
            <text v-if="storage.mode === 'cloud'" class="mine-storage-option__state">正在使用</text>
            <NoteIcon v-if="storage.mode === 'cloud'" name="check" size="32rpx" />
          </button>
          <text v-else class="mine-storage-unavailable">
            云端模式暂未开放；本机记录仍可正常使用。
          </text>
        </view>

        <text class="mine-section-title">关于</text>
        <view class="mine-section note-card mine-about">
          <view class="mine-row">
            <view class="mine-row__label">
              <NoteIcon name="info" size="34rpx" />
              <text>版本</text>
            </view>
            <text class="mine-row__value">1.0.0</text>
          </view>
        </view>

        <button v-if="storage.mode === 'cloud'" class="note-btn note-btn--danger mine-logout" @tap="logout">
          <NoteIcon name="logout" size="32rpx" />
          退出登录
        </button>
      </view>

      <NoteActionSheet
        v-model:show="confirmOpen"
        :title="pendingAction === 'logout' ? '退出登录' : pendingAction === 'local' ? '切换到本机存储' : '切换到 Supabase 云端'"
        :description="pendingAction === 'logout' ? '退出后需要重新登录才能查看你的笔记。' : pendingAction === 'local' ? '本机与云端笔记各自保存，不会互相搬运。切换后需要重新登录才能查看云端笔记。' : '本机笔记会继续保留在这台设备，不会自动上传。切换后请登录云端账号。'"
        :items="[{ value: 'confirm', label: pendingAction === 'logout' ? '退出登录' : pendingAction === 'local' ? '切换到本机' : '前往登录', icon: pendingAction === 'logout' ? 'logout' : pendingAction === 'local' ? 'phone' : 'cloud', danger: pendingAction === 'logout' }]"
        @select="confirmMineAction"
      />
      <NoteTabBar active="mine" />
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.mine-page {
  padding-bottom: calc(var(--note-tabbar-height) + 48rpx);
}

.mine-body {
  max-width: 760rpx;
  margin: 0 auto;
  padding: calc(132rpx + env(safe-area-inset-top)) 32rpx 0;
}

.mine-profile {
  display: flex;
  align-items: center;
  gap: 28rpx;
  padding: 40rpx 32rpx;
  border-radius: 36rpx;
  background: linear-gradient(135deg, var(--note-surface), var(--note-surface-2));
}

.mine-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: var(--note-accent-soft);
  color: var(--note-accent);
  font-size: var(--note-font-title2);
  font-weight: 700;
}

.mine-profile__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.mine-profile__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--note-text);
  font-size: var(--note-font-title3);
  font-weight: 700;
}

.mine-profile__eyebrow {
  color: var(--note-accent);
  font-size: var(--note-font-caption);
  font-weight: 700;
}

.mine-profile__account {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
}

.mine-stats {
  display: flex;
  align-items: center;
  margin-top: 24rpx;
  padding: 32rpx;
}

.mine-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
}

.mine-stat__value {
  color: var(--note-accent);
  font-size: var(--note-font-title1);
  font-weight: 700;
  line-height: 1.1;
}

.mine-stat__value--small {
  font-size: var(--note-font-subhead);
  line-height: 1.6;
}

.mine-stat__label {
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
}

.mine-stats__divider {
  width: 1rpx;
  height: 72rpx;
  background: var(--note-separator);
}

.mine-section {
  margin-top: 12rpx;
  padding: 8rpx 32rpx 20rpx;
  border-radius: 28rpx;
}

.mine-about {
  padding-bottom: 8rpx;
}

.mine-storage-option {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 104rpx;
  margin: 0;
  padding: 18rpx 0;
  border: 0;
  border-radius: 16rpx;
  color: var(--note-text-2);
  background: transparent;
  text-align: left;
  gap: 18rpx;
}

.mine-storage-option::after {
  border: 0;
}

.mine-storage-option:active {
  background: var(--note-fill);
}

.mine-storage-option--active {
  color: var(--note-accent);
}

.mine-storage-option__copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 5rpx;
}

.mine-storage-option__title {
  color: var(--note-text);
  font-size: var(--note-font-body);
  font-weight: 600;
}

.mine-storage-option__desc {
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  line-height: 1.45;
}

.mine-storage-option__state {
  flex: 0 0 auto;
  color: var(--note-accent);
  font-size: var(--note-font-caption);
  font-weight: 600;
}

.mine-storage-divider {
  height: 1rpx;
  background: var(--note-separator);
}

.mine-storage-unavailable {
  display: block;
  margin-top: 8rpx;
  padding: 18rpx 0 6rpx;
  border-top: 1rpx solid var(--note-separator);
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  line-height: 1.5;
}

.mine-section-title {
  display: block;
  margin: 32rpx 8rpx 0;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}

.mine-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  min-height: 96rpx;
  padding: 12rpx 0;
}

.mine-row--border {
  margin-top: 12rpx;
  border-top: 1rpx solid var(--note-separator);
}

.mine-row__label {
  display: flex;
  align-items: center;
  gap: 16rpx;
  color: var(--note-text);
  font-size: var(--note-font-body);
  font-weight: 500;
}

.mine-row__value {
  color: var(--note-text-2);
  font-size: var(--note-font-subhead);
}

.mine-swatches {
  display: flex;
  gap: 20rpx;
}

.mine-swatch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64rpx;
  height: 64rpx;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  transition: transform var(--note-duration-fast) var(--note-ease), box-shadow var(--note-duration-fast) var(--note-ease);
}

.mine-swatch::after {
  border: 0;
}

.mine-swatch:active {
  transform: scale(0.92);
}

.mine-swatch--active {
  box-shadow: 0 0 0 4rpx var(--note-surface), 0 0 0 8rpx rgba(var(--note-accent-rgb), 0.4);
}

.mine-caption {
  display: block;
  padding: 0 0 8rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
}

.mine-appearance {
  display: flex;
  gap: 4rpx;
  padding: 6rpx;
  border-radius: var(--note-radius-md);
  background: var(--note-fill);
}

.mine-appearance__option {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  margin: 0;
  padding: 0 12rpx;
  border: 0;
  border-radius: var(--note-radius-sm);
  color: var(--note-text-2);
  background: transparent;
  font-size: var(--note-font-footnote);
}

.mine-appearance__option::after { border: 0; }

.mine-appearance__option--active {
  color: var(--note-text);
  background: var(--note-surface);
  box-shadow: var(--note-shadow-sm);
  font-weight: 600;
}

.mine-logout {
  width: 100%;
  margin-top: 48rpx;
}
</style>
