import { ApiRequestError, SUPABASE_KEY, SUPABASE_URL, removeStorageObjects, request } from './supabase'
import { removeLocalNoteImages, saveLocalNoteImage } from './localNoteImages'
import { isLocalStorageMode } from '@/utils/storageMode'

export const NOTE_IMAGE_BUCKET = 'note-images'
export const MAX_NOTE_IMAGES = 9
export const MAX_NOTE_IMAGE_BYTES = 10 * 1024 * 1024
export const NOTE_IMAGE_SIGN_TTL = 24 * 60 * 60

export interface ChosenImage {
  path: string
  size: number
}

export type ImageSource = 'album' | 'camera'
type WechatChooseMediaResult = { tempFiles: Array<{ tempFilePath: string; size?: number }> }
type WechatApiError = { errMsg?: string }

declare const wx: {
  chooseMedia(options: {
    count: number
    mediaType: ['image']
    sizeType: ['compressed']
    sourceType: [ImageSource]
    success(result: WechatChooseMediaResult): void
    fail(error: WechatApiError): void
  }): void
}

// 与 driver 端一致的选图链路：微信用 chooseMedia，其余平台用 chooseImage，取消视为空选择。
export function chooseNoteImages(count: number, source: ImageSource): Promise<ChosenImage[]> {
  return new Promise<ChosenImage[]>((resolve, reject) => {
    // #ifdef MP-WEIXIN
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: [source],
      success(result) {
        resolve(result.tempFiles.map((file) => ({ path: file.tempFilePath, size: file.size || 0 })))
      },
      fail(error) {
        if (error.errMsg?.includes('cancel')) {
          resolve([])
          return
        }
        reject(new Error(error.errMsg || '选择图片失败'))
      }
    })
    // #endif

    // #ifndef MP-WEIXIN
    uni.chooseImage({
      count,
      sizeType: ['compressed'],
      sourceType: [source],
      success(result) {
        const files = Array.isArray(result.tempFiles) ? result.tempFiles : []
        if (files.length) {
          resolve(files.map((file) => ({ path: 'path' in file ? file.path : file.name, size: file.size || 0 })))
          return
        }
        const paths = result.tempFilePaths
        resolve((Array.isArray(paths) ? paths : paths ? [paths] : []).map((path) => ({ path, size: 0 })))
      },
      fail(error) {
        if (error.errMsg?.includes('cancel')) {
          resolve([])
          return
        }
        reject(new Error(error.errMsg || '选择图片失败'))
      }
    })
    // #endif
  })
}

function uniqueObjectName(filePath: string) {
  const ext = /\.jpe?g|\.png|\.webp|\.gif|\.heic|\.heif$/i.exec(filePath)?.[0]?.slice(1) || 'jpg'
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${nonce}.${ext.toLowerCase() === 'jpeg' ? 'jpg' : ext.toLowerCase()}`
}

export function uploadNoteImage(
  token: string,
  userId: string,
  filePath: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  if (isLocalStorageMode()) {
    onProgress?.(100)
    return saveLocalNoteImage(filePath)
  }

  const objectPath = `${userId}/${uniqueObjectName(filePath)}`
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${NOTE_IMAGE_BUCKET}/${objectPath}`

  return new Promise((resolve, reject) => {
    const task = uni.uploadFile({
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
          resolve(objectPath)
          return
        }
        let errorData: unknown = response.data
        try {
          errorData = JSON.parse(response.data)
        } catch {
          // Storage 可能返回纯文本错误。
        }
        reject(new ApiRequestError(errorData, '图片上传失败，请稍后重试'))
      },
      fail(error) {
        reject(new ApiRequestError(error.errMsg, '图片上传失败，请稍后重试'))
      }
    })
    task.onProgressUpdate((result) => onProgress?.(result.progress))
  })
}

interface SignedUrlRow {
  path: string
  signedURL: string
  error: string | null
}

// 私有桶不暴露公开链接：参照 web 端 private-attachment 的签名 URL 做法，批量签发。
export async function signNoteImages(token: string, paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const rows = await request<SignedUrlRow[]>(`/storage/v1/object/sign/${NOTE_IMAGE_BUCKET}`, {
    method: 'POST',
    token,
    body: { paths, expiresIn: NOTE_IMAGE_SIGN_TTL }
  })
  const base = SUPABASE_URL.replace(/\/$/, '')
  const urls: Record<string, string> = {}
  for (const row of rows) {
    if (row.error || !row.signedURL) continue
    urls[row.path] = row.signedURL.startsWith('http') ? row.signedURL : `${base}/storage/v1${row.signedURL}`
  }
  return urls
}

export async function removeNoteImages(token: string, paths: string[]) {
  if (isLocalStorageMode()) {
    await removeLocalNoteImages(paths)
    return
  }
  await removeStorageObjects(NOTE_IMAGE_BUCKET, paths, token)
}
