# 时光记事（supabase-mobile-note）

Apple Design 风格的时间轴记事本。骨架来自 `supabase-mobile-tms-driver`（uni-app + Vue 3 + Pinia + wot-ui），界面按 Apple Human Interface Guidelines 重新设计：分组式卡片、语义化明暗配色、系统字体、毛玻璃导航层。

## 功能

- 双存储模式：新安装默认本机存储，笔记仅保存在当前设备且无需登录；管理端参数设置可开放 Supabase 云端选项，之后每台设备由使用者自行选择，云端模式使用邮箱 / 手机号登录并沿用 TMS 已部署的 `driver-auth`
- 本机笔记可离线打开。应用在后台读取公开云端配置；切换云端时可选择是否导入本机记录，导入中会显示条数与图片进度
- 已授权的云端账号可以从「设置 → 备份到本机」复制笔记和图片，之后切换本机存储可离线查看。重复备份只更新未在本机改过的副本，不覆盖本机编辑。
- 时间轴首页：按日分组、搜索、下拉刷新、分页加载；点日历按钮按日筛选。授权定位后，顶部展示当前位置的天气和温度，离线时标记缓存；城市选择作为定位不可用时的备用入口
- 富文本编辑：uni-app editor（Quill 本地内置），支持常用短语、标签、表情、加粗和本机文字草稿
- 图片附件：拍照 / 相册选图，最多 9 张、单张 10MB；本机模式保存到设备，云端模式使用私有桶 `note-images` 与签名 URL
- 笔记管理：新增 / 修改 / 确认删除，正文、标签与图片在移动端和云端管理页互通
- 笔记 AI（已授权的云端模式）：新建笔记底栏的 AI 整理可拆成多条待确认记录；时间轴可生成所选日期的小结；搜索页提供智能搜索。小结和搜索均能打开原笔记。本机模式没有入口。
- 设置：主题色（蓝 / 靛 / 青）、存储方式；登录云端后显示账号与头像
- 外观支持跟随系统、浅色与深色；主题色、系统栏和弹窗材质同步切换

## 技术栈

- uni-app（Vue 3 + Vite + TypeScript），H5 为主，保留微信小程序条件编译
- Pinia 状态管理，wot-ui v2 组件库
- Supabase（项目 `ckbftoopuyophiebamwy`）：Auth + PostgREST + Storage，笔记存 `public.notes`，图片存私有桶 `note-images`，RLS 仅本人可读写

笔记 AI 使用独立的 `note-assistant` Edge Function，由函数核实会话和云端笔记权限。模型调用沿用项目的 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` 服务端配置。可仅设置 `NOTE_AI_MODEL`，在现有线路上使用笔记专用模型；换线路时，需同时配置 `NOTE_AI_BASE_URL`、`NOTE_AI_API_KEY`、`NOTE_AI_MODEL`。无需修改数据表或登录函数。
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

仅用于全新模拟器调试时，可执行 `gradlew.bat :app:assembleDebug -PnoteEmulator=true`，生成独立包名 `com.shiguang.notes.emulator` 的调试包，使用 Android 默认调试证书。

Android 系统栏使用 Capacitor 注入的 `--safe-area-inset-*` 与 CSS `env()` 合并计算，三键导航、手势导航和横屏侧边安全区共用这套间距。微信小程序的自定义顶部栏另外避让原生菜单胶囊。

覆盖更新时保持包名 `com.shiguang.notes` 与上述签名不变，递增 `android/app/build.gradle` 的 `versionCode`，并同步应用版本。直接安装新版即可保留本机笔记，无需卸载。当前版本为 1.0.3（103），与已交付的 1.0（1）使用同一证书。旧包及新包的证书 SHA-256 均应为 `b963c4b6517b0e0684203bd856fba0a3f4e0635930edb15503b1d621c195226e`。

安卓云端语音使用原生 16 kHz 单声道 PCM WAV 录音，通过 `note-transcribe` Edge Function 调用 NVIDIA 托管 Whisper large v3，不依赖系统语音识别引擎。复用 art-supabase-pro 的服务端 `AI_API_KEY`（`AI_BASE_URL` 指向 NVIDIA），不读取旧的 OpenAI 密钥。按住录音、松开上传转写、上滑取消；取消时不上传，录音仅暂存在内存。本机模式没有入口。服务端校验登录和笔记授权、限制录音大小及请求频率；供应商密钥仅留在服务端。

仅在用户明确要求打包时生成 APK。正式发布仍需规划签名及发布流程。

## 数据库

`supabase/migrations/` 按序定义 `public.notes`、RLS、图片附件与私有桶 `note-images` 策略、富文本内容列。
远端库带有 TMS 的迁移历史，本仓库的 schema 变更用 `supabase db query --remote -f <file>` 直接执行，
不要在本仓库运行 `db push` / `db pull` / `migration repair`。

## Skills

`.agents/skills/` 内置 22 个 skill（apple-design、supabase、wot-ui-v2、project-code-quality 等），
开发约定见 `AGENTS.md`。
