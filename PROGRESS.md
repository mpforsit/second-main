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

## Step 4 — Onboarding interview (2026-06-03)

**Shipped**

- [`lib/anthropic/pricing.ts`](./lib/anthropic/pricing.ts) — the model price table from `docs/05-llm-operations.md` §5.2 plus a `computeCostUsd` helper that handles cached-input tokens.
- [`lib/anthropic/client.ts`](./lib/anthropic/client.ts) — `callClaudeStream(opts)` async generator that yields `{type: 'text', text}` deltas and a final `{type: 'done', usage, full_text}`. Every call writes one `llm_call_logs` row (fire-and-forget) with input/output/cached token counts, `cost_usd`, `latency_ms`, and `succeeded`. Quota enforcement is deferred to Step 14.
- [`lib/supabase/service.ts`](./lib/supabase/service.ts) — service-role Supabase client used only for spec-designated "server-only" writes (`llm_call_logs` for now; `chunks`, `quotas` updates in later steps).
- [`lib/prompts/onboarding.ts`](./lib/prompts/onboarding.ts) — verbatim system prompt from §5.4.1 with a version constant.
- [`app/api/onboarding/chat/route.ts`](./app/api/onboarding/chat/route.ts) — POST streaming SSE handler. Watches the accumulated text for `<onboarding_complete>…</onboarding_complete>`, holds back the last 21 chars to avoid leaking a partial marker into the transcript, and emits `{type: 'complete', user_model, suggested_chapters}` once the structured block is parsed.
- [`server-actions/user-model.ts`](./server-actions/user-model.ts) `completeOnboarding(payload)` — zod-validates the parsed payload, writes `user_models.model` + `onboarding_completed_at`, inserts the suggested chapters in order, redirects to `/`.
- [`app/onboarding/page.tsx`](./app/onboarding/page.tsx) — server page that redirects already-onboarded users to `/`, otherwise renders [`<OnboardingChat>`](./components/onboarding/onboarding-chat.tsx).
- [`<OnboardingChat>`](./components/onboarding/onboarding-chat.tsx) — full-screen chat with kickoff turn, step counter, streaming bubbles, and a confirmation card showing the suggested chapters + extracted projects/people before the user clicks "Looks good, let's go".
- Onboarding gate in [`app/(app)/layout.tsx`](<./app/(app)/layout.tsx>): every authenticated request to an (app) route checks `user_models.onboarding_completed_at` and redirects to `/onboarding` if null.
- [`types/schemas.ts`](./types/schemas.ts) — first slice of the shared zod schemas from `docs/04-api-spec.md` §4.1 (`UserModelSchema`, `ChapterInputSchema`).

**Verified**

- Fresh user with a pre-existing pre-onboarding `user_models` row → lands on `/onboarding` after sign-in.
- Conversation runs token-by-token; the structured block is captured server-side and never leaks into the transcript.
- Confirmation card shows the actual proposed chapters + extracted projects/people.
- After confirm: `user_models.model` has 5 projects + 1 person, `onboarding_completed_at` is set, 8 starter chapters inserted (within the spec's 4–8 range), and 8 `llm_call_logs` rows are present totalling $0.0349 across the interview.
- Refreshing the app now lands on `/` rather than `/onboarding`.

**Deviations from spec**

- **`completeOnboarding` takes the structured payload, not the raw message list.** Spec lists `completeOnboarding(messages: Message[])`. We instead pass the `{user_model, suggested_chapters}` parsed by the SSE `complete` event, zod-validate it server-side, and write it. Less round-trip; the conversation history is still recoverable from `llm_call_logs` if needed.
- **`callClaudeStream` doesn't enforce quotas yet.** The spec wrapper sketch (§5.2) lists quota-check-before-call + atomic increment after. That's Step 14's scope per the build plan, so we only log for now.

**Open items / observations**

- Average onboarding was 8 LLM calls and $0.035 — higher than the spec's ~$0.02 estimate. The model occasionally asks an extra clarifying turn before proposing chapters. Worth tightening the prompt in a future revision if cost becomes a concern.
- The marker-detection safe-tail window is hard-coded to `MARKER_OPEN.length` (21 chars). Fine for the current marker; if the marker string ever changes, the constant tracks it automatically.

---

## Step 3 — Auth pages and protected routes (2026-06-02)

**Shipped**

- [`proxy.ts`](./proxy.ts) refreshes the Supabase session every request, redirects unauthenticated traffic on any non-public path to `/login?next=<path>`, and bounces already-signed-in users away from `/login` and `/signup`.
- Route groups: [`app/(auth)/`](./app/%28auth%29) (centered card layout for login + signup) and [`app/(app)/`](./app/%28app%29) (sidebar layout for authenticated routes — home page moved here).
- [`app/(auth)/login/page.tsx`](<./app/(auth)/login/page.tsx>) and [`app/(auth)/signup/page.tsx`](<./app/(auth)/signup/page.tsx>) with email/password + Google OAuth, react-hook-form + zod validation, and toast-based error reporting.
- [`app/api/auth/callback/route.ts`](./app/api/auth/callback/route.ts) handles both PKCE OAuth and email-confirmation links via `exchangeCodeForSession`.
- [`server-actions/auth.ts`](./server-actions/auth.ts) `signOut()` server action — wired into the sidebar via `<form action={signOut}>`.
- [`lib/hooks/use-user.ts`](./lib/hooks/use-user.ts) client hook (subscribes to `onAuthStateChange`).
- [`components/shared/sidebar.tsx`](./components/shared/sidebar.tsx) placeholder navigation + email + theme toggle + sign-out. Real nav lands in Step 6.
- [`app/onboarding/page.tsx`](./app/onboarding/page.tsx) placeholder so middleware-protected routing can be verified before Step 4 fills it in.
- README addition documenting Supabase Auth URL configuration + Google OAuth setup.

**Verified**

- `curl -I` smoke tests pass: `/` → 307 to `/login?next=%2F`, `/login` → 200, `/onboarding` → 307 to `/login?next=%2Fonboarding`.
- Full browser flow confirmed by user: signup → confirmation email → sign-in → home page renders with user email → sign-out returns to `/login`.

**Deviations from spec**

- **`middleware.ts` → `proxy.ts`.** Next 16 deprecated the `middleware` file convention in favour of `proxy`; the build emits a warning otherwise. The export changed from `middleware` to `proxy`; everything else is identical.
- **GET, not POST, for `/api/auth/callback`.** The spec lists `POST /api/auth/callback`, but Supabase OAuth + email-confirmation links arrive via `GET ?code=…`. Implemented as `GET`.
- **Custom zod resolver in [`lib/forms/zod-resolver.ts`](./lib/forms/zod-resolver.ts).** `@hookform/resolvers@5.4.0` lags behind `zod@4.4.3` internals and its `zodResolver` no longer type-checks. Replaced with a 15-line in-repo resolver that wraps `schema.safeParse`; the `@hookform/resolvers` dep was removed.

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
