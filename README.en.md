# Time Notes (supabase-mobile-note)

An Apple-design timeline notebook. Skeleton ported from `supabase-mobile-tms-driver` (uni-app + Vue 3 + Pinia + wot-ui), with the UI rebuilt around Apple Human Interface Guidelines: grouped surfaces, semantic light/dark colors, system typography, and translucent navigation materials.

## Features

- Email or phone + password login (reuses the deployed `driver-auth` Edge Function; same account system as the TMS driver app)
- Timeline home: day-grouped notes, mood tags, search, pull-to-refresh, cursor pagination; tap the header date to open a calendar and filter by day
- Rich-text editor: native uni-app editor (Quill vendored locally, no CDN), bold / italic / list / quote, enterprise-style emoji panel
- Image attachments: camera / album picker, up to 9 images at 10MB each, private bucket `note-images` with signed URLs, timeline grid and fullscreen preview
- Note management: create / edit / delete, six moods (calm / happy / focused / tired / inspired / memorial)
- Profile: account info, accent color (blue / indigo / teal), sign out
- Follows system dark mode; no in-app appearance toggle (per HIG)

## Stack

- uni-app (Vue 3 + Vite + TypeScript), H5 first, WeChat mini-program conditional compilation kept
- Pinia stores, wot-ui v2 components
- Supabase project `ckbftoopuyophiebamwy`: Auth + PostgREST + Storage; notes live in `public.notes`, images in the private `note-images` bucket, all with owner-only RLS
- Icons: subset Bootstrap Icons font (`pnpm icons:build`); CJK UI font subset (`pnpm font:css`)

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill VITE_SUPABASE_KEY
pnpm dev:h5                  # http://localhost:5173
```

Other commands: `pnpm typecheck`, `pnpm build:h5` (outputs to `docs/`), `pnpm build:mp-weixin`, `pnpm icons:build`, `pnpm font:css`.

## Database

`supabase/migrations/` defines `public.notes`, its RLS policies, image attachments, the private `note-images` bucket policies, and the rich-content column, in order.
The remote database carries the TMS migration history; apply note-app schema changes with
`supabase db query --remote -f <file>`. Never run `db push` / `db pull` / `migration repair` from this repository.

## Skills

22 skills live in `.agents/skills/` (apple-design, supabase, wot-ui-v2, project-code-quality, ...). See `AGENTS.md` for development rules.