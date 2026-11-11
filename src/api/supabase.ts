import type { Session } from './types'

export const SUPABASE_URL =
  // #ifdef MP-WEIXIN
  import.meta.env.VITE_SUPABASE_MP_URL ||
  // #endif
  import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  token?: string
  headers?: Record<string, string>
  raw?: boolean
}

interface ApiErrorDetails {
  code?: string
  message: string
}

const TECHNICAL_ERROR_PATTERN =
  /(?:function|operator|column|relation|record|type).*?(?:does not exist|has no field)|schema cache|postgrest|pgrst\d+|sqlstate|duplicate key value|violates .* constraint|invalid input syntax|failed to run sql query|unexpected token|WECHAT_MP_(?:APPID|SECRET)/i
const NETWORK_ERROR_PATTERN = /request:fail|failed to fetch|network error|network request failed/i

export class ApiRequestError extends Error {
  readonly code?: string
  readonly technicalMessage: string
  readonly isTechnical: boolean

  constructor(data: unknown, fallback = '请求失败，请稍后重试') {
    const details = getApiErrorDetails(data)
    const isTechnical = TECHNICAL_ERROR_PATTERN.test(`${details.code || ''} ${details.message}`)
    super(isTechnical ? fallback : normalizeKnownError(details.message, fallback))
    this.name = 'ApiRequestError'
    this.code = details.code
    this.technicalMessage = details.message
    this.isTechnical = isTechnical
  }
}

function getApiErrorDetails(data: unknown): ApiErrorDetails {
  if (data instanceof ApiRequestError) {
    return { code: data.code, message: data.technicalMessage }
  }
  if (data instanceof Error) return { message: data.message }
  if (typeof data === 'string') return { message: data }
  if (data && typeof data === 'object') {
    const payload = data as Record<string, unknown>
    const message = [payload.message, payload.msg, payload.error, payload.details].find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim())
    )
    return {
      code: typeof payload.code === 'string' ? payload.code : undefined,
      message: message || ''
    }
  }
  return { message: '' }
}

function normalizeKnownError(message: string, fallback: string) {
  if (!message) return fallback
  if (/invalid login credentials|invalid email or password/i.test(message)) return '账号或密码错误'
  if (/jwt expired|token.*expired|invalid jwt/i.test(message)) return '登录已过期，请重新登录'
  if (/permission denied|row-level security|not authorized|unauthorized/i.test(message)) {
    return '暂无权限执行此操作'
  }
  if (/too many requests|rate limit/i.test(message)) return '操作过于频繁，请稍后重试'
  if (/timeout|timed out/i.test(message)) return '请求超时，请稍后重试'
  if (/not in domain list|域名不在合法域名列表/i.test(message)) {
    return '小程序请求域名未配置，请联系管理员'
  }
  if (NETWORK_ERROR_PATTERN.test(message)) return '网络连接异常，请检查网络后重试'
  if (!/[\u3400-\u9fff]/u.test(message)) return fallback
  return message
}

export function getUserFacingErrorMessage(error: unknown, fallback = '请求失败，请稍后重试') {
  if (error instanceof ApiRequestError) return error.isTechnical ? fallback : error.message
  const details = getApiErrorDetails(error)
  if (TECHNICAL_ERROR_PATTERN.test(`${details.code || ''} ${details.message}`)) return fallback
  return normalizeKnownError(details.message, fallback)
}

function trimSlash(value: string) {
  return value.replace(/\/$/, '')
}

export function toCamelKey(value: string) {
  return value.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

export function toSnakeKey(value: string) {
  return value
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
}

export function keysToCamel<T>(input: unknown): T {
  if (Array.isArray(input)) return input.map((item) => keysToCamel(item)) as T
  if (!input || typeof input !== 'object' || input.constructor !== Object) return input as T
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      toCamelKey(key),
      keysToCamel(value)
    ])
  ) as T
}

export function keysToSnake<T>(input: unknown): T {
  if (Array.isArray(input)) return input.map((item) => keysToSnake(item)) as T
  if (!input || typeof input !== 'object' || input.constructor !== Object) return input as T
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      toSnakeKey(key),
      keysToSnake(value)
    ])
  ) as T
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const pairs = Object.entries(params).filter(([, value]) => value !== undefined && value !== '')
  if (pairs.length === 0) return ''
  return `?${pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')}`
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || 'GET'
  const uniMethod = method as unknown as UniApp.RequestOptions['method']
  const url = path.startsWith('http') ? path : `${trimSlash(SUPABASE_URL)}${path}`
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${options.token || SUPABASE_KEY}`,
    ...options.headers
  }

  if (!options.raw) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json'
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: uniMethod,
      header: headers,
      timeout: 30000,
      data: options.body as UniApp.RequestOptions['data'],
      success(response) {
        const statusCode = response.statusCode || 0
        if (statusCode >= 200 && statusCode < 300) {
          resolve(response.data as T)
          return
        }
        const requestError = new ApiRequestError(response.data)
        console.warn('[api] request failed', {
          path,
          statusCode,
          code: requestError.code,
          message: requestError.technicalMessage
        })
        reject(requestError)
      },
      fail(error) {
        console.warn('[api] network failed', { path: path.split('?')[0], message: error.errMsg })
        reject(new ApiRequestError(error.errMsg, '网络请求失败'))
      }
    })
  })
}

// 复用 TMS 已部署的 driver-auth：邮箱直接登录，手机号经 sys_user 解析为邮箱后登录。
export async function accountPasswordLogin(account: string, password: string) {
  return request<Session>('/functions/v1/driver-auth', {
    method: 'POST',
    body: { type: 'password', account, password },
    headers: { Authorization: `Bearer ${SUPABASE_KEY}` }
  })
}

export async function wechatPhoneLogin(phoneCode: string) {
  return request<Session>('/functions/v1/driver-auth', {
    method: 'POST',
    body: { type: 'wechat-phone', phoneCode },
    headers: { Authorization: `Bearer ${SUPABASE_KEY}` }
  })
}

export async function refreshToken(refreshToken: string) {
  return request<Session>('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    headers: { Authorization: `Bearer ${SUPABASE_KEY}` }
  })
}

export async function signOut(token: string) {
  await request('/auth/v1/logout', {
    method: 'POST',
    token
  })
}

export function restPath(table: string, query = '') {
  return `/rest/v1/${table}${query}`
}

export async function rpc<T>(token: string, functionName: string, params: unknown) {
  return keysToCamel<T>(
    await request<unknown>(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      token,
      body: params
    })
  )
}

export function getStoragePublicUrl(bucket: string, objectPath: string) {
  const encodedPath = objectPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `${trimSlash(SUPABASE_URL)}/storage/v1/object/public/${bucket}/${encodedPath}`
}

export async function uploadFileToStorage(
  bucket: string,
  objectPath: string,
  filePath: string,
  token: string
) {
  const url = `${trimSlash(SUPABASE_URL)}/storage/v1/object/${bucket}/${objectPath}`

  return new Promise<{ path: string; publicUrl: string }>((resolve, reject) => {
    uni.uploadFile({
      url,
      filePath,
      name: 'file',
      header: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        'x-upsert': 'true'
      },
      success(response) {
        const statusCode = response.statusCode || 0
        if (statusCode >= 200 && statusCode < 300) {
          resolve({
            path: objectPath,
            publicUrl: getStoragePublicUrl(bucket, objectPath)
          })
          return
        }

        let errorData: unknown = response.data
        try {
          errorData = JSON.parse(response.data)
        } catch {
          // Storage may return plain text instead of a JSON error payload.
        }
        reject(new ApiRequestError(errorData, '文件上传失败，请稍后重试'))
      },
      fail(error) {
        reject(new ApiRequestError(error.errMsg, '文件上传失败，请稍后重试'))
      }
    })
  })
}

export async function removeStorageObjects(
  bucket: string,
  objectPaths: string[],
  token: string
) {
  if (!objectPaths.length) return

  await request(`/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: 'DELETE',
    token,
    body: { prefixes: objectPaths }
  })
}
