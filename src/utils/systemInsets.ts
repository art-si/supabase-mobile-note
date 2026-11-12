export function getSystemInsets() {
  const info = uni.getSystemInfoSync()
  const insets = info.safeAreaInsets
  let top = Math.max(info.statusBarHeight || 0, insets?.top || 0)
  // #ifdef MP-WEIXIN
  // Keep the app toolbar below WeChat's own menu capsule, including custom navigation pages.
  const menu = uni.getMenuButtonBoundingClientRect()
  if (menu.height > 0 && menu.bottom > top) {
    top = menu.bottom + Math.max(4, menu.top - top)
  }
  // #endif
  const bottom = insets?.bottom ?? Math.max(0, info.screenHeight - (info.safeArea?.bottom ?? info.screenHeight))
  return { top, bottom }
}
