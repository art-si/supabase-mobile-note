type ImageSource = 'album' | 'camera'

export async function chooseImages(count = 3): Promise<string[]> {
  const source = await new Promise<ImageSource | null>((resolve, reject) => {
    uni.showActionSheet({
      title: '选择图片来源',
      itemList: ['拍照', '从手机相册选择'],
      success(result) {
        resolve(result.tapIndex === 0 ? 'camera' : 'album')
      },
      fail(error) {
        if (error.errMsg?.includes('cancel')) {
          resolve(null)
          return
        }
        reject(new Error(error.errMsg || '请选择图片来源'))
      }
    })
  })

  if (!source) return []

  return new Promise<string[]>((resolve, reject) => {
    uni.chooseImage({
      count,
      sizeType: ['compressed'],
      sourceType: [source],
      success(result) {
        const paths = result.tempFilePaths
        resolve(Array.isArray(paths) ? paths : paths ? [paths] : [])
      },
      fail(error) {
        if (error.errMsg?.includes('cancel')) {
          resolve([])
          return
        }
        reject(new Error(error.errMsg || '选择图片失败'))
      }
    })
  })
}
