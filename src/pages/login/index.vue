<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'

const { themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()

const account = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')

onLoad(() => {
  if (auth.isLoggedIn) {
    uni.reLaunch({ url: '/pages/timeline/index' })
    return
  }
  const remembered = uni.getStorageSync('note-account')
  if (typeof remembered === 'string') account.value = remembered
})

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
    uni.setStorageSync('note-account', acc)
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
      <view class="login-glow" aria-hidden="true" />
      <view class="login-hero">
        <view class="login-mark" aria-hidden="true">
          <view class="login-mark__rail" />
          <view class="login-mark__dot login-mark__dot--1" />
          <view class="login-mark__dot login-mark__dot--2" />
          <view class="login-mark__dot login-mark__dot--3" />
        </view>
        <text class="login-title">时光记事</text>
        <text class="login-tagline">把每一个瞬间，放进时间里</text>
      </view>

      <view class="login-form note-card">
        <view class="note-field">
          <NoteIcon name="mail" size="36rpx" class="note-field__icon" />
          <input
            v-model="account"
            class="note-field__input"
            type="text"
            placeholder="邮箱或手机号"
            placeholder-class="note-field__placeholder"
            autocomplete="username"
            :disabled="loading"
            @confirm="submit"
          />
        </view>
        <view class="note-field login-password">
          <NoteIcon name="lock" size="36rpx" class="note-field__icon" />
          <input
            v-model="password"
            class="note-field__input"
            :password="!showPassword"
            placeholder="密码"
            placeholder-class="note-field__placeholder"
            autocomplete="current-password"
            confirm-type="done"
            :disabled="loading"
            @confirm="submit"
          />
          <button
            class="login-eye"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            @tap="showPassword = !showPassword"
          >
            <NoteIcon :name="showPassword ? 'eye-off' : 'eye'" size="36rpx" />
          </button>
        </view>

        <text v-if="error" class="login-error" role="alert">{{ error }}</text>

        <button
          class="note-btn note-btn--primary login-submit"
          :class="{ 'is-disabled': loading }"
          :disabled="loading"
          @tap="submit"
        >
          {{ loading ? '登录中…' : '登录' }}
        </button>

        <!-- #ifdef MP-WEIXIN -->
        <view class="login-divider" aria-hidden="true">
          <view class="login-divider__line" />
          <text class="login-divider__text">或</text>
          <view class="login-divider__line" />
        </view>
        <button
          class="note-btn note-btn--secondary login-wechat"
          :class="{ 'is-disabled': loading }"
          :disabled="loading"
          open-type="getPhoneNumber"
          @getphonenumber="onWechatPhone"
        >
          <NoteIcon name="wechat" size="36rpx" />
          微信手机号一键登录
        </button>
        <!-- #endif -->
      </view>

      <text class="login-hint">邮箱或手机号均可登录，与司机端账号通用</text>
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.login-page {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: calc(120rpx + env(safe-area-inset-top)) 48rpx calc(48rpx + env(safe-area-inset-bottom));
  overflow: hidden;
}

.login-glow {
  position: absolute;
  top: -240rpx;
  left: 50%;
  transform: translateX(-50%);
  width: 720rpx;
  height: 720rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--note-accent-rgb), 0.16) 0%, transparent 65%);
  pointer-events: none;
}

.login-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.login-mark {
  position: relative;
  width: 128rpx;
  height: 128rpx;
  border-radius: 32rpx;
  background: linear-gradient(150deg, var(--note-accent) 0%, var(--note-accent-strong) 100%);
  box-shadow: var(--note-shadow-accent);
}

.login-mark__rail {
  position: absolute;
  top: 28rpx;
  bottom: 28rpx;
  left: 40rpx;
  width: 6rpx;
  border-radius: 3rpx;
  background: rgba(255, 255, 255, 0.9);
}

.login-mark__dot {
  position: absolute;
  left: 34rpx;
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
  background: #ffffff;
}

.login-mark__dot--1 {
  top: 26rpx;
}

.login-mark__dot--2 {
  top: 55rpx;
}

.login-mark__dot--3 {
  top: 84rpx;
}

.login-title {
  margin-top: 36rpx;
  color: var(--note-text);
  font-size: var(--note-font-large);
  font-weight: 700;
  letter-spacing: 2rpx;
}

.login-tagline {
  margin-top: 12rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-subhead);
}

.login-form {
  position: relative;
  width: 100%;
  max-width: 640rpx;
  margin-top: 72rpx;
  padding: 40rpx 32rpx;
}

.login-password {
  margin-top: 24rpx;
}

.login-eye {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-text-2);
  background: transparent;
}

.login-error {
  display: block;
  margin-top: 20rpx;
  color: var(--note-danger);
  font-size: var(--note-font-footnote);
  line-height: 1.4;
}

.login-submit {
  width: 100%;
  margin-top: 32rpx;
}

.login-divider {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin: 32rpx 0;
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
  position: relative;
  margin-top: 40rpx;
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
  text-align: center;
}
</style>