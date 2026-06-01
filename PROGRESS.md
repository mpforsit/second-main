# Progress log

Chronological build log for [`docs/07-phase-1-buildplan.md`](./docs/07-phase-1-buildplan.md). Each entry: what shipped, deviations from spec, open questions.

---

## Step 1 — Project bootstrap and base infra (2026-05-30)

**Shipped**

- Spec docs moved from repo root into [`docs/`](./docs).
- Next.js project scaffolded at repo root with App Router, TypeScript strict (`noUncheckedIndexedAccess` on), Tailwind v4, ESLint, no `src/` dir.
- TS path aliases per `docs/09-conventions.md` §9.1 (`@/lib/*`, `@/components/*`, `@/types/*`, `@/server-actions/*`) plus default `@/*`.
- shadcn/ui initialised; installed `button`, `input`, `card`, `dialog`, `dropdown-menu`, `tabs`, `sonner`.
- `next-themes` wired into [`app/layout.tsx`](./app/layout.tsx); [`<ThemeToggle/>`](./components/shared/theme-toggle.tsx) with light/dark/system on the home page; Sonner `<Toaster/>` mounted globally.
- Placeholder [`app/page.tsx`](./app/page.tsx) renders "Second" + the theme toggle.
- Supabase clients at [`lib/supabase/server.ts`](./lib/supabase/server.ts) and [`lib/supabase/browser.ts`](./lib/supabase/browser.ts) via `@supabase/ssr`.
- [`.env.local.example`](./.env.local.example) lists all nine env vars from `docs/02-architecture.md` §2.7.
- Prettier + ESLint + Husky (pre-commit `lint-staged`, commit-msg `commitlint` with conventional config).
- New project README + this log; `.gitignore` extended to keep `.env.local.example` tracked and `.husky/_` untracked.

**Deviations from spec**

- **Node 24** (not Node 20 LTS) — Node 20 reached end-of-life in April 2026. Pinned `.nvmrc` to 24, the newest LTS, matching the local machine.
- **Next.js 16.2.6** (spec says 15) — `create-next-app@latest` installs 16; App Router patterns we rely on are unchanged.
- **Tailwind v4** (spec doesn't pin a version) — what `create-next-app` ships today. Config uses the new CSS-first `@import "tailwindcss"` style; no `tailwind.config.js` file.
- **Sonner** used for toasts. shadcn deprecated the older `toast` primitive in favour of `sonner`; semantics unchanged.

---

## Step 2 — Database migrations & RLS (2026-06-01)

**Shipped**

- [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql) ports the entire `docs/03-data-model.md` Phase-1 schema: extensions (pgcrypto, vector, pg_trgm), enum types, all 15 tables with their indexes (HNSW vector + GIN FTS on `chunks`), the `is_workspace_member` helper, every RLS policy, the `touch_updated_at` triggers on the eight `updated_at` tables, the `handle_new_user` trigger that auto-creates `profiles`/`workspaces`/`workspace_members`/`user_models`/`quotas` on signup, and the `search_chunks` RRF hybrid function.
- Empty [`supabase/seed.sql`](./supabase/seed.sql) (the trigger does the work).
- README section ([`Database migrations`](./README.md#database-migrations)) documenting both the dashboard and CLI apply paths.
- Migration applied to the dev Supabase project via the dashboard SQL editor.

**Verified via REST API**

- All 15 tables present and queryable as `service_role`; `search_chunks` registered in PostgREST swagger and returns `[]` for an empty corpus.
- Two test auth users created via the Admin API; trigger correctly inserted 5 downstream rows for each. After DELETE the cascade emptied every dependent table (back to 0 rows).
- User A signed in with their JWT can read their own `profiles`/`workspaces` rows (count = 1 each), and any query targeting user B's rows comes back empty — RLS confirmed.

**Deviations from spec**

- **Explicit role grants added.** The spec section 3.3 enables RLS but never grants base privileges. With Supabase's new `sb_publishable_*` / `sb_secret_*` keys (which still map to `anon` / `service_role`), newly created tables don't auto-inherit grants. Added a "Grants for the API roles" block before the RLS section that grants `usage` on `public` to all three roles, `select` on tables to `anon`, and full access to `authenticated` + `service_role`. Without it every PostgREST call returns 42501 "permission denied".
- **`set search_path = public` on `handle_new_user`.** Triggers on `auth.users` run under `supabase_auth_admin`, whose default search_path does not include `public`. Without it, `insert into profiles ...` fails with "relation does not exist" and GoTrue returns `500 unexpected_failure`. Also `grant execute ... to supabase_auth_admin` so the auth role can invoke the function.

**Open questions**

- None blocking. Storage buckets (for voice / PDFs) are not in this migration — that's Step 7/8 scope, but worth a follow-up note when we get there.

---

**Deployment (Step 1)**

- Vercel project `matthias-projects-cddf208c/second` created and linked to `github.com/mpforsit/second-main`.
- Production deploy live at <https://second-red.vercel.app> (id `dpl_Fk3svpVhtFTzXcfiaN1usNwb9WQK`).
- All four env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`) set for Development, Preview, and Production.
- Supabase project `nzdppsawfpgzpoevdeoi.supabase.co` (eu-central-1) reachable; `auth/v1/user` returns 401 for anon-only requests (correct — no session).

**Open questions**

- Whether to copy the Next 16 `AGENTS.md` notice into `CLAUDE.md` — keeping both files for now.
- `vercel env add ... preview --yes` rejects `--value` without a positional branch; workaround used `""` as the "all preview branches" sentinel. May want a script wrapper if we add more env vars often.
