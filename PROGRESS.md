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

## Step 9 — Comments and intents (2026-06-19)

**Shipped**

- [`lib/prompts/intent-parse.ts`](./lib/prompts/intent-parse.ts) — verbatim §5.4.5 system prompt + a `parseIntent(text, opts)` helper that calls Haiku, parses the JSON, and validates against `IntentParseResultSchema`. Records a `capture.intent_parse` row in `llm_call_logs`.
- [`types/schemas.ts`](./types/schemas.ts): `CaptureInputSchema.intent.action_type` is now optional (so the server can auto-parse), plus new `IntentParseResultSchema`, `IntentUpdateSchema`, `CommentInputSchema`.
- [`server-actions/intents.ts`](./server-actions/intents.ts) — `addIntent`, `updateIntent`, `dismissIntent`, `deleteIntent`; all RLS-scoped via `author_id = auth.uid()`, each `revalidatePath('/atoms/[id]')` so the detail page refreshes.
- [`server-actions/comments.ts`](./server-actions/comments.ts) — `addComment`, `updateComment`, `deleteComment` with the same pattern.
- [`server-actions/atoms.ts`](./server-actions/atoms.ts) — `capture()` now auto-parses free-text intents (no `action_type` chosen) via `parseIntent`. Falls back to `action_type='other'` if the LLM call throws.
- [`<IntentInput>`](./components/capture/intent-input.tsx) — collapsible "+ Add intent" → opens a panel with free-text field, action-type pill chooser (read / reach out / use in / research / review / share / decide / other), and a YYYY-MM-DD due-date input. `serializeIntent` accepts a pill or date with no text and falls back to the action label so a pill-only intent still saves.
- All three `<CaptureBox>` tabs (Text, Upload, Voice) now include `<IntentInput>`.
- [`<IntentsSection>`](./components/atom/intents-section.tsx) — strikethrough-on-close list with inline ✓ done / × dismiss / reopen / trash actions.
- [`<CommentsSection>`](./components/atom/comments-section.tsx) — chronological list with edit-in-place + delete on the author's own rows, plus a composer at the bottom.
- [`<AtomDetail>`](./components/atom/atom-detail.tsx) now renders both sections; the page query in [`atoms/[atomId]/page.tsx`](<./app/(app)/atoms/[atomId]/page.tsx>) fetches comments + intents in parallel with the atom + sources joins.
- [`inngest/functions/process-atom.ts`](./inngest/functions/process-atom.ts) classify step now selects the first intent for the atom and feeds `{text, action_type}` into the classification prompt (was `null`).

**Verified end-to-end**

- Pill + due date (no free text) → intent saves with action label as text (`text="Reach out"`, `action_type=reach_out`, due preserved).
- Free-text intent **"read before Thursday"** → Haiku call logged at $0.000561 (under spec's $0.0006 estimate), 966 ms, returned `action_type=read`, `due_at=2026-06-25T23:59:59Z` (next Thursday).
- Comment composer appends a row with timestamp; edit + delete work on own rows; RLS prevents touching other authors'.
- Intent status toggle to done / dismissed / reopen persists; refresh confirms.
- Build / typecheck / lint clean.

**Deviations from spec**

- **Pill-only intent fallback.** Spec leaves UX silent on "what happens if user picks a pill + date but never types text". My initial implementation dropped the intent silently — fixed by having `serializeIntent` fall back to the pill label as the row text (e.g. `text="Read"`). User can edit later from `<IntentsSection>` once we add an "edit text" affordance there (small follow-up — for now the row text is editable through a future server action).
- **Inline comment edit / intent text edit** — comments get full edit-in-place; intent text editing isn't yet wired into `<IntentsSection>` (status / due / delete are). Server action `updateIntent` already supports it; the UI button just isn't present.

---

## Step 8 — Voice capture (2026-06-16)

**Shipped**

- [`supabase/migrations/0003_voice_storage.sql`](./supabase/migrations/0003_voice_storage.sql) — `voice` Storage bucket (25 MB cap, common audio MIME types), per-user folder RLS policies matching the `uploads` pattern.
- [`lib/openai/whisper.ts`](./lib/openai/whisper.ts) `transcribeFromStorage(path, opts)` — service-role download, Whisper `whisper-1` with `verbose_json` to capture the audio duration, one `llm_call_logs` row written with `use_case='voice.transcribe'` and `cost_usd` derived from duration × $0.006/min.
- [`lib/openai/pricing.ts`](./lib/openai/pricing.ts) — `WHISPER_USD_PER_MINUTE` constant + `computeWhisperCost(duration_sec)` helper.
- [`inngest/functions/process-atom.ts`](./inngest/functions/process-atom.ts) — extract step now handles `source.type='voice'` via `transcribeFromStorage`. Same `save-content` step recomputes `content_hash` from the transcript so dedup is real.
- [`<CaptureBox>`](./components/capture/capture-box.tsx) — Voice tab is live. Records via `MediaRecorder` with MIME negotiation (prefers `audio/webm;codecs=opus`, falls back to `audio/mp4` for Safari), shows live elapsed-time, in-place playback preview, discard / submit flow. Mic stream is stopped + URL objects revoked on stop / submit / unmount.
- [`<AtomDetail>`](./components/atom/atom-detail.tsx) — voice atoms get an embedded HTML5 audio player above the transcript, fed by a 6-hour signed URL minted server-side in the page query.

**Verified locally**

- Recorded ~9 s of German speech → atom flipped to Ready → detail page shows the audio player at top and the transcript ("Test. Das ist eine Testaufnahme.") below.
- `llm_call_logs` row written: `whisper-1`, $0.000876, latency 3.9 s.
- Build / typecheck / lint clean.

**Deviations from spec**

- **Duration-based cost via `response_format: "verbose_json"`** — spec mentions logging duration directly. Whisper's `duration` field on the verbose response gives us the canonical value without a second audio-decode step on our side.
- **Quota update on `quotas.voice_seconds_used`** is still deferred to Step 14 (consistent with how chunk/embed cost handling is split between logging and enforcement).

---

## Step 7 — URL capture with extraction (2026-06-15)

**Shipped**

- [`supabase/migrations/0002_storage.sql`](./supabase/migrations/0002_storage.sql) creates the `uploads` Storage bucket (10 MB cap, `application/pdf` allowlist) plus per-user RLS policies on `storage.objects` (path convention `{user_id}/{uuid}.pdf`).
- [`lib/extraction/url.ts`](./lib/extraction/url.ts) — `extractArticleFromUrl(url)` fetches with a 15 s timeout, a real-browser-ish User-Agent, follows redirects, asserts an HTML content-type, then parses with `@mozilla/readability` + `jsdom`. Returns title / byline / plain text / excerpt / resolved URL.
- [`lib/extraction/pdf.ts`](./lib/extraction/pdf.ts) — `extractPdfFromStorage(path)` downloads via service-role and runs the new pdf-parse 2.x `PDFParse` class API (text + Info dictionary).
- [`/api/capture/upload-signed-url`](./app/api/capture/upload-signed-url/route.ts) — POST returns `{ storage_path, signed_url, token, bucket, expires_at }`. The browser then uses `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)` for a direct PUT.
- [`<CaptureBox>`](./components/capture/capture-box.tsx) — text mode now detects a single URL and switches the submit affordance to **"Fetch article"** with a small hostname banner. **Upload** tab is live with drag-and-drop + click-to-pick PDF (≤10 MB, type-checked), uploads then calls `capture({uploadStoragePath})`.
- [`inngest/functions/process-atom.ts`](./inngest/functions/process-atom.ts) — `extract` step now routes by `source.type`: `url` → Readability, `upload` → pdf-parse, text → passthrough. A new `save-content` step writes the extracted text + a recomputed `content_hash` and stamps `sources.extracted_title` / `extracted_author` from the extractor. The whole function is wrapped in a try/catch that updates `atoms.status='failed'` with `processing_error` before re-throwing — Inngest's `retries: 3` still applies.
- [`retryAtom(atom_id)`](./server-actions/atoms.ts) server action resets status + clears the error and re-fires `atom.created`. Wired into [`<RetryButton>`](./components/atom/retry-button.tsx) which appears in the [`<AtomDetail>`](./components/atom/atom-detail.tsx) failure block.
- AtomDetail surfaces `processing` and `failed` states (failed shows error message + Retry).
- [`<RecentAtoms>`](./components/shared/recent-atoms.tsx) items are now `<Link>`s to `/atoms/[id]` — important because failed atoms have no chapter, so the right rail is the only entry point to their Retry button.
- [`next.config.ts`](./next.config.ts) externalizes `pdf-parse` + `pdfjs-dist` from the server bundle so the pdf.js "fake worker" can resolve `pdf.worker.mjs` on the `node_modules` filesystem.

**Verified locally**

- Real article URL → atom Ready with extracted title + body, original URL preserved.
- Paywalled / non-HTML URL → atom flips to `failed` with a readable error message.
- 1-page PDF upload → uploaded via signed URL → extracted text appears in atom content.
- Failed atom → click from right rail → Retry button on detail page re-fires the pipeline.
- Build / typecheck / lint clean.

**Deviations from spec**

- **`pdf-parse` is on 2.x with the new `PDFParse` class API** (not the 1.x default export). Same library; just modernized.
- **Externalized `pdf-parse` + `pdfjs-dist`** via `next.config.ts` — pdf.js's worker file isn't bundle-friendly. Cheap and stable.
- **Failed atoms aren't surfaced in chapter feeds** — they have `primary_chapter_id = null` (classification never ran), so by construction they can't belong to a chapter. The right-rail recent list is their entry point; the "(extraction failed)" placeholder makes them obvious.

**Open items**

- The "Fetch article" UI inside the Text tab covers the spec's "single URL → URL submit" requirement, but we don't yet show a pre-fetch preview. Real previewing (title + thumbnail before submit) can land if the UX warrants it.
- Inngest dev-server polls flood the dev log. Not blocking, but worth tightening with a log filter eventually.

---

## Step 6 — Chapter & atom browse UI (2026-06-11)

**Shipped**

- [`server-actions/chapters.ts`](./server-actions/chapters.ts) — `createChapter`, `renameChapter`, `archiveChapter`. Each validates with zod, scopes the write to the user's personal workspace via RLS, and `revalidatePath("/", "layout")` so the sidebar re-fetches.
- Route group split: [`app/(app)/(with-rail)/`](<./app/(app)/(with-rail)>) mounts `<RightRail>`; the bare [`app/(app)/`](<./app/(app)>) layout drops it. The home page moved into `(with-rail)`; `/atoms/[atomId]` lives directly under `(app)` so its detail view fills the width.
- [`<Sidebar>`](./components/shared/sidebar.tsx) now renders the actual chapter list (active chapters only, ordered by `sort_order`) with a `+` trigger that opens [`<NewChapterDialog>`](./components/chapter/new-chapter-dialog.tsx).
- [`/chapters`](<./app/(app)/(with-rail)/chapters/page.tsx>) — all-chapters list with atom counts via nested PostgREST select.
- [`/chapters/[chapterId]`](<./app/(app)/(with-rail)/chapters/[chapterId]/page.tsx>) — chronological feed of `<AtomCard>` (status=ready, newest first) with [`<ChapterHeader>`](./components/chapter/chapter-header.tsx) doing inline rename and kebab → Archive.
- [`<AtomCard>`](./components/atom/atom-card.tsx) — source icon, derived title (extracted title or first non-empty line), one-line snippet, chapter pill, capture-comment indicator, relative time.
- [`/atoms/[atomId]`](<./app/(app)/atoms/[atomId]/page.tsx>) renders [`<AtomDetail>`](./components/atom/atom-detail.tsx): back-link to chapter, header (title + source + captured-at), serif content body, capture-note block when present, plus a stub explaining that comments/intents/related are coming.
- Empty states on `/chapters`, the chapter feed, and the sidebar chapter list.

**Verified**

- Sidebar lists all active chapters; clicking each lands on its feed.
- Atom card click → detail page renders; right rail is gone there only.
- Inline rename ✓; archive removes the chapter from sidebar + `/chapters` (`archived_at` is set, row preserved).
- `+ New chapter` dialog creates a chapter that immediately appears in the sidebar.
- Build / typecheck / lint clean.

**Deviations from spec**

- **Right rail collapses → fully hidden** on `/atoms/[atomId]`. Spec says "collapses"; for MVP "hidden via route group" is simpler than a partially-collapsed sidebar, and is what the build plan permits.
- **No filter bar on chapter feed yet.** Spec §6.4 mentions filter by intent / date; deferred until intents land in Step 9 (filter by intent type is meaningless without intents).
- **No chapter-change dropdown on atom detail.** Spec §6.4 §1 lists "primary chapter (clickable, can be changed via dropdown)"; we show the chapter as a link to its feed but don't yet allow reassigning. That's small follow-up — flagging here.

---

## Step 5 — Capture pipeline foundation (text only) (2026-06-10)

**Shipped**

- [`lib/openai/{client,pricing,embeddings}.ts`](./lib/openai) — singleton OpenAI client and `embedBatch(texts, opts)` that batches at 100/call against `text-embedding-3-small` (1536 dims), with a `llm_call_logs` row written per call.
- [`lib/chunking/{tokens,chunker}.ts`](./lib/chunking) — `js-tiktoken`-based token counting and a paragraph-first → sentence → word fallback chunker (target 600 tokens, max 800, 100-token overlap) per `docs/05-llm-operations.md` §5.7.
- [`lib/prompts/classify-chapter.ts`](./lib/prompts/classify-chapter.ts) — §5.4.2 system prompt verbatim plus a `renderClassifyUserPrompt` template.
- [`lib/anthropic/client.ts`](./lib/anthropic/client.ts) — added a non-streaming `callClaude()` companion to `callClaudeStream` so background jobs can do single-shot completions with the same cost-logging discipline.
- [`lib/inngest/client.ts`](./lib/inngest/client.ts) — singleton `Inngest` client and a typed `AtomCreatedEvent` via `eventType()` + `staticSchema()` (Inngest 4.5 dropped `EventSchemas`).
- [`inngest/functions/process-atom.ts`](./inngest/functions/process-atom.ts) — the 8-step pipeline: load → text passthrough (URL/PDF/voice extract no-op until Steps 7–8) → chunk → embed → save-chunks → classify (Haiku, JSON, one retry) → record-suggestion + assign primary_chapter_id → mark-ready. Link proposal step is a no-op per the build-plan deferral to Step 12.
- [`app/api/inngest/route.ts`](./app/api/inngest/route.ts) — Next.js serve handler exporting GET/POST/PUT.
- [`server-actions/atoms.ts`](./server-actions/atoms.ts) `capture(input)` — zod-validates, inserts `sources` + `atoms` (+ optional `intents`), `inngest.send('atom.created', …)`, returns `{atom_id}`. Cleanly surfaces the `(workspace_id, content_hash)` unique-violation as `duplicate_content`.
- [`<CaptureBox>`](./components/capture/capture-box.tsx) — text-mode active; Voice + Upload tabs scaffolded as disabled.
- [`<RightRail>`](./components/shared/right-rail.tsx) + [`<RecentAtoms>`](./components/shared/recent-atoms.tsx) — right-rail container with a polling list (3 s tick) that flips Processing → Ready and labels the assigned chapter.
- [`app/(app)/layout.tsx`](<./app/(app)/layout.tsx>) gained the right rail beside the main content.
- [`proxy.ts`](./proxy.ts) public-paths list now includes `/api/inngest` so cloud/dev-server pings aren't bounced to `/login`.
- `package.json` gained `pnpm inngest:dev` (`pnpm dlx inngest-cli@latest dev`) and `INNGEST_DEV=1` is documented in [`.env.local.example`](./.env.local.example) for local dev (production uses real signing keys instead).

**Verified end-to-end with the local Inngest dev server**

- Paste of text → toast → atom appears as "Processing…" in the right rail.
- Within ~3 s the pill flips to "Ready" and the chapter label appears.
- Service-role REST queries confirm: `atoms.status='ready'`, `primary_chapter_id` set, `content_hash` set; one `chunks` row with `embedding_dim=1536`; one `suggestions` row of `type='chapter_assignment'` with the LLM's confidence/reasoning preserved; `llm_call_logs` rows for both `embed.chunk` (openai) and `capture.classify` (anthropic, claude-haiku-4-5).
- Inngest dashboard at `localhost:8288/runs` shows every step green.

**Deviations from spec**

- **`@dqbd/tiktoken` → `js-tiktoken`.** Spec named a now-abandoned package; same `cl100k_base` encoding, pure-JS, maintained.
- **Realtime broadcast (`atom.ready`) skipped.** Build plan explicitly allows "poll or refresh for now"; `RecentAtoms` polls every 3 s. Realtime can swap in later without UI changes.
- **`propose_links` step is a no-op.** Per the build plan that lands in Step 12 along with the link-resolution UI.
- **Quota enforcement still deferred** to Step 14, same reasoning as Step 4.
- **Permissive RLS policy added for `sources`.** Spec §3.3 omits this table; Supabase enables RLS by default, so `capture()` couldn't insert without a policy. Granted `for all to authenticated`; user-facing access is gated by `atoms` RLS through the FK.
- **Inngest API changed.** `EventSchemas` is gone; switched to `eventType('atom.created', { schema: staticSchema<…>() })` and `createFunction({ id, triggers: [event], retries }, handler)`.

**Production verified (same day, 2026-06-11)**

- `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` pushed to all three Vercel envs.
- App synced in Inngest Cloud → <https://second-red.vercel.app/api/inngest>.
- Live capture on production confirms the same pipeline runs end-to-end: atom flipped to `ready` in ~10 s, chunk has `embedding_dim=1536`, suggestion row written with `confidence=0.92`, both `embed.chunk` and `capture.classify` `llm_call_logs` rows present and `succeeded=true`.

**Open items**

- Preview deployments share the production Inngest signing key, so a preview's events go into the prod Inngest environment. Acceptable for MVP; worth splitting into a separate Inngest env if preview traffic ever picks up.
- Cost reporting precision: `llm_call_logs.cost_usd` is `numeric(10,6)`, which rounds tiny embed calls to $0.000000. Acceptable until per-user cost rollups need accuracy below 0.0001¢.

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
