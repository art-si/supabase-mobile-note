# Project Instructions

- Generate an APK only when the user explicitly asks to package/build an APK. Normal fixes and feature work should run source checks without automatically packaging or installing Android builds.

- The permanent brand mark is the original flat blue (`#007AFF`) rounded-square timeline icon: a white vertical line with two nodes and text strokes on the right. Use this identity consistently for the app launcher, splash screen, login page, and favicon. The canonical assets are `src/static/favicon.svg` and `android/app/src/main/res/drawable/note_launcher.xml`. Do not replace it with the teal gradient / centered-node design or another mark unless the user explicitly requests a new identity.

- Before creating, modifying, refactoring, or reviewing source code, first read and apply the local `project-code-quality` skill.
- Before creating, modifying, refactoring, reviewing, or visually auditing any user-facing page or component, first read and apply the local `apple-design`, `professional-ui-quality`, and `web-design-guidelines` skills. The product follows Apple Human Interface Guidelines: grouped surfaces, semantic light/dark colors, system typography, 44pt touch targets, safe areas, and real-browser visual verification are part of completion.
- Before any Supabase, database, schema, RLS, Storage, Auth, or API-provider task, first read the local `supabase` skill and verify that the Supabase MCP server is available for this project.
- This repository is scoped to Supabase project `ckbftoopuyophiebamwy` through `.mcp.json`. The note app owns only the `public.notes` table; all TMS tables are out of scope and must not be modified.
- Expected MCP URL: `https://mcp.supabase.com/mcp?project_ref=ckbftoopuyophiebamwy&features=database,debugging,development,docs`.
- Prefer Supabase MCP `search_docs`, `execute_sql`, and `get_advisors` for database work. Verify every DDL/DML change with a read query.
- If Supabase MCP tools are unavailable, use the Supabase CLI (`supabase db query --linked`) as a fallback. The remote database carries the TMS migration history; never run `supabase db pull`, `migration repair`, or `db push` from this repository, and apply note-app schema changes with direct SQL instead.
- Login reuses the deployed `driver-auth` Edge Function (email or phone + password via `sys_user`); do not fork or modify it from this repository.
