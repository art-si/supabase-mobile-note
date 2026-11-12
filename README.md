# 时光记事（supabase-mobile-note）

Apple Design 风格的时间轴记事本。骨架来自 `supabase-mobile-tms-driver`（uni-app + Vue 3 + Pinia + wot-ui），界面按 Apple Human Interface Guidelines 重新设计：分组式卡片、语义化明暗配色、系统字体、毛玻璃导航层。

## 功能

- 双存储模式：新安装默认本机存储，笔记仅保存在当前设备且无需登录；管理端参数设置可开放 Supabase 云端选项，之后每台设备由使用者自行选择，云端模式使用邮箱 / 手机号登录并沿用 TMS 已部署的 `driver-auth`
- 启动时仅匿名读取公开存储能力配置；配置不可用时自动使用本机存储。选择本机后，笔记读写不访问远端接口
- 时间轴首页：按日分组、搜索、下拉刷新、分页加载；点顶部日期打开日历，按日筛选记录
- 富文本编辑：uni-app 原生 editor（Quill 本地内置，不依赖 CDN），加粗 / 斜体 / 列表 / 引用，企业级表情面板
- 图片附件：拍照 / 相册选图，最多 9 张、单张 10MB；本机模式保存到设备，云端模式使用私有桶 `note-images` 与签名 URL
- 笔记管理：新增 / 修改 / 撤销删除，正文、标签与图片在移动端和云端管理页互通
- 我的：账号信息、主题色（蓝 / 靛 / 青）、退出登录
- 外观支持跟随系统、浅色与深色；主题色、系统栏和弹窗材质同步切换

## 技术栈

- uni-app（Vue 3 + Vite + TypeScript），H5 为主，保留微信小程序条件编译
- Pinia 状态管理，wot-ui v2 组件库
- Supabase（项目 `ckbftoopuyophiebamwy`）：Auth + PostgREST + Storage，笔记存 `public.notes`，图片存私有桶 `note-images`，RLS 仅本人可读写
- 图标：Bootstrap Icons 子集化字体（`pnpm icons:build`）；中文 UI 字体子集（`pnpm font:css`）

## 快速开始

```bash
pnpm install
cp .env.example .env.local   # 填入 VITE_SUPABASE_KEY
pnpm dev:h5                  # http://localhost:5173
```

其他命令：

```bash
pnpm typecheck        # vue-tsc 类型检查
pnpm build:h5         # 产物输出到 docs/（GitHub Pages 约定）
pnpm build:mp-weixin  # 微信小程序（需先在 manifest.json 填 appid）
pnpm icons:build      # 重新生成图标字体
pnpm font:css         # 重新生成内嵌 UI 字体 CSS
```

### Android 手机测试包

测试包使用 Capacitor 加载打包进应用的 H5 页面，支持 Android 7.0 及以上；这是用于真机验证的调试包。手机应用与浏览器各自保存本机笔记，卸载应用或清除应用数据会删除应用内的本机笔记。

安装 JDK 21、Android SDK 36 和 Build-Tools 35.0.0 后，设置 `ANDROID_HOME` 指向 SDK 目录，执行：

```powershell
pnpm build:h5
pnpm exec cap sync android
cd android
.\gradlew.bat :app:assembleDebug
```

生成文件位于 `android/app/build/outputs/apk/debug/app-debug.apk`。测试包固定使用本地 `android/app/shiguang-debug.keystore`（Git 忽略）签名，请备份并在更换打包电脑时沿用该文件，缺失时不要重新生成不同的密钥。

Android 系统栏使用 Capacitor 注入的 `--safe-area-inset-*` 与 CSS `env()` 合并计算，三键导航、手势导航和横屏侧边安全区共用这套间距。微信小程序的自定义顶部栏另外避让原生菜单胶囊。

覆盖更新时保持包名 `com.shiguang.notes` 与上述签名不变，递增 `android/app/build.gradle` 的 `versionCode`，并同步应用版本。直接安装新版即可保留本机笔记，无需卸载。当前版本为 1.0.1（101），与已交付的 1.0（1）使用同一证书。旧包及新包的证书 SHA-256 均应为 `b963c4b6517b0e0684203bd856fba0a3f4e0635930edb15503b1d621c195226e`。

正式发布仍需规划签名及发布流程；语音输入取决于设备 WebView 的支持情况。

## 数据库

`supabase/migrations/` 按序定义 `public.notes`、RLS、图片附件与私有桶 `note-images` 策略、富文本内容列。
远端库带有 TMS 的迁移历史，本仓库的 schema 变更用 `supabase db query --remote -f <file>` 直接执行，
不要在本仓库运行 `db push` / `db pull` / `migration repair`。

## Skills

`.agents/skills/` 内置 22 个 skill（apple-design、supabase、wot-ui-v2、project-code-quality 等），
开发约定见 `AGENTS.md`。
