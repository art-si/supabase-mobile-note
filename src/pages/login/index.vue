<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { usePageTheme } from '@/composables/usePageTheme'
import { CLOUD_ACCESS_DENIED, useAuthStore } from '@/stores/auth'
import { useNotesStore, type LocalImportProgress } from '@/stores/notes'
import { useStorageModeStore } from '@/stores/storageMode'
import { getSystemInsets } from '@/utils/systemInsets'
// #ifdef H5
import brandMarkAsset from '@/static/favicon.svg'
// #endif
let brandMark = '/static/favicon.svg'
// #ifdef H5
brandMark = brandMarkAsset
// #endif

const REMEMBERED_CREDENTIALS_KEY = 'note-login-credentials'

interface RememberedCredentials {
  account: string
  password: string
}

const { themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const notes = useNotesStore()
const storage = useStorageModeStore()
const { top: statusInset, bottom: safeBottom } = getSystemInsets()

const account = ref('')
const password = ref('')
const rememberPassword = ref(false)
const loading = ref(false)
const error = ref('')
const closed = computed(() => !storage.loading && !storage.configError && !storage.cloudAvailable)
const invalidField = ref<'account' | 'password' | ''>('')
const focusedField = ref<'account' | 'password' | ''>('')
const stage = ref<'login' | 'import'>('login')
const importing = computed(() => stage.value === 'import')
const importProgress = ref<LocalImportProgress | null>(null)
const importFailed = ref(false)
const buttonLabel = computed(() => loading.value ? stage.value === 'import' ? '正在导入…' : '正在登录…' : importFailed.value ? '继续导入' : '登录云端')
const importPercent = computed(() => importProgress.value?.total ? importProgress.value.completed / importProgress.value.total * 100 : 0)
const importDetail = computed(() => {
  const progress = importProgress.value
  if (!progress) return '正在读取本机记录…'
  return `已保存 ${progress.completed} / ${progress.total} 条记录`
})
watch([account, password], () => { if (invalidField.value) { invalidField.value = ''; error.value = '' } })

function parseCredentials(value: unknown): RememberedCredentials | null {
  let candidate = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return null
    }
  }
  if (!candidate || typeof candidate !== 'object') return null
  const next = candidate as Partial<RememberedCredentials>
  if (typeof next.account !== 'string' || typeof next.password !== 'string') return null
  if (!next.account.trim() || !next.password) return null
  return { account: next.account, password: next.password }
}

function restoreCredentials() {
  const remembered = parseCredentials(uni.getStorageSync(REMEMBERED_CREDENTIALS_KEY))
  if (remembered) {
    account.value = remembered.account
    password.value = remembered.password
    rememberPassword.value = true
    return
  }

  const rememberedAccount = uni.getStorageSync('note-account')
  if (typeof rememberedAccount === 'string') account.value = rememberedAccount
}

onLoad(async () => {
  loading.value = true
  try {
    await storage.initialize()
    storage.hydrate()
    if (storage.mode === 'local') {
      uni.reLaunch({ url: '/pages/timeline/index' })
      return
    }
    if (closed.value) {
      error.value = '云端存储暂未开放，你可以继续使用本机存储。'
      return
    }
    auth.hydrate()
    if (auth.isLoggedIn) {
      const valid = await auth.ensureValidSession(false)
      if (valid) {
        try {
          await finishCloudEntry()
          return
        } catch (entryError) {
          importFailed.value = importing.value && !auth.cloudAccessDenied && auth.isLoggedIn
          error.value = getUserFacingErrorMessage(entryError, '暂时无法进入云端，请重试')
        }
      }
    }
    restoreCredentials()
  } finally {
    loading.value = false
  }
})

async function finishCloudEntry() {
  await auth.requireCloudAccess()
  if (uni.getStorageSync('note-pending-local-import') === 'yes') {
    stage.value = 'import'
    const result = await notes.importLocalToCloud(auth.token, auth.user?.id || '', progress => { importProgress.value = progress })
    uni.removeStorageSync('note-pending-local-import')
    const message = !result.total ? '当前设备没有可导入的本机记录' : result.added
      ? `已新增 ${result.added} 条，云端已有 ${result.existing} 条`
      : `已核对，${result.existing} 条记录均已在云端`
    uni.showToast({ title: message, icon: 'none', duration: 3500 })
  } else {
    uni.removeStorageSync('note-pending-local-import')
  }
  uni.reLaunch({ url: '/pages/timeline/index' })
}

function persistCredentials(acc: string, secret: string) {
  uni.setStorageSync('note-account', acc)
  if (rememberPassword.value) {
    uni.setStorageSync(REMEMBERED_CREDENTIALS_KEY, JSON.stringify({ account: acc, password: secret }))
  } else {
    uni.removeStorageSync(REMEMBERED_CREDENTIALS_KEY)
  }
}

function startLocalMode() {
  notes.reset()
  auth.clearSession(false)
  storage.setMode('local')
  uni.removeStorageSync('note-pending-local-import')
  uni.reLaunch({ url: '/pages/timeline/index' })
}

async function submit() {
  if (loading.value || closed.value) return
  error.value = ''
  invalidField.value = ''
  const continuing = importFailed.value && auth.isLoggedIn
  const acc = account.value.trim()
  if (!continuing && !acc) {
    invalidField.value = 'account'
    focusedField.value = 'account'
    error.value = '请输入邮箱或手机号'
    return
  }
  if (!continuing && !password.value) {
    invalidField.value = 'password'
    focusedField.value = 'password'
    error.value = '请输入密码'
    return
  }
  loading.value = true
  stage.value = 'login'
  try {
    if (continuing) {
      if (!await auth.ensureValidSession(false)) throw new Error('登录已过期，请重新登录后继续导入')
    } else {
      await auth.login(acc, password.value)
      persistCredentials(acc, password.value)
    }
    await finishCloudEntry()
  } catch (loginError) {
    importFailed.value = importing.value && !auth.cloudAccessDenied && auth.isLoggedIn
    if (loginError instanceof Error && loginError.message === CLOUD_ACCESS_DENIED) stage.value = 'login'
    error.value = getUserFacingErrorMessage(loginError, '登录失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

// #ifdef MP-WEIXIN
async function onWechatPhone(event: { detail?: { code?: string } }) {
  const code = event.detail?.code
  if (!code) {
    error.value = '已取消微信授权'
    return
  }
  if (loading.value || closed.value) return
  error.value = ''
  loading.value = true
  try {
    await auth.loginWithWechatPhone(code)
    await finishCloudEntry()
  } catch (loginError) {
    if (auth.cloudAccessDenied) stage.value = 'login'
    error.value = getUserFacingErrorMessage(loginError, '微信登录失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
// #endif
</script>

<template>
  <wd-config-provider :theme="themeName">
    <view class="page login-page" :class="[themeClass, { 'note-dark': isDark }]" :style="{ '--note-status-inset': `${statusInset}px`, '--note-safe-bottom': `${safeBottom}px` }">
      <view class="login-shell">
        <view class="login-header">
          <view class="login-brand">
            <image class="login-mark" :src="brandMark" mode="aspectFit" aria-hidden="true" />
            <text class="login-brand__name">时光记事</text>
          </view>
          <text class="login-title">登录云端</text>
          <text class="login-tagline">在不同设备上，继续你的记录。</text>
        </view>
        <view class="login-form">
          <view class="login-field-group">
            <text class="login-field-label">账号</text>
            <view class="login-input-shell" :class="{ 'login-input-shell--error': invalidField === 'account' }">
              <wd-input v-model="account" custom-class="login-input-control" type="text" placeholder="邮箱或手机号" aria-label="邮箱或手机号" autocomplete="username" clearable :focus="focusedField === 'account'" :disabled="loading" @focus="focusedField = 'account'" @blur="focusedField = ''" @confirm="focusedField = 'password'">
                <template #prefix><NoteIcon name="mail" size="36rpx" /></template>
              </wd-input>
            </view>
            <text v-if="invalidField === 'account'" class="login-error" role="alert">{{ error }}</text>
          </view>
          <view class="login-field-group">
            <text class="login-field-label">密码</text>
            <view class="login-input-shell" :class="{ 'login-input-shell--error': invalidField === 'password' }">
              <wd-input v-model="password" custom-class="login-input-control" type="safe-password" placeholder="请输入密码" aria-label="密码" autocomplete="current-password" confirm-type="done" show-password :focus="focusedField === 'password'" :disabled="loading" @focus="focusedField = 'password'" @blur="focusedField = ''" @confirm="submit">
                <template #prefix><NoteIcon name="lock" size="36rpx" /></template>
              </wd-input>
            </view>
            <text v-if="invalidField === 'password'" class="login-error" role="alert">{{ error }}</text>
          </view>
          <view class="login-remember-row">
            <wd-checkbox v-model="rememberPassword" class="login-remember-control" type="square" checked-color="var(--note-accent)" :disabled="loading">记住密码</wd-checkbox>
            <text class="login-remember__hint">仅在这台设备</text>
          </view>
          <view v-if="stage === 'import'" class="login-import" :aria-busy="loading">
            <text class="login-import__title" role="status" aria-live="polite">{{ importFailed ? '导入已暂停' : importProgress?.phase === 'checking' ? '已登录，正在核对云端记录' : importProgress?.phase === 'complete' ? '导入完成' : '已登录，正在导入本机记录' }}</text>
            <view class="login-import__track" role="progressbar" aria-label="本机笔记导入进度" :aria-valuenow="importProgress?.completed || 0" :aria-valuemax="importProgress?.total || 1" aria-valuemin="0">
              <view class="login-import__fill" :style="{ transform: `scaleX(${importPercent / 100})` }" />
            </view>
            <text class="login-import__detail">{{ importDetail }}</text>
            <text v-if="importProgress?.phase === 'image'" class="login-import__detail">
              第 {{ importProgress.completed + 1 }} 条 · 图片 {{ importProgress.imageIndex }}/{{ importProgress.imageTotal }} · 上传 {{ importProgress.imagePercent }}%
            </text>
            <text class="login-import__hint">本机原始记录会保留，已完成的记录不会重复导入。</text>
          </view>
          <text v-if="error && !invalidField" class="login-error" role="alert">{{ error }}</text>
          <wd-button type="primary" size="large" block class="login-submit" :disabled="loading || closed" :loading="loading" @click="submit">{{ buttonLabel }}</wd-button>
          <!-- #ifdef MP-WEIXIN -->
          <wd-button type="primary" variant="soft" size="large" block class="login-wechat" :disabled="loading || closed" open-type="getPhoneNumber" @getphonenumber="onWechatPhone"><NoteIcon name="wechat" size="36rpx" />微信手机号登录</wd-button>
          <!-- #endif -->
          <button class="login-local" :disabled="loading" @tap="startLocalMode">暂不登录，使用本机</button>
          <text class="login-hint">本机笔记只保存在当前设备</text>
        </view>
      </view>
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.login-page {
  display: flex;
  justify-content: center;
  padding: calc(clamp(24px, 6vh, 64px) + var(--note-inset-top)) calc(40rpx + var(--note-inset-right)) calc(48rpx + var(--note-inset-bottom)) calc(40rpx + var(--note-inset-left));
  background: radial-gradient(ellipse at 86% 0%, rgba(var(--note-accent-rgb), .14), transparent 62%) top / 100% min(460px, 65vh) no-repeat, var(--note-bg);
}
.login-shell {
  width: 100%;
  max-width: 400px;
}
.login-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16rpx 8rpx 44rpx;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 22rpx;
  margin-bottom: 36rpx;
}
.login-brand__name {
  color: var(--note-accent);
  font-size: var(--note-font-subhead);
  font-weight: 700;
  letter-spacing: .06em;
}
.login-mark {
  display: block;
  width: 60px;
  height: 60px;
  border-radius: 15px;
  box-shadow: 0 10px 24px rgba(0, 122, 255, .18);
}
.login-title {
  color: var(--note-text);
  font-size: max(76rpx, 38px);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: var(--note-track-large);
}
.login-tagline {
  margin-top: 16rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-subhead);
  line-height: 1.5;
}
.login-form {
  width: 100%;
  padding: clamp(14px, 5vw, 22px);
  border: 1px solid var(--note-separator);
  border-radius: 24px;
  background: var(--note-surface);
  box-shadow: var(--note-shadow-md);
}
.login-field-group + .login-field-group {
  margin-top: 28rpx;
}
.login-field-label {
  display: block;
  margin: 0 0 12rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}
.login-input-shell {
  min-height: 52px;
  border: 1rpx solid var(--note-separator);
  border-radius: var(--note-radius-md);
  background: var(--note-fill-2);
  transition: border-color var(--note-duration-fast) var(--note-ease), box-shadow var(--note-duration-fast) var(--note-ease);
}
.login-input-shell:focus-within {
  border-color: var(--note-accent);
  box-shadow: 0 0 0 3px var(--note-accent-soft);
}
.login-input-shell--error {
  border-color: var(--note-danger);
}
:deep(.login-input-control) {
  min-height: 52px;
  padding: 0 24rpx;
  box-sizing: border-box;
  color: var(--note-text);
  background: transparent;
  font-size: var(--note-font-body);
}
.login-remember-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
  margin-top: 16rpx;
  min-height: 44px;
}
:deep(.login-remember-control) {
  display: flex;
  align-items: center;
  min-height: 44px;
  font-size: var(--note-font-footnote);
}
.login-remember__hint, .login-hint {
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
}
.login-submit, .login-wechat {
  margin-top: 24rpx;
}
:deep(.login-submit), :deep(.login-wechat) {
  min-height: 48px;
  height: 48px;
  border-radius: var(--note-radius-md);
  font-size: var(--note-font-body);
  font-weight: 600;
}
:deep(.login-submit:not([disabled])) {
  background: var(--note-accent-finish);
  color: var(--note-accent-contrast);
  box-shadow: var(--note-shadow-accent);
}
.login-local {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 48px;
  padding: 8rpx;
  margin: 20rpx 0 0;
  border: 0;
  border-radius: var(--note-radius-md);
  background: transparent;
  color: var(--note-accent);
  font-size: var(--note-font-subhead);
}
.login-local::after {
  border: 0;
}
.login-local:active {
  background: var(--note-fill);
}
.login-hint {
  display: block;
  text-align: center;
  margin-top: 4rpx;
  line-height: 1.5;
}
.login-error {
  display: block;
  margin: 12rpx 0 0;
  color: var(--note-danger);
  font-size: var(--note-font-footnote);
  line-height: 1.5;
}
.login-import {
  margin: 24rpx 0 8rpx;
  padding: 24rpx;
  border-radius: var(--note-radius-md);
  background: var(--note-accent-soft);
}
.login-import__title {
  display: block;
  font-size: var(--note-font-subhead);
  font-weight: 600;
  color: var(--note-text);
}
.login-import__track {
  height: 4px;
  overflow: hidden;
  border-radius: 4px;
  margin: 20rpx 0 12rpx;
  background: var(--note-fill);
}
.login-import__fill {
  width: 100%;
  height: 100%;
  transform-origin: left center;
  background: var(--note-accent);
  transition: transform var(--note-duration) var(--note-ease);
}
.login-import__detail {
  display: block;
  font-size: var(--note-font-footnote);
  color: var(--note-text);
  font-variant-numeric: tabular-nums;
}
.login-import__hint {
  display: block;
  margin-top: 8rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  line-height: 1.5;
}
@media (min-width: 700px) and (min-height: 700px) { .login-page { align-items: center; } }
@media (max-height: 600px) and (orientation: landscape) {
  .login-header { padding-top: 0; padding-bottom: 24rpx; }
  .login-brand { margin-bottom: 12rpx; }
  .login-mark { width: 40px; height: 40px; border-radius: 10px; }
}
</style>
