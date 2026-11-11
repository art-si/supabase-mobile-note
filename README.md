# 时光记事（supabase-mobile-note）

Apple Design 风格的时间轴记事本。骨架来自 `supabase-mobile-tms-driver`（uni-app + Vue 3 + Pinia + wot-ui），界面按 Apple Human Interface Guidelines 重新设计：分组式卡片、语义化明暗配色、系统字体、毛玻璃导航层。

## 功能

- 邮箱 / 手机号 + 密码登录（复用 TMS 已部署的 `driver-auth` Edge Function，账号体系与司机端一致）
- 时间轴首页：按日分组、心情标记、搜索、下拉刷新、分页加载；点顶部日期打开日历，按日筛选记录
- 富文本编辑：uni-app 原生 editor（Quill 本地内置，不依赖 CDN），加粗 / 斜体 / 列表 / 引用，企业级表情面板
- 图片附件：拍照 / 相册选图，最多 9 张、单张 10MB，私有桶 `note-images` + 签名 URL，时间轴网格渲染与全屏预览
- 笔记管理：新增 / 修改 / 删除，六种心情（平静 / 愉悦 / 专注 / 疲惫 / 灵感 / 纪念）
- 我的：账号信息、主题色（蓝 / 靛 / 青）、退出登录
- 跟随系统深色模式，无应用内外观开关（HIG 要求）

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

## 数据库

`supabase/migrations/` 按序定义 `public.notes`、RLS、图片附件与私有桶 `note-images` 策略、富文本内容列。
远端库带有 TMS 的迁移历史，本仓库的 schema 变更用 `supabase db query --remote -f <file>` 直接执行，
不要在本仓库运行 `db push` / `db pull` / `migration repair`。

## Skills

`.agents/skills/` 内置 22 个 skill（apple-design、supabase、wot-ui-v2、project-code-quality 等），
开发约定见 `AGENTS.md`。