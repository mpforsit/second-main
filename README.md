# Lattice — Implementation Specification

> **Working codename:** Lattice. Rename freely (global find/replace on `Lattice`/`lattice`).
> **Status:** v1.0 of the spec set, written for an LLM-assisted coding workflow.

This folder is a complete, self-contained specification for building Lattice — an LLM-powered knowledge tool for multi-connected creative people. It is structured so that each document can be poured into a coding LLM (Claude Code, Cursor, or similar) one at a time, in sequence, to produce a working application.

## What Lattice is, in one paragraph

Lattice is a web-based "second brain" that lets you throw in arbitrary content — text, links, documents, voice memos — together with a short comment expressing intent ("interesting investor for later", "process in my podcast"). The system automatically organizes captures into *chapters* (root branches of structure), proposes links between related items, and surfaces them proactively when relevant. Users navigate through the auto-generated structure or ask natural-language questions and get answers grounded in their own captured material. The structure is a flexible meta-layer on top of a stable data layer of immutable "atoms" — meaning the same data can be viewed through multiple *lenses* (saved queries that cut across chapters). The target audience is multi-connected creative people: solo founders, consultants, multi-hyphenate creatives juggling several projects and ecosystems at once.

## How to use this spec set

Read in order on first pass:

1. **`01-product-spec.md`** — Vision, target audience, core concepts, glossary, feature list, user stories.
2. **`02-architecture.md`** — Tech stack, system architecture, key decisions.
3. **`03-data-model.md`** — Complete Postgres schema with SQL, indexes, RLS policies.
4. **`04-api-spec.md`** — Server actions and route handlers (Next.js App Router patterns).
5. **`05-llm-operations.md`** — Every LLM call: prompts, model choices, cost notes.
6. **`06-frontend-spec.md`** — Pages, components, UX flows, design language.
7. **`07-phase-1-buildplan.md`** — **The step-by-step coding plan.** Each step is a discrete coding session you can hand to an LLM with one of the spec documents above as supporting context.
8. **`08-roadmap.md`** — Phases 2 through 7 in outline form.
9. **`09-conventions.md`** — Coding conventions, error handling, testing, observability, security.

When using with a coding LLM:

- Start each session by pasting the relevant spec docs into the LLM's context, plus the specific build-plan step.
- Keep `01-product-spec.md` and the relevant `03`/`04` sections in context for nearly every step.
- After each step, ask the LLM to update an internal `PROGRESS.md` so you can resume cleanly.

## Stack (decided)

- **Frontend & API:** Next.js 15 (App Router) on Vercel
- **Database / Auth / Storage / Realtime:** Supabase (Postgres + pgvector)
- **LLM:** Anthropic Claude (Haiku 4.5 for routine, Sonnet 4.6 for synthesis; Opus 4.7 reserved for heavy restructure)
- **Embeddings:** OpenAI `text-embedding-3-small` (cheap, well-supported; easy to swap later)
- **Transcription:** OpenAI Whisper
- **Background jobs:** Inngest (serverless, plays well with Vercel)
- **UI library:** shadcn/ui + Tailwind
- **Region:** Start US (Supabase + Vercel default). Migrate to EU when ready (see `08-roadmap.md`).

## Naming inside the product

- **Atom** — a single captured thing (a pasted note, a URL, a voice memo, an upload).
- **Chapter** — the primary organizational unit; the home of an atom.
- **Lens** — a saved view / query that cuts across chapters.
- **Intent** — an actionable, time-aware note attached to an atom ("process for podcast", "reach out later").
- **Comment** — a free-text personal note attached to an atom (not actionable).
- **Link** — a semantic relationship between two atoms, LLM-proposed and user-confirmed/vetoed.
- **User Model** — persistent context about the user (projects, people, vocabulary) included in LLM calls.

These terms are used consistently throughout the spec.

## Versioning of this spec

When you change a major decision (model choice, schema field, sharing rule), update the affected doc and bump its `Last updated:` date at the top. Keep `README.md` as the canonical index.
