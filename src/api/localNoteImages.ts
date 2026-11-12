const H5_IMAGE_PREFIX = 'note-local-image://'
const DATABASE_NAME = 'note-local-media'
const STORE_NAME = 'images'
const objectUrls = new Map<string, string>()

// #ifdef H5
function openImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('本机图片存储不可用'))
  })
}

function h5ImageKey() {
  return `${H5_IMAGE_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
// #endif

export async function saveLocalNoteImage(filePath: string): Promise<string> {
  // #ifdef H5
  const image = await fetch(filePath).then((response) => {
    if (!response.ok) throw new Error('无法读取所选图片')
    return response.blob()
  })
  const database = await openImageDatabase()
  const key = h5ImageKey()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(image, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('图片保存失败'))
    transaction.onabort = () => reject(transaction.error || new Error('图片保存失败'))
  }).finally(() => database.close())
  return key
  // #endif

  // #ifndef H5
  return new Promise<string>((resolve, reject) => {
    uni.saveFile({
      tempFilePath: filePath,
      success(result) {
        resolve(result.savedFilePath)
      },
      fail() {
        reject(new Error('图片保存到本机失败，请检查设备剩余空间'))
      }
    })
  })
  // #endif
}

export async function resolveLocalNoteImage(path: string): Promise<string> {
  // #ifdef H5
  if (!path.startsWith(H5_IMAGE_PREFIX)) return path
  const cached = objectUrls.get(path)
  if (cached) return cached
  const database = await openImageDatabase()
  const image = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(path)
    request.onsuccess = () => resolve(request.result as Blob | undefined)
    request.onerror = () => reject(request.error || new Error('图片读取失败'))
  }).finally(() => database.close())
  if (!image) return ''
  const url = URL.createObjectURL(image)
  objectUrls.set(path, url)
  return url
  // #endif

  // #ifndef H5
  return path
  // #endif
}

export async function removeLocalNoteImages(paths: string[]) {
  for (const path of paths) {
    // #ifdef H5
    if (path.startsWith(H5_IMAGE_PREFIX)) {
      const database = await openImageDatabase()
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite')
        transaction.objectStore(STORE_NAME).delete(path)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error || new Error('图片删除失败'))
      }).finally(() => database.close())
      const url = objectUrls.get(path)
      if (url) URL.revokeObjectURL(url)
      objectUrls.delete(path)
      continue
    }
    // #endif

    // #ifndef H5
    await new Promise<void>((resolve) => {
      uni.removeSavedFile({ filePath: path, success: () => resolve(), fail: () => resolve() })
    })
    // #endif
  }
}

export function clearLocalNoteImageUrlCache() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url)
  objectUrls.clear()
}
