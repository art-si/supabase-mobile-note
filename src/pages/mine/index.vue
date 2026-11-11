<script setup lang="ts">
import { computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteNavBar from '@/components/common/NoteNavBar.vue'
import NoteTabBar from '@/components/common/NoteTabBar.vue'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import { THEME_PRESETS } from '@/stores/theme'
import { dayKey, formatDayKey } from '@/utils/format'

const { theme, themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const store = useNotesStore()

const account = computed(() => {
  const user = auth.user
  if (!user) return ''
  if (user.email) return user.email
  if (user.phone) return user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  return ''
})

const displayName = computed(() => {
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

function logout() {
  uni.showModal({
    title: '退出登录',
    content: '退出后需要重新登录才能查看你的笔记',
    confirmText: '退出',
    confirmColor: '#ff3b30',
    cancelText: '取消',
    success: async ({ confirm }) => {
      if (!confirm) return
      store.reset()
      await auth.logout()
    }
  })
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
              <text>深色模式</text>
            </view>
            <text class="mine-row__value">跟随系统</text>
          </view>
          <text class="mine-caption">随系统外观自动切换，无需手动设置</text>
        </view>

        <view class="mine-section note-card">
          <view class="mine-row">
            <view class="mine-row__label">
              <NoteIcon name="info" size="34rpx" />
              <text>版本</text>
            </view>
            <text class="mine-row__value">1.0.0</text>
          </view>
          <view class="mine-row mine-row--border">
            <view class="mine-row__label">
              <NoteIcon name="journal" size="34rpx" />
              <text>数据存储</text>
            </view>
            <text class="mine-row__value">Supabase 云端</text>
          </view>
        </view>

        <button class="note-btn note-btn--danger mine-logout" @tap="logout">
          <NoteIcon name="logout" size="32rpx" />
          退出登录
        </button>
      </view>

      <NoteTabBar active="mine" />
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.mine-page {
  padding-bottom: calc(var(--note-tabbar-height) + 48rpx);
}

.mine-body {
  padding: calc(112rpx + env(safe-area-inset-top)) 32rpx 0;
}

.mine-profile {
  display: flex;
  align-items: center;
  gap: 28rpx;
  padding: 36rpx 32rpx;
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
  margin-top: 24rpx;
  padding: 8rpx 32rpx 20rpx;
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

.mine-swatch:active {
  transform: scale(0.92);
}

.mine-swatch--active {
  box-shadow: 0 0 0 4rpx var(--note-surface), 0 0 0 8rpx rgba(var(--note-accent-rgb), 0.4);
}

.mine-caption {
  display: block;
  padding: 0 0 8rpx;
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
}

.mine-logout {
  width: 100%;
  margin-top: 48rpx;
}
</style>