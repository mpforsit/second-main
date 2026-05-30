# 07 — Phase 1 Build Plan

This is the operative document for actually building the MVP. It is a sequence of 15 discrete steps, each sized to be one focused coding session (roughly 2–6 hours with an LLM pair) with a clear, testable outcome.

For each step:
- **Goal:** the user-facing capability being added.
- **Inputs:** which other spec docs to load into your coding LLM's context.
- **Deliverables:** code/files produced.
- **Verification:** how you know it works.

When kicking off each step with the coding LLM, paste the **Step N** section plus the specs in **Inputs** into context. End each session by asking the LLM to update `PROGRESS.md` with: step number, what was done, deviations from spec, open questions.

---

## Step 1 — Project bootstrap and base infra

**Goal:** A Next.js 15 project deployed to Vercel with Supabase connected, Tailwind + shadcn/ui set up, and a "hello world" page accessible.

**Inputs:** `02-architecture.md` §2.1, §2.6, §2.7; `09-conventions.md` §9.1.

**Deliverables:**
- Next.js 15 project (App Router, TS, src dir or app dir — pick app dir).
- Tailwind + shadcn/ui configured. Install `button`, `input`, `card`, `dialog`, `dropdown-menu`, `tabs`, `toast` to start.
- `next-themes` for dark mode toggle.
- Supabase project created (web console). Local `.env.local` populated. `@supabase/ssr` client wrappers in `/lib/supabase/{server.ts, browser.ts}`.
- Root `layout.tsx` with theme provider, toast provider.
- Placeholder home page `/` showing "Lattice" + dark mode toggle.
- Deployed to Vercel (preview deployment OK).
- Repo on GitHub with sensible `.gitignore`, `README.md` (copied from `/lattice-spec/README.md` short version), and a `PROGRESS.md` initialized.

**Verification:**
- Visit deployed URL; see the page; toggle dark mode.
- `supabase.auth.getUser()` returns null cleanly from the browser client.

---

## Step 2 — Database migrations & RLS

**Goal:** Apply the complete Phase 1 schema to Supabase. Verify RLS denies cross-user access.

**Inputs:** `03-data-model.md` (all).

**Deliverables:**
- `/supabase/migrations/0001_init.sql` containing all tables, indexes, RLS policies, triggers, and the `search_chunks` function from `03-data-model.md`.
- `/supabase/seed.sql` with no rows (we don't need seed data — the user-trigger creates everything on first signup).
- README addition explaining how to apply migrations locally with the Supabase CLI and remotely via the dashboard.

**Verification:**
- Run migrations on the Supabase dev project successfully.
- In the SQL editor, attempt cross-user reads with `set local role authenticated; set local "request.jwt.claim.sub" = '<other-user-uuid>';` — confirm zero rows returned for restricted tables.
- Create a test user via Supabase Auth; confirm `profiles`, `workspaces`, `workspace_members`, `user_models`, `quotas` rows are auto-created by the trigger.

---

## Step 3 — Auth pages and protected routes

**Goal:** User can sign up and sign in (email/password and Google OAuth). Authenticated routes redirect unauthenticated users to `/login`.

**Inputs:** `04-api-spec.md` §4.3 (auth callback); `06-frontend-spec.md` §6.3, §6.4 (just the login/signup pages).

**Deliverables:**
- `/app/(auth)/login/page.tsx` with email/password form + Google button.
- `/app/(auth)/signup/page.tsx` likewise.
- `/app/api/auth/callback/route.ts` handling the OAuth code exchange.
- Middleware in `/middleware.ts` that protects `/(app)/*` and `/onboarding` routes, redirecting unauthenticated users to `/login`.
- A `useUser()` hook for client components.
- `signOut()` action wired into a placeholder sidebar.

**Verification:**
- Sign up new user via email; receive Supabase confirmation email; sign in.
- Sign in with Google.
- Visit `/` while signed out → redirected to `/login`.
- Visit `/` signed in → see authenticated page (still placeholder).
- Sign out clears session.

---

## Step 4 — Onboarding interview

**Goal:** New users complete a 2-minute conversational interview that populates their `user_models` row and creates initial chapters.

**Inputs:** `01-product-spec.md` §1.4 (user model definition); `05-llm-operations.md` §5.4.1; `04-api-spec.md` §4.3 `/api/onboarding/chat` and §4.2 `completeOnboarding`; `06-frontend-spec.md` §6.4 `<OnboardingChat>`.

**Deliverables:**
- `/app/onboarding/page.tsx` with the chat UI.
- `/app/api/onboarding/chat/route.ts` streaming the Anthropic Sonnet response.
- `/lib/anthropic/client.ts` wrapper (will be reused everywhere) with cost logging — see `05-llm-operations.md` §5.2.
- `/lib/prompts/onboarding.ts` containing the exact system prompt.
- `completeOnboarding` server action in `/server-actions/user-model.ts`.
- Detection logic in the chat UI to parse `<onboarding_complete>` block.
- Redirect logic: after auth, if `user_models.onboarding_completed_at` is null → `/onboarding`; else → `/`.

**Verification:**
- Sign up a fresh user; lands on onboarding.
- Complete the conversation; arrives at confirmation screen with proposed chapters.
- Confirm: `user_models.model` is populated, 4–8 `chapters` rows created, `onboarding_completed_at` set.
- Refresh the app: now lands on `/` instead of onboarding.
- Check `llm_call_logs` has rows for the onboarding calls with non-zero cost.

---

## Step 5 — Capture pipeline foundation (text paste only)

**Goal:** User can paste text into a capture box on `/`, hit submit, and an atom is created. Background processing chunks, embeds, classifies into a chapter, and marks ready. Atom appears in the chapter feed.

**Inputs:** `02-architecture.md` §2.4 (capture flow); `03-data-model.md` (atoms, chunks, sources, suggestions); `04-api-spec.md` §4.2 `capture`, §4.4 `process-atom`; `05-llm-operations.md` §5.4.2, §5.5, §5.7; `06-frontend-spec.md` §6.4 `<CaptureBox>` (text mode only).

**Deliverables:**
- `<CaptureBox>` component (text mode only; tabs scaffolded but other tabs disabled).
- `capture` server action.
- Inngest project initialized; `process-atom` function written end-to-end except the URL/PDF/voice branches (those just no-op for now).
- `/lib/chunking/chunker.ts` with the strategy described in §5.7.
- `/lib/openai/embeddings.ts` wrapper with batching and cost logging.
- `/lib/prompts/classify-chapter.ts` with the chapter classification prompt.
- Classifier logic: parses JSON; on `decision: 'new'`, creates a new `chapters` row; updates atom's `primary_chapter_id`.
- Suggestion logging: every classifier output writes a `suggestions` row of type `chapter_assignment` or `new_chapter`.

**Verification:**
- Paste a paragraph of text. Atom appears as "Processing…" in the right rail.
- Within 10–15 seconds, atom status becomes `ready` (poll or refresh for now).
- `atoms` row has content, `primary_chapter_id` set, `content_hash` set.
- Chunks exist with embeddings (check `vector_dims(embedding)` returns 1536).
- A `suggestions` row exists in the audit trail.
- `llm_call_logs` has rows for embedding + classification with non-zero costs.

---

## Step 6 — Chapter & atom browse UI

**Goal:** User can navigate to a chapter and see all atoms in it (chronological feed). User can click an atom to see its full detail view.

**Inputs:** `06-frontend-spec.md` §6.4 `<AtomCard>`, `<AtomDetail>`, `<ChapterFeed>`; `04-api-spec.md` §4.2 (`renameChapter`, `archiveChapter`, `createChapter`).

**Deliverables:**
- Sidebar component showing chapter list (queried server-side; refetched on chapter changes).
- `/app/(app)/chapters/page.tsx` showing all chapters.
- `/app/(app)/chapters/[chapterId]/page.tsx` showing atom feed.
- `/app/(app)/atoms/[atomId]/page.tsx` showing atom detail. Right rail collapses on this page.
- `<AtomCard>` and `<AtomDetail>` components.
- Server actions for create/rename/archive chapter.
- Inline edit affordance on chapter detail page.
- Empty states.

**Verification:**
- Capture 3–5 atoms across different topics; verify they're distributed across chapters meaningfully.
- Navigate to a chapter; see the atoms.
- Click an atom; see content, capture comment, primary chapter.
- Create a new chapter manually; rename it; archive it; verify it disappears from the list but still exists in DB.

---

## Step 7 — URL capture with extraction

**Goal:** Paste a URL into the capture box; extracted article text becomes the atom content. PDF upload also works.

**Inputs:** `02-architecture.md` §2.4; `04-api-spec.md` §4.3 (`/api/capture/upload-signed-url`); §4.4 (extract step of process-atom).

**Deliverables:**
- `/lib/extraction/url.ts` using `@mozilla/readability` + `jsdom` to extract main content + title + author from a URL.
- `/lib/extraction/pdf.ts` using `pdf-parse` to extract text from a PDF.
- URL detection in `<CaptureBox>` text mode: if the input is a single URL, show a "Fetch article" preview that's submitted as `url` rather than `text`.
- Upload tab in `<CaptureBox>`: drag-and-drop or file picker for PDFs; client uploads directly to Supabase Storage via signed URL.
- `process-atom` Inngest function's `extract` step now handles `url` and `upload` source types.

**Verification:**
- Paste a New York Times URL; extracted article text appears as atom content; original URL preserved in `sources.original_url`; extracted title used.
- Paste a paywalled URL → extraction returns whatever can be scraped; capture comment field lets user add the missing context.
- Upload a 10-page PDF; text extracted; atom marked ready.
- Handle extraction failures gracefully: atom marked `failed`, error visible in detail view, retry button available.

---

## Step 8 — Voice capture

**Goal:** User can record a voice memo from the browser, it gets transcribed by Whisper, and the transcription becomes the atom content. The original audio is preserved in Storage.

**Inputs:** `04-api-spec.md` §4.3; `05-llm-operations.md` §5.6; `06-frontend-spec.md` §6.4 `<CaptureBox>` voice mode.

**Deliverables:**
- Voice tab in `<CaptureBox>` with record/stop/playback controls using `MediaRecorder`.
- Client uploads audio (webm or mp4) to Supabase Storage via signed URL.
- `process-atom` Inngest function's `voice` extract branch using `/lib/openai/whisper.ts`.
- Storage organization: `voice/{user_id}/{atom_id}.{ext}`.
- Voice atoms show a tiny audio player in detail view (linking to the original recording).

**Verification:**
- Record 20 seconds saying something specific.
- Atom appears with the transcribed text.
- Audio plays back from the atom detail page.
- Cost telemetry records the duration.

---

## Step 9 — Comments and intents

**Goal:** Users can add comments and intents to atoms — both at capture time and later on the detail view.

**Inputs:** `03-data-model.md` (comments, intents); `04-api-spec.md` §4.1 (Intent schemas), §4.2; `06-frontend-spec.md` §6.4 (`<AtomDetail>` notes + intents section).

**Deliverables:**
- Intent input in `<CaptureBox>`: action-type pill chooser, optional due-date picker, free-text field. All optional; if user types free text without picking action_type, call the intent-parse Haiku endpoint to fill it in (`05-llm-operations.md` §5.4.5).
- Comments composer in `<AtomDetail>`.
- Inline status toggle for intents (open → done/dismissed).
- Edit/delete intent.
- Server actions: `addComment`, `updateComment`, `deleteComment`, `addIntent`, `updateIntent`, `dismissIntent`.

**Verification:**
- Capture an atom with comment + intent; both visible on the detail page.
- Add another comment later; appears with timestamp.
- Toggle intent status; persists.
- Capture with free-text intent ("read before Thursday"); action_type inferred as `read`, due_at as next Thursday.

---

## Step 10 — Hybrid search

**Goal:** A search box (and a `/search` page) where the user can type a free-text query and get back a ranked list of matching atoms.

**Inputs:** `03-data-model.md` §3.5 (`search_chunks` function); `04-api-spec.md`; `06-frontend-spec.md`.

**Deliverables:**
- `/lib/retrieval/search.ts` with a `searchAtoms(workspace_id, query, limit)` function that:
  1. Embeds the query.
  2. Calls `search_chunks` RPC.
  3. Groups by atom; loads atom metadata.
  4. Returns atoms with the matching chunk's text highlighted.
- `/app/(app)/search/page.tsx` with input + results list (using `<AtomCard>` with highlighted snippet).
- Global `Cmd+K` search palette (basic version) that hits the same function.

**Verification:**
- Search for a term that exists in an atom; the atom is returned with the matching chunk highlighted.
- Search for a semantically related term (synonym, paraphrase) that does NOT literally appear — vector search returns the atom.
- Both signals fuse: a query with both literal and semantic matches surfaces the right results.

---

## Step 11 — Q&A mode

**Goal:** User types a question on `/ask`, gets a streaming answer with inline citations linking to atoms.

**Inputs:** `04-api-spec.md` §4.3 `/api/ask`; `05-llm-operations.md` §5.4.4; `06-frontend-spec.md` §6.4 `<AskInterface>`.

**Deliverables:**
- `/app/api/ask/route.ts` implementing the streaming Q&A flow.
- `<AskInterface>` page rendering streamed tokens and replacing `[atom:UUID]` citations with clickable links.
- Citation post-processing: as tokens stream, accumulate text and replace citations once the closing `]` is seen.
- Show cited-atom list as `<AtomCard>` below the answer.
- Persist Q&A history (Phase 2 will surface this; MVP just keeps the last 10 in `localStorage` on the client, plus a `qa_history` table is optional — skip for MVP).

**Verification:**
- Capture 5–10 atoms about a topic; ask a question. Answer arrives streaming with citations.
- Click a citation; navigate to the cited atom.
- Ask a question outside the corpus; the model says "I don't have anything captured about that" honestly.

---

## Step 12 — Link suggestions UI

**Goal:** When a new atom is created, the system proposes related-atom links. User can ✓ confirm or ✗ veto each. Vetoed links are not re-proposed.

**Inputs:** `03-data-model.md` (links); `04-api-spec.md` §4.2 `resolveLink`; `05-llm-operations.md` §5.4.3; `06-frontend-spec.md` §6.4 `<AtomDetail>` related section.

**Deliverables:**
- `<AtomDetail>` "Related" section showing all links involving this atom, with:
  - Status indicator (suggested / confirmed).
  - Linked atom title + chapter.
  - ✓ / ✗ buttons for suggested links.
  - Kebab menu to remove confirmed links.
- `resolveLink` server action.
- In the Inngest `process-atom` function: the propose_links step writes `links` rows with status `suggested`, excluding any atom pairs already in a `vetoed` link.
- Pending-suggestions count badge in sidebar (number of open `suggestions` of type `link`).

**Verification:**
- Capture a new atom that's clearly related to an existing one; a suggested link appears in both atoms' Related sections.
- Veto a link; it stays in the table with status `vetoed`; capture a similar atom again; the same pair is NOT re-proposed.
- Confirm a link; it persists in the Related section.

---

## Step 13 — User Model viewer / editor

**Goal:** User can view and edit their User Model on a dedicated page. Changes are persisted and used in subsequent LLM calls.

**Inputs:** `01-product-spec.md` §1.4; `04-api-spec.md` §4.1 `UserModelSchema`; `06-frontend-spec.md` §6.4 `<UserModelEditor>`.

**Deliverables:**
- `/app/(app)/user-model/page.tsx` with editable lists for projects, people, vocabulary.
- `updateUserModel` server action.
- Client-side dirty tracking; save button enabled when changes pending.

**Verification:**
- Open the page, see projects/people from onboarding.
- Add a new project; save; refresh; persists.
- Make a Q&A query; LLM responses reflect the updated user model (e.g., when asked "what am I working on", the answer mentions the new project).

---

## Step 14 — Cost telemetry & quota enforcement

**Goal:** Per-user LLM spend is tracked in `llm_call_logs` from every call (already wired in earlier steps). The `quotas` row is updated as calls happen. When a user hits the free-tier cap, further LLM calls return `quota_exceeded`.

**Inputs:** `02-architecture.md` §2.8; `04-api-spec.md` §4.5.

**Deliverables:**
- Quota guard middleware applied to the Anthropic and OpenAI wrappers: before each call, read the user's current month `quotas.cost_usd_used` (or computed sum) and abort if exceeded.
- After each successful call, atomically increment `quotas.cost_usd_used` (use a Postgres `update ... returning` or transactional function).
- Settings page (`/settings`) showing current month usage: captures, questions, voice minutes, total cost.
- Friendly modal/toast when quota is exceeded with a "remaining this month" breakdown.
- Monthly reset: `pg_cron` job that runs on the 1st of each month resetting all `quotas` rows for the new month.

**Verification:**
- Manually set a user's `quotas.cost_usd_used` to the free-tier cap; attempt Q&A; receive `quota_exceeded`.
- Wait for cron reset (or trigger manually); usage resets.

---

## Step 15 — Polish, error handling, deploy

**Goal:** MVP is production-ready: error states everywhere, loading states everywhere, dark mode polished, sane defaults, deployed on Vercel + Supabase production.

**Deliverables:**
- Sentry integration for client + server errors.
- Toast on every server-action failure with a clear message (using the error code mapping from `09-conventions.md`).
- Loading skeletons for chapter feed, atom detail, Q&A.
- Empty states everywhere.
- Production Supabase project (separate from dev) with migrations applied.
- Production Vercel project with env vars.
- Custom domain (optional).
- Pre-launch checklist completed (see `09-conventions.md` §9.6).

**Verification:**
- Walk through the full happy path on production with a fresh user account: signup → onboarding → capture (each input mode) → browse → ask → see related atoms → check user model. No errors, no missing states.
- Intentionally break a flow (kill network during capture); verify graceful failure.

---

## Working with the coding LLM

A few rules that make this faster:

1. **One step per session.** Don't try to combine.
2. **Always include `03-data-model.md`** in context — it's referenced by almost everything.
3. **For LLM-related steps (4, 5, 9, 11, 12), include `05-llm-operations.md`.**
4. **For UI steps, include `06-frontend-spec.md`.**
5. **Maintain `PROGRESS.md`** as a chronological log; the coding LLM should append to it at the end of each session with: what shipped, deviations, open questions.
6. **Write tests as you go** — integration tests for server actions, unit tests for chunking/extraction/cost computation. Skip UI snapshot tests in MVP.
7. **Commit per logical unit, not per step.** Each step might produce 5–15 commits.

After Step 15 you have a deployable MVP. Spend 2 weeks using it yourself daily before opening it up. Then 2–3 design partners. Then proceed to `08-roadmap.md`.
