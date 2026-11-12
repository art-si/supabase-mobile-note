type HapticStyle = 'light' | 'medium' | 'success' | 'warning'

// 触感只在有意义的时刻触发：提交、删除、吸附。H5 用 Vibration API，小程序用短振动。
export function haptic(style: HapticStyle = 'light') {
  // #ifdef H5
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(style === 'warning' ? [10, 40, 10] : 8)
  }
  // #endif
  // #ifndef H5
  uni.vibrateShort({ type: style === 'warning' || style === 'success' ? 'medium' : 'light' })
  // #endif
}