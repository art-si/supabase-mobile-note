<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBackPress, onLoad } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteNavBar from '@/components/common/NoteNavBar.vue'
import NoteTabBar from '@/components/common/NoteTabBar.vue'
import NoteActionSheet from '@/components/common/NoteActionSheet.vue'
import NoteSheet from '@/components/common/NoteSheet.vue'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import { useStorageModeStore } from '@/stores/storageMode'
import { APPEARANCE_OPTIONS, THEME_PRESETS } from '@/stores/theme'
import { getSystemInsets } from '@/utils/systemInsets'
import { getAllLocalNotes } from '@/api/localNotes'
import { backupCloudNotes, type BackupProgress } from '@/api/noteBackup'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { getStorageMode } from '@/utils/storageMode'

const { theme, themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const store = useNotesStore()
const storage = useStorageModeStore()
const { top: statusInset, bottom: safeBottom } = getSystemInsets()
const confirmOpen = ref(false)
const transferChoiceOpen = ref(false)
const pendingAction = ref<'local' | 'cloud' | 'logout'>('local')
const localNoteCount = ref(getAllLocalNotes().length)
const backupOpen = ref(false)
const backupBusy = ref(false)
const backupDone = ref(false)
const backupError = ref('')
const emptyBackup = (): BackupProgress => ({ copied: 0, updated: 0, existing: 0, image: 0, images: 0 })
const backupProgress = ref(emptyBackup())
const canBackup = computed(() => storage.mode === 'cloud' && auth.isLoggedIn && auth.cloudAccessGranted)

const account = computed(() => {
  const user = auth.user
  if (!user) return ''
  if (user.email) return user.email
  if (user.phone) return user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  return '已登录'
})

const avatar = computed(() => {
  const metadata = auth.user?.user_metadata
  const candidates = auth.profile ? [auth.profile.avatar] : [metadata?.avatar_url, metadata?.picture, metadata?.avatar]
  const url = candidates.find(
    (value): value is string => typeof value === 'string' && /^https:\/\//i.test(value.trim())
  )
  return url?.trim() || ''
})
const failedAvatar = ref('')
const canPreviewAvatar = computed(() => Boolean(avatar.value && avatar.value !== failedAvatar.value))
const avatarInitial = computed(() => {
  const metadata = auth.user?.user_metadata
  const name = [auth.profile?.nickName, metadata?.display_name, metadata?.full_name, metadata?.name, auth.user?.email].find(
    (value): value is string => typeof value === 'string' && Boolean(value.trim())
  )
  return Array.from(name?.trim() || '云')[0]?.toLocaleUpperCase()
})

onLoad(async () => {
  const initialization = storage.initialize()
  if (storage.mode === 'cloud') {
    await initialization
    if (await auth.ensureValidSession()) {
      void auth.refreshProfile()
      await auth.requireCloudAccess().catch(() => {})
    }
  }
})

function previewAvatar() {
  if (canPreviewAvatar.value) uni.previewImage({ urls: [avatar.value], current: avatar.value })
}

onBackPress(() => {
  if (backupOpen.value) {
    if (!backupBusy.value) backupOpen.value = false
    return true
  }
  if (transferChoiceOpen.value) {
    transferChoiceOpen.value = false
    return true
  }
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
  if (mode === 'cloud' && localNoteCount.value > 0) {
    transferChoiceOpen.value = true
    return
  }
  pendingAction.value = mode
  confirmOpen.value = true
}

function beginCloudLogin(importLocal: boolean) {
  uni.setStorageSync('note-pending-local-import', importLocal ? 'yes' : 'no')
  store.reset()
  auth.clearSession(false)
  if (!storage.setMode('cloud')) {
    uni.removeStorageSync('note-pending-local-import')
    uni.showToast({ title: '云端存储暂未开放，请联系管理员', icon: 'none' })
    return
  }
  uni.reLaunch({ url: '/pages/login/index' })
}

function chooseCloudImport(value: string) {
  transferChoiceOpen.value = false
  beginCloudLogin(value === 'import')
}

function importLocalRecords() {
  uni.setStorageSync('note-pending-local-import', 'yes')
  store.reset()
  uni.reLaunch({ url: '/pages/login/index' })
}

function openBackup() {
  backupDone.value = false
  backupError.value = ''
  backupProgress.value = emptyBackup()
  backupOpen.value = true
}

async function startBackup() {
  const user = auth.user?.id
  if (!canBackup.value || !user || backupBusy.value) return
  backupBusy.value = true
  backupError.value = ''
  backupProgress.value = emptyBackup()
  const assertActive = () => {
    if (!canBackup.value || auth.user?.id !== user || getStorageMode() !== 'cloud') throw new Error('登录状态已变化，备份已暂停')
  }
  try {
    await backupCloudNotes(user, async () => {
      assertActive()
      const token = await store.requireToken()
      assertActive()
      return token
    }, assertActive, value => { backupProgress.value = value })
    backupDone.value = true
  } catch (cause) {
    backupError.value = getUserFacingErrorMessage(cause, '备份未完成，请重试')
  } finally {
    localNoteCount.value = getAllLocalNotes().length
    backupBusy.value = false
  }
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
  if (action === 'cloud') {
    beginCloudLogin(false)
    return
  }
  auth.clearSession(false)
  storage.setMode(action)
  uni.reLaunch({ url: action === 'local' ? '/pages/timeline/index' : '/pages/login/index' })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <view class="page mine-page" :class="[themeClass, { 'note-dark': isDark }]" :style="{ '--note-status-inset': `${statusInset}px`, '--note-safe-bottom': `${safeBottom}px` }">
      <NoteNavBar title="设置" />

      <view class="mine-body">
        <view v-if="storage.mode === 'cloud' && auth.user" class="mine-account note-card">
          <button class="mine-account__avatar" :disabled="!canPreviewAvatar" :aria-label="canPreviewAvatar ? '查看头像大图' : '账号头像'" @tap="previewAvatar">
            <image
              v-if="avatar && avatar !== failedAvatar"
              :key="avatar"
              :src="avatar"
              mode="aspectFill"
              @error="failedAvatar = avatar"
            />
            <text v-else>{{ avatarInitial }}</text>
          </button>
          <view class="mine-account__copy">
            <text class="mine-account__label">{{ auth.profile?.nickName || '云端账号' }}</text>
            <text class="mine-account__value">{{ account }}</text>
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
                <NoteIcon v-if="theme.preset === preset.id" name="check" size="28rpx" color="var(--note-accent-contrast)" />
              </button>
            </view>
          </view>
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
              <text class="mine-storage-option__desc">无需登录，只保存在当前设备</text>
            </view>
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
              <text class="mine-storage-option__title">云端存储</text>
              <text class="mine-storage-option__desc">登录后核实授权，可跨设备查看</text>
            </view>
            <NoteIcon v-if="storage.mode === 'cloud'" name="check" size="32rpx" />
          </button>
          <view v-if="storage.configError" class="mine-storage-unavailable" role="status">
            <text>{{ storage.configError }}</text>
            <button class="note-btn note-btn--plain" :disabled="storage.loading" @tap="storage.initialize(true)">{{ storage.loading ? '获取中…' : '重新获取云端配置' }}</button>
          </view>
          <text v-else-if="!storage.cloudAvailable" class="mine-storage-unavailable">{{ storage.loading ? '正在获取云端配置…' : '云端模式暂未开放' }}</text>
          <button v-if="storage.mode === 'cloud' && localNoteCount > 0" class="mine-import" @tap="importLocalRecords">
            <text>导入本机记录</text>
            <text class="mine-import__count">{{ localNoteCount }} 条</text>
            <NoteIcon name="chevron-right" size="28rpx" />
          </button>
          <button v-if="canBackup" class="mine-import" @tap="openBackup">
            <text>备份到本机</text>
            <text class="mine-import__count">离线查看</text>
            <NoteIcon name="chevron-right" size="28rpx" />
          </button>
        </view>

        <text class="mine-version mine-about">时光记事 · 1.0.1</text>

        <button v-if="storage.mode === 'cloud'" class="note-btn note-btn--danger mine-logout" @tap="logout">
          <NoteIcon name="logout" size="32rpx" />
          退出登录
        </button>
      </view>

      <NoteSheet :show="backupOpen" title="备份到本机" @update:show="!backupBusy && (backupOpen = $event)">
        <view class="mine-backup" :aria-busy="backupBusy">
          <text v-if="!backupBusy && !backupDone && !backupError">将当前账号的笔记和图片复制到这台设备。已有本机笔记会保留；备份后切换到本机存储即可离线查看。</text>
          <text v-if="backupBusy" role="status">{{ backupProgress.images ? `正在下载图片 ${backupProgress.image} / ${backupProgress.images}…` : '正在读取并备份云端笔记…' }}</text>
          <text v-if="backupBusy || backupDone || backupError" role="status">新增 {{ backupProgress.copied }} 条 · 更新 {{ backupProgress.updated }} 条 · 跳过 {{ backupProgress.existing }} 条</text>
          <text v-if="backupDone">{{ backupProgress.copied + backupProgress.updated + backupProgress.existing ? '备份完成。你可以继续使用云端，或切换到本机查看。' : '当前账号没有可备份的云端记录。' }}</text>
          <text v-if="backupError" class="mine-backup__error" role="alert">{{ backupError }}。已备份的笔记会保留。</text>
        </view>
        <template #footer>
          <button class="note-btn note-btn--primary mine-backup__submit" :disabled="backupBusy || (!backupDone && !canBackup)" @tap="backupDone ? (backupOpen = false) : startBackup()">{{ backupBusy ? '备份中…' : backupDone ? '完成' : backupError ? '重试备份' : '开始备份' }}</button>
        </template>
      </NoteSheet>
      <NoteActionSheet
        v-model:show="transferChoiceOpen"
        title="导入本机记录？"
        :description="`检测到 ${localNoteCount} 条本机笔记。导入后会复制到云端，原记录仍保留在本机。`"
        cancel-text="暂不切换"
        :items="[
          { value: 'import', label: '导入本机记录并继续', icon: 'cloud' },
          { value: 'skip', label: '不导入，直接使用云端', icon: 'close' }
        ]"
        @select="chooseCloudImport"
      />
      <NoteActionSheet
        v-model:show="confirmOpen"
        :title="pendingAction === 'logout' ? '退出登录' : pendingAction === 'local' ? '切换到本机存储' : '切换到 云端存储'"
        :description="pendingAction === 'logout' ? '退出后需要重新登录才能查看你的云端笔记。' : pendingAction === 'local' ? '切换后查看这台设备上的记录，云端记录仍会保留。' : '登录后可在云端保存记录，并在其他设备继续使用。'"
        :items="[{ value: 'confirm', label: pendingAction === 'logout' ? '退出登录' : pendingAction === 'local' ? '切换到本机' : '前往登录', icon: pendingAction === 'logout' ? 'logout' : pendingAction === 'local' ? 'phone' : 'cloud', danger: pendingAction === 'logout' }]"
        @select="confirmMineAction"
      />
      <NoteTabBar active="mine" />
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.mine-page {
  padding-bottom: calc(var(--note-tabbar-height) + var(--note-inset-bottom) + 48rpx);
  background: radial-gradient(ellipse at 90% 0%, rgba(var(--note-accent-rgb), .09), transparent 65%) top / 100% 300px no-repeat, var(--note-bg);
}

.mine-body {
  max-width: 760rpx;
  margin: 0 auto;
  padding: calc(var(--note-nav-height) + 16px) 32rpx 0;
}

.mine-account {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: linear-gradient(110deg, var(--note-surface) 62%, rgba(var(--note-accent-rgb), .09));
}

.mine-account__avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border-radius: 50%;
  background: var(--note-accent-soft);
  box-shadow: 0 0 0 3px var(--note-surface), 0 0 0 4px rgba(var(--note-accent-rgb), .20);
  color: var(--note-accent);
  font-size: var(--note-font-title3);
  font-weight: 600;
  margin: 0;
  padding: 0;
  border: 0;
  line-height: 1;
}
.mine-account__avatar::after { border: 0; }
.mine-account__avatar:active:not([disabled]) { transform: scale(.96); }

.mine-account__avatar image {
  width: 100%;
  height: 100%;
}

.mine-body > .mine-section-title:first-child {
  margin-top: 0;
}
.mine-account__copy {
  display: grid;
  gap: 8rpx;
  min-width: 0;
}
.mine-account__label {
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
}
.mine-account__value {
  color: var(--note-text);
  font-size: var(--note-font-body);
  overflow-wrap: anywhere;
}
.mine-version {
  display: block;
  margin-top: 32rpx;
  text-align: center;
  color: var(--note-text-3);
  font-size: var(--note-font-footnote);
}

.mine-section {
  margin-top: 12rpx;
  padding: 8rpx 32rpx 20rpx;
  border-radius: 28rpx;
  box-shadow: var(--note-shadow-sm);
}
.mine-import {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  margin: 8px 0 0;
  padding: 8px 0;
  border: 0;
  border-top: 1px solid var(--note-separator);
  background: transparent;
  color: var(--note-accent);
  text-align: left;
  font-size: var(--note-font-subhead);
}
.mine-import::after { border: 0; }
.mine-import:active { opacity: .65; }
.mine-import__count { margin-left: auto; color: var(--note-text-2); font-size: var(--note-font-footnote); }
.mine-backup { display: grid; gap: 12px; padding: 8px 16px 16px; color: var(--note-text-2); font-size: var(--note-font-subhead); line-height: 1.55; }
.mine-backup__error { color: var(--note-danger); }
.mine-backup__submit { width: 100%; }

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
  margin: 32rpx 16rpx 12rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}

.mine-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx 24rpx;
  min-height: 96rpx;
  padding: 12rpx 0;
}

.mine-row--border {
  margin-top: 12rpx;
  border-top: 1rpx solid var(--note-separator);
}

.mine-row__label {
  display: flex;
  min-width: 0;
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
  flex: none;
  gap: 12rpx;
  margin-left: auto;
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

.mine-appearance {
  display: flex;
  gap: 4rpx;
  padding: 6rpx;
  border-radius: var(--note-radius-md);
  background: var(--note-fill);
}

.mine-appearance__option {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  margin: 0;
  padding: 8rpx 12rpx;
  border: 0;
  border-radius: var(--note-radius-sm);
  color: var(--note-text-2);
  background: transparent;
  font-size: var(--note-font-footnote);
  line-height: 1.2;
  transition:
    color var(--note-duration-fast) var(--note-ease),
    background-color var(--note-duration-fast) var(--note-ease),
    box-shadow var(--note-duration-fast) var(--note-ease);
}

.mine-appearance__option::after {
  border: 0;
}

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
