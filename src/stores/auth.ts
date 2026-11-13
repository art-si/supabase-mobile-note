import { defineStore } from 'pinia'
import { accountPasswordLogin, refreshToken, signOut, wechatPhoneLogin } from '@/api/supabase'
import { fetchCloudStorageAccess } from '@/api/storageConfig'
import { getAccountProfile, type AccountProfile } from '@/api/account'
import type { Session } from '@/api/types'
import { isLocalStorageMode } from '@/utils/storageMode'

const STORAGE_KEY = 'note-session'
const LOGIN_URL = '/pages/login/index'
const LOGIN_ROUTE = 'pages/login/index'

let refreshSessionPromise: Promise<void> | null = null
let accessCheck: { token: string; result: Promise<void> } | null = null
export const CLOUD_ACCESS_DENIED = '当前账号未获云端存储授权，请联系管理员，或继续使用本机存储。'

interface AuthState {
  session: Session | null
  profile: AccountProfile | null
  booted: boolean
  cloudAccessDenied: boolean
  cloudAccessGranted: boolean
}

function tokenExpiry(token: string): number | undefined {
  try {
    const part = token.split('.')[1]
    if (!part) return
    const encoded = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    const decoded = typeof atob === 'function' ? atob(padded)
      : String.fromCharCode(...new Uint8Array(uni.base64ToArrayBuffer(padded)))
    const payload: unknown = JSON.parse(decoded)
    if (payload && typeof payload === 'object' && 'exp' in payload && typeof payload.exp === 'number' && Number.isFinite(payload.exp)) return payload.exp
  } catch { /* Opaque tokens use the session metadata. Server authentication remains authoritative. */ }
}

function normalizeSession(session: Session | null) {
  if (!session) return null
  if (!session.expires_at && session.expires_in) {
    session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in
  }
  return session
}

function isLoginPage() {
  const pages = getCurrentPages()
  return pages[pages.length - 1]?.route === LOGIN_ROUTE
}

function redirectToLogin() {
  if (isLoginPage()) return
  // 启动时 App 与首页可能同时触发跳转，被取消的导航会 reject，属预期，忽略即可。
  uni.reLaunch({ url: LOGIN_URL }).catch(() => {})
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    session: null,
    profile: null,
    booted: false,
    cloudAccessDenied: false,
    cloudAccessGranted: false
  }),
  getters: {
    token: (state) => state.session?.access_token || '',
    user: (state) => state.session?.user || null,
    isLoggedIn: (state) => Boolean(state.session?.access_token)
  },
  actions: {
    hydrate() {
      if (this.booted) return
      const cached = uni.getStorageSync(STORAGE_KEY)
      if (cached) {
        try {
          this.session = normalizeSession(typeof cached === 'string' ? JSON.parse(cached) : cached)
        } catch {
          this.session = null
        }
      }
      try {
        const cachedProfile: unknown = uni.getStorageSync('note-account-profile')
        const value: unknown = typeof cachedProfile === 'string' ? JSON.parse(cachedProfile) : cachedProfile
        if (value && typeof value === 'object' && 'userId' in value && value.userId === this.user?.id &&
          'avatar' in value && (value.avatar === null || typeof value.avatar === 'string') &&
          'nickName' in value && typeof value.nickName === 'string') {
          this.profile = { avatar: value.avatar, nickName: value.nickName }
        }
      } catch (cause) {
        console.warn('[account] unable to restore cached profile', cause)
      }
      this.booted = true
    },
    persist() {
      if (this.session) {
        uni.setStorageSync(STORAGE_KEY, JSON.stringify(this.session))
      } else {
        uni.removeStorageSync(STORAGE_KEY)
      }
    },
    clearSession(redirect = false) {
      this.session = null
      this.profile = null
      this.cloudAccessDenied = false
      this.cloudAccessGranted = false
      this.persist()
      if (redirect) redirectToLogin()
    },
    async ensureValidSession(redirect = true) {
      if (isLocalStorageMode()) return true
      this.hydrate()
      if (!this.token) {
        this.clearSession(redirect)
        return false
      }
      const expiresAt = tokenExpiry(this.token) ?? this.session?.expires_at
      if (expiresAt && expiresAt * 1000 - Date.now() >= 180_000) return true

      try {
        await this.refreshSession(redirect)
        return Boolean(this.token)
      } catch {
        return false
      }
    },
    async login(account: string, password: string) {
      this.session = normalizeSession(await accountPasswordLogin(account.trim(), password))
      this.profile = null
      this.cloudAccessDenied = false
      this.cloudAccessGranted = false
      this.persist()
      return this.session
    },
    async refreshProfile() {
      const userId = this.user?.id
      const token = this.token
      if (!userId || !token) return
      try {
        const profile = await getAccountProfile(token, userId)
        if (this.user?.id !== userId) return
        this.profile = profile
        if (profile) uni.setStorageSync('note-account-profile', JSON.stringify({ userId, ...profile }))
      } catch (cause) {
        console.warn('[account] unable to refresh profile', cause)
      }
    },
    async requireCloudAccess(): Promise<void> {
      const token = this.token
      if (!token) throw new Error('登录已过期，请重新登录')
      if (accessCheck?.token === token) return accessCheck.result
      const result = (async () => {
        const access = await fetchCloudStorageAccess(token)
        if (this.token !== token) throw new Error('登录状态已变化，请重新登录')
        this.cloudAccessDenied = access === 'closed' || access === 'denied'
        this.cloudAccessGranted = access === 'allowed'
        if (this.cloudAccessDenied) throw new Error(CLOUD_ACCESS_DENIED)
        if (access !== 'allowed') throw new Error('无法核实云端存储权限，请重新登录')
      })().finally(() => {
        if (accessCheck?.token === token) accessCheck = null
      })
      accessCheck = { token, result }
      return result
    },
    async loginWithWechatPhone(phoneCode: string) {
      this.session = normalizeSession(await wechatPhoneLogin(phoneCode))
      this.profile = null
      this.cloudAccessDenied = false
      this.cloudAccessGranted = false
      this.persist()
      return this.session
    },
    async refreshSession(redirect = true) {
      if (refreshSessionPromise) return refreshSessionPromise

      if (!this.session?.refresh_token) {
        this.clearSession(redirect)
        throw new Error('登录已过期，请重新登录')
      }

      const currentRefreshToken = this.session.refresh_token
      refreshSessionPromise = (async () => {
        try {
          const nextSession = normalizeSession(await refreshToken(currentRefreshToken))
          if (!nextSession?.access_token) throw new Error('登录已过期，请重新登录')
          if (!this.session || this.session.refresh_token !== currentRefreshToken) return
          this.session = nextSession
          this.persist()
        } catch (error) {
          this.clearSession(redirect)
          throw error
        } finally {
          refreshSessionPromise = null
        }
      })()

      return refreshSessionPromise
    },
    async logout() {
      if (this.session?.access_token) {
        try {
          await signOut(this.session.access_token)
        } catch {
          // 远端登出失败时仍清理本地凭证。
        }
      }
      this.clearSession(true)
    }
  }
})
