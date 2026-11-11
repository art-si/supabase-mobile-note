import { defineConfig } from 'vite'
import uniPlugin from '@dcloudio/vite-plugin-uni'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const uni = (uniPlugin as unknown as { default?: typeof uniPlugin }).default || uniPlugin

/**
 * GitHub Pages 会将以下划线开头的资源交给 Jekyll 处理；此标记可禁用该行为。
 * 使用构建钩子确保每次 H5 打包的根目录都会包含 .nojekyll。
 */
const noJekyllPlugin = () => ({
  name: 'h5-nojekyll',
  apply: 'build' as const,
  writeBundle(outputOptions: { dir?: string }) {
    if (process.env.UNI_PLATFORM !== 'h5' || !outputOptions.dir) return

    const outputPath = resolve(outputOptions.dir, '.nojekyll')
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, '')
  }
})

export default defineConfig({
  // 使用相对资源路径，兼容 https://<user>.github.io/<repository>/ 形式的 GitHub Pages。
  base: process.env.UNI_PLATFORM === 'h5' ? './' : '/',
  css: {
    preprocessorOptions: {
      scss: {
        // Uni-app 依赖仍有旧式 Sass API；只屏蔽依赖层弃用提示。
        quietDeps: true,
        silenceDeprecations: ['import', 'global-builtin']
      }
    }
  },
  build: {
    rolldownOptions: {
      checks: {
        // 关闭仅用于性能诊断的插件耗时提示，构建错误仍会正常抛出。
        pluginTimings: false
      }
    }
  },
  plugins: [uni(), noJekyllPlugin()]
})
