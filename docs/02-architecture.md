# 02 — Architecture

## 2.1 Tech stack (decided)

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend framework | Next.js 15 (App Router) | Server Components by default; Server Actions for mutations |
| Hosting (FE + API) | Vercel | Free tier sufficient for MVP |
| Database | Supabase Postgres + pgvector | Single DB for relational + vector; HNSW index for vectors |
| Auth | Supabase Auth | Email + Google OAuth at MVP |
| File storage | Supabase Storage | Audio, PDF originals |
| Realtime | Supabase Realtime | Used for "atom processing complete" updates |
| LLM | Anthropic Claude API | `claude-haiku-4-5-20251001` for routine, `claude-sonnet-4-6` for synthesis |
| Embeddings | OpenAI `text-embedding-3-small` | 1536-dim, $0.02/1M tokens; swap to Voyage AI later if needed |
| Transcription | OpenAI Whisper (`whisper-1`) | $0.006/minute |
| Web extraction | Mozilla Readability (via `@mozilla/readability`) + `jsdom` | Same lib Obsidian Clipper uses |
| PDF extraction | `pdf-parse` for text-heavy PDFs; fallback OCR via Tesseract only if Phase 6 | |
| Background jobs | Inngest | Serverless queue; integrates with Next.js cleanly |
| UI library | shadcn/ui (Radix + Tailwind) | |
| Styling | Tailwind CSS | |
| Forms | `react-hook-form` + `zod` | |
| State (client) | React Context + URL state | TanStack Query for server state |
| Validation | `zod` | Used both client and server |
| Observability | Vercel Analytics + Supabase logs + custom cost log table | |
| Error tracking | Sentry (free tier) | |
| Email | Resend | For magic link auth, future digest emails |

## 2.2 Why these choices

**Supabase + Vercel:** the user has decided. They give Postgres + Auth + Storage + Realtime in one bundle, and Vercel is the canonical Next.js host. Both have generous free tiers and EU regions when needed.

**pgvector over a dedicated vector DB:** simpler architecture, one DB to back up, one DB to run RLS through. HNSW indexes in pgvector handle millions of vectors well; the user will never approach that volume in MVP. Migrating to Qdrant or Pinecone later is trivial if needed (embeddings are just numbers + metadata).

**Inngest over Supabase cron + Edge Functions:** Inngest provides proper retries, observability, step orchestration, and event-driven flows. Background work in Lattice (extracting URLs, embedding chunks, generating link suggestions) involves multiple LLM calls per atom and benefits from step-level retry and visibility. Supabase pg_cron is fine for simple scheduled jobs (daily digest in Phase 2) but is the wrong shape for multi-step flows.

**OpenAI for embeddings and Whisper:** Anthropic does not currently provide first-party embedding or transcription. Voyage AI is Anthropic's recommended embedding partner, but `text-embedding-3-small` is half the price for similar quality at MVP scale. Easy to swap.

**Mozilla Readability for URL extraction:** battle-tested, what Obsidian Clipper and Pocket use. Run server-side via `jsdom`.

## 2.3 System diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                          Client (browser)                        │
│  Next.js Server Components + Client Components (shadcn/ui)       │
└──────────────────────────────────────────────────────────────────┘
                  │ HTTPS              ▲ Supabase Realtime
                  ▼                    │ (processing complete)
┌──────────────────────────────────────────────────────────────────┐
│                       Vercel (Next.js runtime)                   │
│  ┌─────────────────────┐  ┌─────────────────────────────────┐   │
│  │  Server Actions     │  │  Route Handlers (REST endpoints)│   │
│  │  (mutations)        │  │  /api/capture, /api/ask, etc.   │   │
│  └─────────────────────┘  └─────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
        │                      │                   │
        ▼                      ▼                   ▼
┌──────────────┐      ┌──────────────────┐   ┌────────────────┐
│   Supabase   │      │    Inngest       │   │  Anthropic API │
│  Postgres +  │      │  (background     │   │   OpenAI API   │
│  pgvector,   │      │   jobs:          │   │   Whisper API  │
│  Auth,       │      │   ingestion,     │   └────────────────┘
│  Storage,    │      │   link gen,      │
│  Realtime    │      │   daily digest)  │
└──────────────┘      └──────────────────┘
```

## 2.4 Request flows (Phase 1)

### Capture flow

1. User types/pastes content into the Capture box, optionally with comment + intent + chapter selection.
2. Client POSTs `/api/capture` with content, optional URL, optional file ref, optional voice ref, comment, intent.
3. Server creates an `atom` row with status=`processing`, the user's comment, and any intent. Returns the atom ID immediately so the UI can show it as "pending".
4. Server sends an `atom.created` event to Inngest.
5. Inngest job pipeline:
   - **extract**: if URL → fetch and run Readability; if PDF ref → extract text; if voice ref → call Whisper; if plain text → pass through.
   - **chunk**: split into chunks (target 400–800 tokens, semantic boundaries when possible).
   - **embed**: call OpenAI embeddings on each chunk (batch up to 100/call).
   - **classify**: call Haiku with content + comment + intent + user model → suggested chapter (existing or new).
   - **propose_links**: vector-search top-N similar atoms, call Haiku to filter to genuine semantic matches → write `links` rows with status=`suggested`.
   - **mark_ready**: update atom status to `ready`; publish Supabase Realtime event.
6. Client receives the realtime event, refreshes atom view with suggested chapter and links.

### Q&A flow

1. User submits question in the Q&A box.
2. Server route `/api/ask` runs:
   - Embed question via OpenAI.
   - Hybrid retrieve: top-K chunks by cosine similarity + top-K by full-text rank, fused via Reciprocal Rank Fusion (RRF).
   - Build prompt with retrieved chunks (each prefixed with its atom ID), the question, and the user model.
   - Call Sonnet 4.6 with system prompt instructing it to cite atoms by ID in `[atom:UUID]` form.
   - Parse response, replace `[atom:UUID]` tokens with rich links to atom detail pages.
   - Return answer + list of cited atoms.
3. Client renders answer with clickable citations.

### Onboarding flow

1. After signup, user lands on `/onboarding`.
2. Server initiates a stateful chat with Sonnet 4.6 using the onboarding system prompt (see `05-llm-operations.md`).
3. Each user message → Sonnet response, until Sonnet signals "I have enough" by emitting a structured tool-call-style response containing `{ projects: [...], people: [...], vocabulary: [...], suggested_chapters: [...] }`.
4. Server writes a `user_models` row and creates the `chapters` rows from `suggested_chapters`.
5. User is redirected to the main app.

## 2.5 Data flow principles

- **Atoms are immutable in content.** Edits to "what was captured" are not allowed; if the user wants to revise, they create a new atom or amend via comment.
- **The atom is the user's mental unit; chunks are internal.** No UI ever shows raw chunks. Search results are presented as atom snippets with the matching chunk highlighted.
- **All LLM calls are logged.** Every call writes to `llm_call_logs` with user_id, model, input/output token counts, latency, and use case. This is the basis of cost telemetry and the dataset for future fine-tuning.
- **All system-proposed changes are explicit `suggestion` rows.** No silent rewrites of structure. Chapter assignments at capture time are pre-confirmed but still recorded as suggestions for audit.

## 2.6 Project structure

```
/lattice
├── app/                          # Next.js App Router
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (app)/                    # Authenticated routes
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Dashboard / capture
│   │   ├── chapters/
│   │   │   ├── page.tsx          # Chapter list
│   │   │   └── [chapterId]/
│   │   │       └── page.tsx      # Atoms in chapter
│   │   ├── atoms/[atomId]/page.tsx
│   │   ├── ask/page.tsx          # Q&A
│   │   ├── search/page.tsx
│   │   └── user-model/page.tsx
│   ├── onboarding/page.tsx
│   ├── api/
│   │   ├── capture/route.ts
│   │   ├── ask/route.ts
│   │   ├── inngest/route.ts      # Inngest webhook
│   │   └── auth/callback/route.ts
│   └── layout.tsx
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── capture/                  # Capture box, comment/intent fields
│   ├── atom/                     # Atom card, detail view
│   ├── chapter/                  # Chapter list, picker
│   └── shared/
├── lib/
│   ├── supabase/                 # Supabase client (server + browser)
│   ├── anthropic/                # Claude wrapper with cost logging
│   ├── openai/                   # Embeddings + Whisper wrappers
│   ├── inngest/                  # Inngest client + functions
│   ├── extraction/               # Readability, PDF parsing
│   ├── chunking/
│   ├── retrieval/                # Hybrid search
│   └── prompts/                  # All prompt templates
├── server-actions/
│   ├── atoms.ts
│   ├── chapters.ts
│   ├── intents.ts
│   └── user-model.ts
├── inngest/
│   └── functions/
│       ├── process-atom.ts
│       └── ... (more in later phases)
├── types/                        # Zod schemas + TS types
├── tests/
│   ├── unit/
│   └── integration/
├── supabase/
│   ├── migrations/               # SQL migrations
│   └── seed.sql
├── package.json
├── tsconfig.json
└── README.md
```

## 2.7 Environment variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server-only

# LLM providers
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# App
NEXT_PUBLIC_APP_URL=

# Email (Phase 2+)
RESEND_API_KEY=

# Observability
SENTRY_DSN=                       # optional in MVP
```

## 2.8 Cost model & guard rails

Tracked in `llm_call_logs`. Hard caps per free-tier user per month:

| Operation | Model | Approx cost/call | Free-tier monthly cap | Rationale |
|-----------|-------|------------------|----------------------|-----------|
| Chapter classification at capture | Haiku 4.5 | ~$0.0005 | 200 captures | Light, frequent |
| Link suggestion (per atom) | Haiku 4.5 | ~$0.001 | (bundled with capture) | |
| Q&A | Sonnet 4.6 | ~$0.005–0.02 | 50 questions | Most expensive |
| Voice transcription | Whisper | $0.006/min | 5 minutes total | |
| Onboarding interview | Sonnet 4.6 | ~$0.02 one-time | 1 per user | |
| Embedding (per chunk) | text-embedding-3-small | <$0.0001 | (bundled with capture) | Negligible |

Free-tier user worst case: ~€0.40/month in LLM costs. Paid tier (€19/month) covers ~30× free usage with comfortable margin.

Hard implementation rules:
- Every LLM call goes through a wrapper that records token counts to `llm_call_logs`.
- Before each call, check user's current month spend. If over cap, return a structured "quota exceeded" error.
- Use prompt caching (Anthropic's `cache_control`) aggressively for system prompts and the user model — these are reused across many calls per session.
