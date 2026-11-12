<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import { useStorageModeStore } from '@/stores/storageMode'

const REMEMBERED_CREDENTIALS_KEY = 'note-login-credentials'

interface RememberedCredentials {
  account: string
  password: string
}

const { themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const notes = useNotesStore()
const storage = useStorageModeStore()

const account = ref('')
const password = ref('')
const rememberPassword = ref(false)
const loading = ref(false)
const error = ref('')

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
  await storage.initialize()
  storage.hydrate()
  if (storage.mode === 'local' || auth.isLoggedIn) {
    uni.reLaunch({ url: '/pages/timeline/index' })
    return
  }
  restoreCredentials()
})

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
  uni.reLaunch({ url: '/pages/timeline/index' })
}

async function submit() {
  if (loading.value) return
  error.value = ''
  const acc = account.value.trim()
  if (!acc) {
    error.value = '请输入邮箱或手机号'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    return
  }
  loading.value = true
  try {
    await auth.login(acc, password.value)
    persistCredentials(acc, password.value)
    uni.reLaunch({ url: '/pages/timeline/index' })
  } catch (loginError) {
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
  if (loading.value) return
  error.value = ''
  loading.value = true
  try {
    await auth.loginWithWechatPhone(code)
    uni.reLaunch({ url: '/pages/timeline/index' })
  } catch (loginError) {
    error.value = getUserFacingErrorMessage(loginError, '微信登录失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
// #endif
</script>

<template>
  <wd-config-provider :theme="themeName">
    <view class="page login-page" :class="[themeClass, { 'note-dark': isDark }]">
      <view class="login-decoration" aria-hidden="true" />
      <view class="login-shell">
        <view class="login-header">
          <view class="login-mark" aria-hidden="true">
            <view class="login-mark__rail" />
            <view class="login-mark__dot login-mark__dot--1" />
            <view class="login-mark__dot login-mark__dot--2" />
            <view class="login-mark__dot login-mark__dot--3" />
          </view>
          <text class="login-eyebrow">时光记事</text>
          <text class="login-title">欢迎回来</text>
          <text class="login-tagline">记录当下，也留住以后想起的此刻。</text>
        </view>

        <view class="login-form note-card">
          <view class="login-field-group">
            <text class="login-field-label">账号</text>
            <view class="login-input-shell">
              <wd-input
                v-model="account"
                custom-class="login-input-control"
                type="text"
                placeholder="邮箱或手机号"
                placeholder-class="login-input-placeholder"
                aria-label="邮箱或手机号"
                autocomplete="username"
                inputmode="email"
                clearable
                :disabled="loading"
                @confirm="submit"
              >
                <template #prefix>
                  <NoteIcon name="mail" size="36rpx" />
                </template>
              </wd-input>
            </view>
          </view>

          <view class="login-field-group login-password">
            <text class="login-field-label">密码</text>
            <view class="login-input-shell">
              <wd-input
                v-model="password"
                custom-class="login-input-control"
                type="safe-password"
                placeholder="请输入密码"
                placeholder-class="login-input-placeholder"
                aria-label="密码"
                autocomplete="current-password"
                confirm-type="done"
                show-password
                clearable
                :disabled="loading"
                @confirm="submit"
              >
                <template #prefix>
                  <NoteIcon name="lock" size="36rpx" />
                </template>
              </wd-input>
            </view>
          </view>

          <view class="login-remember-row">
            <wd-checkbox
              v-model="rememberPassword"
              class="login-remember-control"
              type="square"
              checked-color="var(--note-accent)"
              :disabled="loading"
            >
              记住密码
            </wd-checkbox>
            <text class="login-remember__hint">仅保存在此设备</text>
          </view>

          <text v-if="error" class="login-error" role="alert">{{ error }}</text>

          <wd-button
            type="primary"
            size="large"
            block
            class="login-submit"
            :disabled="loading"
            :loading="loading"
            @click="submit"
          >
            {{ loading ? '登录中…' : '登录' }}
          </wd-button>

          <button class="login-local" :disabled="loading" @tap="startLocalMode">
            <NoteIcon name="phone" size="38rpx" />
            <view class="login-local__copy">
              <text class="login-local__title">使用本机存储</text>
              <text class="login-local__desc">无需登录，记录只保存在这台设备</text>
            </view>
            <NoteIcon name="chevron-right" size="32rpx" />
          </button>

          <!-- #ifdef MP-WEIXIN -->
          <view class="login-divider" aria-hidden="true">
            <view class="login-divider__line" />
            <text class="login-divider__text">其他方式</text>
            <view class="login-divider__line" />
          </view>
          <wd-button
            type="primary"
            variant="soft"
            size="large"
            block
            class="login-wechat"
            :disabled="loading"
            open-type="getPhoneNumber"
            @getphonenumber="onWechatPhone"
          >
            <NoteIcon name="wechat" size="36rpx" />
            微信手机号登录
          </wd-button>
          <!-- #endif -->
        </view>

        <text class="login-hint">云端笔记使用邮箱或手机号登录；本机存储无需账号</text>
      </view>
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.login-page {
  position: relative;
  display: flex;
  justify-content: center;
  padding: calc(72rpx + env(safe-area-inset-top)) 40rpx calc(48rpx + env(safe-area-inset-bottom));
  overflow-x: hidden;
  background: var(--note-bg);
}

.login-decoration {
  position: absolute;
  top: -280rpx;
  right: -240rpx;
  width: 680rpx;
  height: 680rpx;
  border: 1rpx solid rgba(var(--note-accent-rgb), 0.1);
  border-radius: 50%;
  box-shadow: 0 0 0 90rpx rgba(var(--note-accent-rgb), 0.025), 0 0 0 180rpx rgba(var(--note-accent-rgb), 0.018);
  pointer-events: none;
}

.login-shell {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  max-width: 720rpx;
}

.login-local {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 96rpx;
  margin-top: 24rpx;
  padding: 20rpx 24rpx;
  border: 1rpx solid var(--note-separator);
  border-radius: 24rpx;
  background: var(--note-surface-2);
  color: var(--note-accent);
  text-align: left;
  gap: 20rpx;
}

.login-local:active {
  background: var(--note-accent-soft);
}

.login-local__copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4rpx;
}

.login-local__title {
  color: var(--note-text);
  font-size: var(--note-font-body);
  font-weight: 600;
}

.login-local__desc {
  color: var(--note-text-secondary);
  font-size: var(--note-font-caption);
}

.login-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32rpx 16rpx 0;
  text-align: center;
}

.login-mark {
  position: relative;
  width: 88rpx;
  height: 88rpx;
  border-radius: 24rpx;
  background: linear-gradient(145deg, var(--note-accent) 0%, var(--note-accent-strong) 100%);
  box-shadow: var(--note-shadow-accent);
}

.login-mark__rail {
  position: absolute;
  top: 20rpx;
  bottom: 20rpx;
  left: 28rpx;
  width: 5rpx;
  border-radius: 3rpx;
  background: rgba(255, 255, 255, 0.92);
}

.login-mark__dot {
  position: absolute;
  left: 24rpx;
  width: 15rpx;
  height: 15rpx;
  border-radius: 50%;
  background: #ffffff;
}

.login-mark__dot--1 { top: 18rpx; }
.login-mark__dot--2 { top: 37rpx; }
.login-mark__dot--3 { top: 56rpx; }

.login-eyebrow {
  margin-top: 28rpx;
  color: var(--note-accent);
  font-size: var(--note-font-footnote);
  font-weight: 600;
  letter-spacing: 1rpx;
}

.login-title {
  margin-top: 10rpx;
  color: var(--note-text);
  font-size: var(--note-font-large);
  font-weight: 700;
  letter-spacing: -1rpx;
  line-height: 1.2;
}

.login-tagline {
  max-width: 600rpx;
  margin-top: 14rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-subhead);
  line-height: 1.5;
  text-wrap: balance;
}

.login-form {
  width: 100%;
  box-sizing: border-box;
  margin-top: 56rpx;
  padding: 40rpx 32rpx 32rpx;
  border-radius: 36rpx;
  border: 1rpx solid var(--note-separator);
  box-shadow: var(--note-shadow-sm);
}

.login-field-group + .login-field-group {
  margin-top: 28rpx;
}

.login-field-label {
  display: block;
  margin: 0 8rpx 12rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}

.login-input-shell {
  min-height: var(--note-control-height);
  overflow: hidden;
  border: 1rpx solid transparent;
  border-radius: var(--note-radius-md);
  background: var(--note-fill-2);
  transition: border-color var(--note-duration) var(--note-ease), box-shadow var(--note-duration) var(--note-ease);
}

.login-input-shell:focus-within {
  border-color: rgba(var(--note-accent-rgb), 0.5);
  box-shadow: 0 0 0 4rpx rgba(var(--note-accent-rgb), 0.16);
}

:deep(.login-input-control) {
  min-height: var(--note-control-height);
  padding: 0 24rpx;
  box-sizing: border-box;
  color: var(--note-text);
  background: transparent;
  font-size: var(--note-font-body);
}

:deep(.login-input-placeholder) {
  color: var(--note-text-3);
}

.login-remember-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 72rpx;
  margin: 20rpx 0 0;
}

.login-remember__hint {
  margin-left: auto;
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
}

:deep(.login-remember-control) {
  min-height: 56rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
}

:deep(.login-remember-control .wd-checkbox__shape) {
  margin-right: 14rpx;
}

:deep(.login-submit),
:deep(.login-wechat) {
  min-height: var(--note-control-height);
  height: var(--note-control-height);
  border-radius: var(--note-radius-md);
  font-size: var(--note-font-body);
  font-weight: 600;
}

:deep(.login-submit) {
  box-shadow: var(--note-shadow-accent);
}

:deep(.login-wechat) {
  color: var(--note-accent);
}

.login-error {
  display: block;
  margin: 18rpx 8rpx 0;
  color: var(--note-danger);
  font-size: var(--note-font-footnote);
  line-height: 1.45;
}

.login-submit {
  width: 100%;
  margin-top: 28rpx;
}

.login-divider {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin: 32rpx 0 24rpx;
}

.login-divider__line {
  flex: 1;
  height: 1rpx;
  background: var(--note-separator);
}

.login-divider__text {
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
}

.login-wechat {
  width: 100%;
}

.login-hint {
  display: block;
  margin-top: 28rpx;
  padding: 0 20rpx;
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
  line-height: 1.5;
  text-align: center;
}

@media (min-width: 700px) {
  .login-page {
    align-items: center;
  }
}

</style>
