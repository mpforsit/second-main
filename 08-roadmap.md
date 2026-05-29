# 08 — Roadmap (Phase 2 and beyond)

Outline only. Each phase will get its own detailed build plan analogous to `07-phase-1-buildplan.md` when the time comes. Treat the timelines as planning targets, not commitments.

## Phase 2 — Capture everywhere + proactive surfacing (~2.5 months)

The differentiator phase. After this, Lattice should feel like an active assistant, not a passive store.

### Features

- **Browser extension** built on Obsidian Web Clipper (MIT-licensed). Approach: build a small wrapper extension that uses the same Readability-based extraction but posts to Lattice's `/api/capture` instead of writing markdown files. Investigate contributing an "external destination URL" option upstream to Obsidian's clipper so we can ride their improvements.
- **PWA share-target on mobile.** Manifest configured so the OS share sheet shows Lattice; receiving handler at `/share-target`.
- **Voice capture on mobile** (was MVP on web; now native mobile recording flow with offline queueing).
- **Email-to-inbox.** Each user gets a unique address `<userhash>@in.lattice.app`. Inbound email parsed (subject becomes title, body becomes content, attachments become uploads, the first non-quoted text block becomes the capture comment). Use a service like Mailgun or AWS SES with inbound parsing.
- **Daily surfacing digest.** Inngest scheduled job (or pg_cron + pg_net) that:
  1. Pulls open intents due in the next N days.
  2. Identifies relevant atoms based on recent activity (Phase 3 cross-chapter discovery extends this).
  3. Composes a brief in-app digest visible in the right rail; later, optional morning email.
- **Cross-chapter discovery suggestions.** When a new atom is captured, after standard link proposal, also surface "this echoes [older atom from another chapter]" if the semantic distance is small but the atoms are in different chapters and were captured >2 weeks apart.
- **Feedback signal.** Thumbs up/down on every system suggestion (chapter assignments, links, surfacings). Store in a `feedback_events` table for later prompt tuning.

### Data model additions

```sql
create table feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  suggestion_id uuid references suggestions(id) on delete set null,
  context jsonb,                            -- snapshot of what was shown
  signal text not null,                     -- 'up' | 'down'
  created_at timestamptz not null default now()
);

create table inbox_addresses (
  user_id uuid primary key references profiles(id) on delete cascade,
  address_hash text not null unique,
  created_at timestamptz not null default now()
);

alter table atoms add column external_capture_metadata jsonb;
```

### Risk areas

- Mobile audio recording reliability (iOS Safari quirks).
- Email parsing edge cases (Apple Mail's formatting, attachments, threading).
- Browser extension build/test/release workflow is new — set aside a week.

## Phase 3 — Lenses + structural flexibility (~2 months)

The "different angles" feature. After this, the data layer / structure layer separation is visible to users.

### Features

- **Lens creation UI.** From a search or filter view, "Save as lens". Lenses appear in the sidebar below chapters.
- **Lens definition language.** Lenses are stored as structured JSON: `{ semantic_query, chapter_filter, tag_filter, date_range, include_atom_ids, exclude_atom_ids }`.
- **Restructure-with-hint flow.** User types "I want podcast content grouped separately by season" → Opus 4.7 produces a *plan* (list of suggestions) the user approves item-by-item.
- **Lock/unlock specific groupings.** A locked chapter assignment will not be changed by future restructure operations.
- **Manual link creation.** From an atom detail page, "Link to…" picker that searches and creates user-status links.
- **Secondary chapter memberships.** Drag-and-drop or right-click "Also include in chapter…".
- **Sub-chapter hierarchy.** Already in schema; now exposed in UI.

### Data model additions

```sql
create table lenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  definition jsonb not null,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table chapters add column locked boolean not null default false;
alter table atoms add column chapter_locked boolean not null default false;
```

### LLM additions

- New use case `restructure.plan` using Opus 4.7, returning a structured plan as a list of suggestions.

## Phase 4 — Sharing model + paid tier (~2.5 months)

The first revenue phase. Sharing is the natural paid trigger.

### Features

- Multi-workspace support: create additional workspaces beyond the personal one.
- Chapter sharing, lens sharing, atom-bundle sharing.
- Visibility zones: every atom has a public face (content) and a private face (comments + intents). Sharing exposes only the public face.
- Pre-share preview screen.
- Roles: Reader, Commenter, Collaborator, Suggester. Server-side enforcement via expanded RLS.
- Email invitations and public link sharing.
- Stripe billing integration, customer portal.
- Quota tier system (free vs. paid).

### Data model additions

```sql
create type share_scope as enum ('chapter', 'lens', 'atom_bundle');
create type share_permission as enum ('read', 'comment', 'edit');

create table shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scope_type share_scope not null,
  scope_id uuid not null,
  granted_by uuid not null references profiles(id),
  recipient_user_id uuid references profiles(id) on delete cascade,
  recipient_email text,                     -- for pending invites
  public_link_token text unique,            -- for public sharing
  permission share_permission not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table atom_bundles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table atom_bundle_items (
  bundle_id uuid not null references atom_bundles(id) on delete cascade,
  atom_id uuid not null references atoms(id) on delete cascade,
  primary key (bundle_id, atom_id)
);

create table billing_subscriptions (
  user_id uuid primary key references profiles(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default 'free',
  status text not null,                     -- 'active', 'past_due', 'canceled', etc.
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
```

### RLS additions

RLS on atoms (and related tables) becomes a UNION of:
- direct workspace membership (existing); plus
- chapter-share grants (atom's primary_chapter_id is in a `shares` row); plus
- lens-share grants (atom matches a shared lens's definition); plus
- atom-bundle-share grants (atom is in a shared bundle).

For private comments + intents, the RLS continues to scope strictly to the author.

This is the most complex RLS work in the project; budget generously and write a comprehensive test suite.

## Phase 5 — Personal ecosystem connectors (~3 months)

Pull the user's information from where it already lives.

### Connector priorities (in order)

1. **Readwise** (highest signal — book/article highlights live here for this audience).
2. **Gmail** (read-only, with strict scopes; ingest starred/labeled messages and threads).
3. **Google Drive** (Docs and PDFs; on-demand and folder-watched).
4. **X (Twitter) bookmarks**.
5. **YouTube watch-later**.
6. **Pocket / Instapaper**.

### Per-connector pattern

- OAuth flow with strictly scoped permissions.
- "Setup" wizard explaining what will be ingested and what won't.
- Snapshot ingestion: pull state at point in time; create atoms with `sources.type = 'connector'` and connector metadata.
- "Refresh from source" button on each connector-sourced atom.
- Audit log per connector showing what was pulled and when.
- Disconnect / delete data button (GDPR-compliant).

### Data model additions

```sql
create table connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null,                   -- 'readwise', 'gmail', 'gdrive', ...
  account_label text,                       -- for multiple accounts of same provider
  oauth_credentials jsonb,                  -- encrypted (use pgsodium)
  configuration jsonb not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table connector_sync_logs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references connectors(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null,                     -- 'running', 'success', 'failed'
  items_pulled int not null default 0,
  error text
);
```

## Phase 6 — Polish, multimodal, export (~2 months)

### Features

- **Image capture.** Vision LLM (Claude Sonnet 4.6 with image input) generates a textual description used for embedding and Q&A; original image preserved in Storage. Useful for screenshots, whiteboard photos, diagrams.
- **Audio file uploads** (not just live recording).
- **Full export.**
  - Markdown files mirroring chapter structure.
  - Each atom is one `.md` file with YAML frontmatter: `id`, `created_at`, `source`, `chapter`, `comments[]`, `intents[]`, `links[]`.
  - `graph.json` at the root with the full link graph, lens definitions, and user model.
  - Audio files preserved alongside.
  - Obsidian-readable as a side effect.
- **Performance pass.** HNSW index tuning, query plan reviews, caching of chapter listings, pagination on long feeds.
- **Observability hardening.** Sentry + Vercel Analytics + custom dashboards for: capture latency P95, LLM call costs, error rates, conversion funnel.
- **Bulk operations.** Multi-select atoms; bulk move to chapter / bulk delete / bulk export.

## Phase 7+ — Later

### EU LLM option

When pulled by users or by your own preference: route LLM traffic through Anthropic's EU region exclusively, and offer Mistral models as an alternative for users wanting a fully EU-headquartered provider. Schema already supports this via `llm_call_logs.provider` and `model`.

### Native mobile apps

Only if the PWA hits its ceiling. Probably React Native with Expo to reuse logic. Re-evaluate at this point whether to build native.

### Published lenses (public read-only)

A lens can be turned into a public URL — useful for sharing reading lists, research collections, public knowledge gardens. Increases organic distribution.

### Enterprise (if pulled)

Slack/Teams connectors, SSO, audit logs, SOC 2, BYOK LLM, VPC deployment. Only if a paying team or company is pulling you here.

### EU hosting migration

When ready: migrate Supabase to its EU region (or self-host on Hetzner / Scaleway), deploy Vercel to its `fra1` region (already available, just a config flip if you separate the Next.js project from the database geography sensibly). Plan the migration when you have ≥100 paying users — earlier is cheaper.
