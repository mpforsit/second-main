# 01 — Product Specification

> Read this first. Everything else follows from here.

## 1.1 Vision

A web-based knowledge tool for multi-connected creative people who juggle multiple projects, companies, and ecosystems simultaneously. The user throws information at the system from anywhere (browser, mobile, voice, email) with a short comment expressing intent. The system organizes it automatically into a navigable structure, links related items, and surfaces them proactively when they become relevant. The user can browse the structure, query it conversationally, or be prompted by the system itself.

The product is **explicitly not**: an enterprise knowledge base, a wiki, a Notion replacement for teams, an offline-first markdown vault. It is for individuals (later: small workspaces) who think across many contexts and need a faster, more associative way to store and recall.

## 1.2 Target audience

Multi-connected creatives, roughly characterized as:

- Working on 3+ active "projects" at any time (could be companies, side projects, content streams, research threads).
- High volume of inbound information (articles, conversations, ideas, contacts) and limited time to organize.
- Comfortable paying €15–30/month for a tool that demonstrably saves them time.
- Persona archetypes: solo founder with a side project and a podcast; consultant juggling 5 clients; researcher with parallel reading threads; multi-hyphenate creative (writer + advisor + investor).

Not the audience: enterprise knowledge workers, students, casual journalers, Obsidian power users who want local-first markdown.

## 1.3 Positioning vs. competitors

| Tool | What we share | How we differ |
|------|--------------|---------------|
| Obsidian | Knowledge graph idea | We're cloud SaaS, auto-organizing, no markdown manual work |
| Notion | Web-based, rich capture | We have no rigid pages/databases; structure is flexible meta-layer; auto-organizing |
| Mem.ai | AI auto-organizing | We have intent-driven capture, proactive surfacing, cross-chapter discovery as first-class concepts |
| Reflect / Capacities | AI assistance | Same — our differentiator is the *intent* type and proactive surfacing |
| NotebookLM | LLM Q&A over docs | We are continuous-capture-based, not "upload a corpus once" |

**Wedge:** the *intent* primitive and proactive surfacing. Capturing with intent ("reach out to Maria when I raise") is meaningfully different from capturing with a tag, and surfacing intents at the right moment is what makes the system feel like an active assistant rather than a passive archive.

## 1.4 Core concepts (glossary)

These terms are first-class in the data model and the UI.

### Atom
The atomic unit of capture. One paste, one URL, one upload, one voice memo. Atoms are immutable at the content level: the captured content is preserved as-is. Metadata (chapter assignment, links, comments, intents) is mutable.

An atom has:
- A `source` describing where it came from (paste, URL with extraction, upload, voice, connector).
- A `primary_chapter` (mandatory): where it lives in the structure.
- Zero or more `secondary_chapters`: cross-cutting placements.
- A `public face` (the content itself) and a `private face` (the user's comments and intents).
- Zero or more `chunks` (internal): used for retrieval; not user-visible.

### Chunk
An internal sub-unit of an atom for embedding and retrieval. Users never see chunks directly. Long atoms get many chunks; a paste of one paragraph gets one. Chunk boundaries are determined by a chunker (semantic where possible, sliding-window fallback).

### Chapter
The primary organizational unit. A chapter is a named root branch ("Fundraising", "Podcast", "Reading"). Chapters can have sub-chapters (Phase 3+; not in MVP). Every atom belongs to exactly one primary chapter. The set of chapters evolves over time — the user can rename, merge, split, and reorganize.

A chapter is also the **default unit of sharing** (Phase 4+): when a user wants to collaborate, sharing a chapter is the natural first move.

### Lens
A saved view defined by a structured query: a natural-language description, optional chapter/date/tag filters, and explicit include/exclude lists. Lenses cut across chapters. Examples: "everything related to my Q1 launch", "all my reading from this year tagged AI", "investor leads from the last 90 days".

Lenses are evaluated dynamically (re-run on access) but can be frozen into snapshots for sharing.

### Comment
A free-text personal note the user attaches to an atom. Comments are private by default. They describe context ("I read this on the train", "this is from the IBM CFO") rather than express commitments.

### Intent
A *structured, actionable, time-aware* annotation. Distinct from comments. Examples: "process for podcast", "reach out to this person", "review before Thursday", "use in pitch deck". Intents have:
- A structured `action_type` (read, reach-out, use-in, research, review, share, decide, other).
- An optional `due_at` and recurrence.
- A `status` (open, done, dismissed).
- A free-text `text` (the original natural-language phrasing).
- A reference to the related atom (or atoms).

Intents power **proactive surfacing**: the system reviews open intents daily and surfaces them when relevant.

### Link
A semantic relationship between two atoms. Links are proposed by the LLM and confirmed or vetoed by the user. Vetoed links are remembered so they aren't re-proposed. Link types (Phase 3+): "related-to", "contradicts", "elaborates", "is-source-for". MVP: just "related-to".

### User Model
A persistent, structured profile of the user — their projects, key people, vocabulary, working preferences. Built initially from a cold-start onboarding interview and updated continuously based on capture patterns and user feedback. Included as context in every significant LLM call.

The user can view and edit their User Model directly.

### Suggestion
The general envelope for any system-proposed change: chapter assignment, new chapter creation, link proposal, restructure proposal, intent surfacing. Suggestions have a status (open, accepted, rejected, superseded) and an audit trail.

### Workspace
The top-level container. MVP: every user has one personal workspace. Phase 4+: users can have multiple workspaces and shared workspaces with collaborators.

## 1.5 Feature list, organized by phase

### Phase 1 — MVP (free, single user)
- Sign up / sign in
- Cold-start onboarding (2-minute conversational interview seeds initial chapters + user model)
- Capture: paste text, paste URL (with server-side extraction), upload (text/PDF), voice memo (browser recording + transcription)
- LLM suggests a chapter at capture time; user confirms / changes / creates new
- Comment box at capture time
- Intent box at capture time (with action-type chooser and optional due date)
- Browse: chapter list, atom list per chapter, atom detail view
- Atom detail: content, source, comments, intents, related atoms
- Q&A mode: natural-language question, RAG-based answer with citations linking to atoms
- Hybrid search (full-text + vector) on demand
- LLM proposes related-atom links; user acknowledges or vetoes
- User Model viewer and editor
- Cost telemetry (per-user LLM spend tracking, server-side, not user-visible at this phase)

### Phase 2 — Capture everywhere + proactive surfacing
- Browser extension (built on Obsidian Web Clipper's extraction)
- Mobile-friendly PWA with native share-target support
- Email-to-inbox per user (`<random>@in.lattice.app`)
- Voice capture from mobile
- Daily digest of intents due / surfaced
- Opportunistic cross-chapter discovery suggestions
- Thumbs up/down on every system suggestion (feedback signal)

### Phase 3 — Lenses + structural flexibility
- Lens creation UI
- Saved lenses in sidebar
- Restructure-with-hint flow
- Lock/unlock specific groupings
- Manual link creation
- Secondary chapter memberships
- Sub-chapter hierarchy

### Phase 4 — Sharing model + paid tier
- Multi-workspace support
- Chapter sharing, lens sharing, atom-bundle sharing
- Visibility zones (public face vs. private comments/intents)
- Pre-share preview screen
- Permissions: reader, commenter, collaborator, suggester
- Email invitations + public link sharing
- Stripe billing
- Quotas and metering UI

### Phase 5 — Personal ecosystem connectors
- Readwise integration
- Gmail (read-only, labeled/starred ingestion)
- Google Drive (Docs, PDFs)
- X bookmarks, YouTube watch-later, Pocket (lower priority)
- Connector dashboards with audit trail

### Phase 6 — Polish, multimodal, export
- Image capture (vision LLM)
- Audio file uploads
- Full export to markdown + YAML frontmatter + `graph.json`
- Performance and observability hardening

### Phase 7+ — Later
- EU LLM (Mistral or Anthropic EU region exclusive)
- Native mobile apps
- Published lenses (public read-only links)
- Possible enterprise connectors only if pulled by paying customers

## 1.6 User stories (Phase 1, MVP)

Numbered for traceability.

- **US-01** As a new user, I sign up with email or Google and am greeted with a short onboarding interview asking about my current projects, key people, and working context. After 2 minutes I have a populated User Model and a starter set of chapters.
- **US-02** As a user, I paste a URL into the capture box, optionally add a comment ("read this; might use in podcast") and an intent ("use in podcast — record Thursday"), and submit. The system extracts the article, suggests a chapter ("Podcast"), I accept with one click, and the atom appears in that chapter.
- **US-03** As a user, I record a 30-second voice memo with my idea. The system transcribes it, treats the transcription as the atom content, suggests a chapter, and stores both the audio and the text.
- **US-04** As a user, I upload a PDF I've been sent. The system extracts text, chunks it, suggests a chapter, and confirms when processing is complete.
- **US-05** As a user, I open a chapter and see all atoms in it as a chronological feed. I click an atom and see its full content, my comment, my intents, and a "related" panel of LLM-suggested links.
- **US-06** As a user, I see a proposed link between two atoms and either click ✓ (confirm) or ✗ (veto). Confirmed links appear in the related panel; vetoed links are remembered and not re-proposed.
- **US-07** As a user, I type a question in the Q&A box ("what did Maria say about the term sheet last month?") and get a synthesized answer with inline citations linking to the source atoms.
- **US-08** As a user, I view my User Model page, see the projects and people the system has stored, and edit any field directly.
- **US-09** As a user, I see and edit my chapter list — rename, archive, or merge chapters.

## 1.7 Non-goals for Phase 1

Explicitly *not* in scope for MVP:

- Sharing of any kind (single-user only)
- Multiple workspaces
- Browser extension / mobile native / email ingestion
- Lenses (saved cross-chapter queries)
- Daily digests / proactive surfacing
- Connectors (Readwise, Gmail, etc.)
- Multimodal capture beyond text and voice
- Billing / paid tier
- Sub-chapters / hierarchy
- Manual link creation
- Internationalization (English UI only)

This discipline is critical. Adding any of the above to MVP delays validation.

## 1.8 Success criteria for MVP

We will know Phase 1 is a success if:

1. A target-persona user can complete capture → organize → query → recall within their first session with zero help.
2. After 2 weeks of regular use, the user keeps using it without prompting.
3. The system's chapter suggestions are accepted (without modification) by users at least 70% of the time.
4. Q&A produces an answer the user rates as useful (thumbs-up) at least 60% of the time.
5. Per-user LLM cost stays under €0.50/month for an active free-tier user.
