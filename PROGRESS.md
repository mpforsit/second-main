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

**Open questions**

- Supabase project keys not yet populated in `.env.local` — pending user creating the project in the web console and pasting URL + anon key + service-role key.
- Vercel deployment not yet attempted — pending Supabase keys.
- Whether to copy the Next 16 `AGENTS.md` notice into `CLAUDE.md` — keeping both files for now.
