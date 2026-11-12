import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.shiguang.notes',
  appName: '时光记事',
  webDir: 'docs',
  server: { androidScheme: 'https' },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover'
    }
  }
}

export default config
