---
name: supabase
description: "Use for any Supabase task: Database, Auth, Storage, Realtime, CLI, MCP, schema migrations, RLS, or Postgres queries."
---

# Supabase MCP-first workflow

Before performing any Supabase work:

1. Verify that Supabase MCP tools are available for the configured project.
2. Prefer MCP `search_docs`, `execute_sql`, and `get_advisors` over direct CLI operations.
3. For every DDL or DML change, run a focused read query afterwards to verify the result.
4. If MCP tools are missing, check the hosted endpoint. A `401` response confirms reachability and means the Codex session needs Supabase OAuth authentication followed by a reload or new task.
5. Use the Supabase CLI only when MCP is unavailable.

## Safety requirements

- Never put a Supabase personal access token, database password, service-role key, or secret key in the repository.
- Never expose service-role or secret keys in client code.
- For new or changed public-schema tables, evaluate RLS and the required policies.
- Before finishing schema, RLS, function, trigger, or storage changes, run database advisors when available and verify the intended query or workflow.

## Project connection

- Project ref: `ckbftoopuyophiebamwy`
- MCP endpoint: `https://mcp.supabase.com/mcp?project_ref=ckbftoopuyophiebamwy&features=database,debugging,development,docs`
