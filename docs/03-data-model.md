# 03 — Data Model

Complete schema for Lattice on Supabase Postgres + pgvector. All tables use UUIDs and `created_at`/`updated_at` timestamps. RLS (Row-Level Security) is enabled on every user-data table.

This document is the single source of truth for the schema. Migrations live in `/supabase/migrations/`.

## 3.1 Extensions

```sql
create extension if not exists "pgcrypto";       -- gen_random_uuid()
create extension if not exists "vector";          -- pgvector
create extension if not exists "pg_trgm";         -- trigram FTS helper
```

## 3.2 Tables

### `profiles`

Mirrors `auth.users` with app-specific fields.

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### `workspaces`

MVP: one per user. Schema supports many for Phase 4.

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  is_personal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_idx on workspaces(owner_id);
```

### `workspace_members`

MVP: only the owner. Phase 4 adds collaborators.

```sql
create type workspace_role as enum ('owner', 'collaborator', 'commenter', 'reader', 'suggester');

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role workspace_role not null,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
```

### `user_models`

The persistent profile of each user, used as LLM context.

```sql
create table user_models (
  user_id uuid primary key references profiles(id) on delete cascade,
  -- Structured JSON. See 05-llm-operations.md for schema.
  -- { projects: [...], people: [...], vocabulary: [...], preferences: {...} }
  model jsonb not null default '{}'::jsonb,
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);
```

### `chapters`

```sql
create table chapters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  parent_chapter_id uuid references chapters(id) on delete set null,  -- Phase 3+
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chapters_workspace_idx on chapters(workspace_id) where archived_at is null;
create index chapters_parent_idx on chapters(parent_chapter_id) where parent_chapter_id is not null;
```

### `sources`

Provenance metadata for atoms.

```sql
create type source_type as enum ('paste', 'url', 'upload', 'voice', 'connector');

create table sources (
  id uuid primary key default gen_random_uuid(),
  type source_type not null,
  original_url text,
  storage_path text,                       -- Supabase Storage path for uploads/voice
  extracted_title text,
  extracted_author text,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

### `atoms`

The atomic unit of capture.

```sql
create type atom_status as enum ('processing', 'ready', 'failed');
create type atom_visibility as enum ('chapter-default', 'personal', 'explicit-only');

create table atoms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  primary_chapter_id uuid references chapters(id) on delete set null,
  source_id uuid not null references sources(id) on delete restrict,

  -- Immutable content
  content text not null,                   -- The captured text (extracted from URL/PDF/voice)
  content_hash text not null,              -- sha256 of content for dedup
  content_token_count int,

  -- Capture-time annotations
  capture_comment text,                    -- User's free-text comment at capture
  -- (intents are separate rows; see below)

  -- Status & lifecycle
  status atom_status not null default 'processing',
  visibility atom_visibility not null default 'chapter-default',
  processing_error text,

  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  created_by uuid not null references profiles(id) on delete restrict
);

create index atoms_workspace_idx on atoms(workspace_id);
create index atoms_chapter_idx on atoms(primary_chapter_id) where primary_chapter_id is not null;
create index atoms_status_idx on atoms(status);
create unique index atoms_workspace_hash_idx on atoms(workspace_id, content_hash);  -- soft dedup per workspace
```

### `atom_chapter_secondaries`

Atoms can appear in additional chapters (Phase 3+). Schema in MVP, empty.

```sql
create table atom_chapter_secondaries (
  atom_id uuid not null references atoms(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (atom_id, chapter_id)
);
```

### `chunks`

Sub-units of atoms for retrieval. Embeddings stored here.

```sql
create table chunks (
  id uuid primary key default gen_random_uuid(),
  atom_id uuid not null references atoms(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,  -- denormalized for fast RLS
  ordinal int not null,                    -- chunk index within atom
  text text not null,
  token_count int,
  embedding vector(1536),                  -- OpenAI text-embedding-3-small
  embedding_model text not null default 'text-embedding-3-small',
  created_at timestamptz not null default now(),
  unique (atom_id, ordinal)
);

create index chunks_atom_idx on chunks(atom_id);
create index chunks_workspace_idx on chunks(workspace_id);
-- HNSW vector index, m=16, ef_construction=64 (defaults; tune later)
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
-- Full-text index on chunk text
create index chunks_text_fts_idx on chunks using gin (to_tsvector('english', text));
```

### `comments`

User notes attached to atoms. Distinct from `atoms.capture_comment` (which is captured-with-the-atom); these are added later.

```sql
create table comments (
  id uuid primary key default gen_random_uuid(),
  atom_id uuid not null references atoms(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  is_private boolean not null default true,  -- Phase 4: false means visible to all with workspace access
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_atom_idx on comments(atom_id);
```

### `intents`

Structured, actionable annotations.

```sql
create type intent_action as enum (
  'read', 'reach_out', 'use_in', 'research', 'review', 'share', 'decide', 'other'
);
create type intent_status as enum ('open', 'done', 'dismissed');

create table intents (
  id uuid primary key default gen_random_uuid(),
  atom_id uuid not null references atoms(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,

  text text not null,                      -- raw natural-language phrasing
  action_type intent_action not null,
  due_at timestamptz,
  recurrence text,                          -- ISO 8601 recurrence string, optional
  status intent_status not null default 'open',
  surfaced_at timestamptz,                  -- last time the system surfaced this
  surface_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index intents_atom_idx on intents(atom_id);
create index intents_workspace_status_idx on intents(workspace_id, status);
create index intents_due_idx on intents(due_at) where status = 'open' and due_at is not null;
```

### `links`

Semantic relationships between atoms.

```sql
create type link_status as enum ('suggested', 'confirmed', 'vetoed');
create type link_relation as enum ('related_to', 'contradicts', 'elaborates', 'is_source_for');

create table links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  atom_a_id uuid not null references atoms(id) on delete cascade,
  atom_b_id uuid not null references atoms(id) on delete cascade,
  relation link_relation not null default 'related_to',
  status link_status not null default 'suggested',
  strength real,                            -- 0..1, LLM-assessed
  proposed_by text not null default 'llm',  -- 'llm' or 'user'
  reasoning text,                           -- LLM explanation, short
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (atom_a_id < atom_b_id),            -- canonical ordering to avoid dups
  unique (atom_a_id, atom_b_id, relation)
);

create index links_atom_a_idx on links(atom_a_id);
create index links_atom_b_idx on links(atom_b_id);
create index links_workspace_status_idx on links(workspace_id, status);
```

### `suggestions`

Audit log of all system-proposed structural changes.

```sql
create type suggestion_type as enum (
  'chapter_assignment', 'new_chapter', 'restructure', 'link', 'intent_surface'
);
create type suggestion_status as enum ('open', 'accepted', 'rejected', 'superseded');

create table suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  type suggestion_type not null,
  payload jsonb not null,                  -- type-specific
  status suggestion_status not null default 'open',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index suggestions_workspace_idx on suggestions(workspace_id);
create index suggestions_user_open_idx on suggestions(user_id) where status = 'open';
```

### `llm_call_logs`

Cost telemetry.

```sql
create table llm_call_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete set null,
  use_case text not null,                  -- e.g. 'capture.classify', 'qa.synthesize', 'onboarding'
  provider text not null,                  -- 'anthropic', 'openai'
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  latency_ms int,
  succeeded boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

create index llm_call_logs_user_month_idx on llm_call_logs(user_id, created_at desc);
```

### `quotas`

Per-user monthly limits. Computed on demand from `llm_call_logs`, but cached here.

```sql
create table quotas (
  user_id uuid primary key references profiles(id) on delete cascade,
  plan text not null default 'free',       -- 'free' | 'paid' (Phase 4)
  month_start date not null,
  captures_used int not null default 0,
  questions_used int not null default 0,
  voice_seconds_used int not null default 0,
  cost_usd_used numeric(10, 4) not null default 0,
  updated_at timestamptz not null default now()
);
```

## 3.3 Row-Level Security

RLS enabled on every user-data table. Phase 1 policies are simple: only the workspace owner sees their data.

```sql
-- Helper: is_workspace_member
create or replace function is_workspace_member(_workspace_id uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = _workspace_id
      and user_id = auth.uid()
  );
$$;

-- profiles
alter table profiles enable row level security;
create policy "profiles_self_select" on profiles
  for select using (id = auth.uid());
create policy "profiles_self_update" on profiles
  for update using (id = auth.uid());

-- workspaces
alter table workspaces enable row level security;
create policy "workspaces_member_select" on workspaces
  for select using (is_workspace_member(id));
create policy "workspaces_owner_all" on workspaces
  for all using (owner_id = auth.uid());

-- workspace_members
alter table workspace_members enable row level security;
create policy "workspace_members_member_select" on workspace_members
  for select using (is_workspace_member(workspace_id));

-- user_models
alter table user_models enable row level security;
create policy "user_models_self_all" on user_models
  for all using (user_id = auth.uid());

-- chapters
alter table chapters enable row level security;
create policy "chapters_member_select" on chapters
  for select using (is_workspace_member(workspace_id));
create policy "chapters_member_modify" on chapters
  for all using (is_workspace_member(workspace_id));

-- atoms
alter table atoms enable row level security;
create policy "atoms_member_select" on atoms
  for select using (is_workspace_member(workspace_id));
create policy "atoms_creator_modify" on atoms
  for all using (created_by = auth.uid() and is_workspace_member(workspace_id));

-- chunks
alter table chunks enable row level security;
create policy "chunks_member_select" on chunks
  for select using (is_workspace_member(workspace_id));
-- Insert/update only via service role (workers); no client write policy.

-- comments
alter table comments enable row level security;
create policy "comments_self_or_shared" on comments
  for select using (
    author_id = auth.uid()
    or (is_private = false and exists (
      select 1 from atoms a
      where a.id = comments.atom_id and is_workspace_member(a.workspace_id)
    ))
  );
create policy "comments_author_modify" on comments
  for all using (author_id = auth.uid());

-- intents
alter table intents enable row level security;
create policy "intents_author_all" on intents
  for all using (author_id = auth.uid());

-- links
alter table links enable row level security;
create policy "links_member_select" on links
  for select using (is_workspace_member(workspace_id));
create policy "links_member_modify" on links
  for all using (is_workspace_member(workspace_id));

-- suggestions
alter table suggestions enable row level security;
create policy "suggestions_self_all" on suggestions
  for all using (user_id = auth.uid());

-- llm_call_logs: server-only writes; read by user
alter table llm_call_logs enable row level security;
create policy "llm_call_logs_self_select" on llm_call_logs
  for select using (user_id = auth.uid());

-- quotas
alter table quotas enable row level security;
create policy "quotas_self_select" on quotas
  for select using (user_id = auth.uid());
```

## 3.4 Triggers

Auto-update `updated_at`:

```sql
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

-- Apply to every table with updated_at
create trigger trg_profiles_touch before update on profiles
  for each row execute function touch_updated_at();
-- ...repeat for: workspaces, user_models, chapters, atoms, comments, intents.
```

Auto-create profile + personal workspace on signup:

```sql
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  ws_id uuid;
begin
  insert into profiles (id, email)
    values (new.id, new.email);

  insert into workspaces (owner_id, name, is_personal)
    values (new.id, 'Personal', true)
    returning id into ws_id;

  insert into workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'owner');

  insert into user_models (user_id, model)
    values (new.id, '{}'::jsonb);

  insert into quotas (user_id, plan, month_start)
    values (new.id, 'free', date_trunc('month', now())::date);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

## 3.5 Search helpers

Hybrid search function used by Q&A and search UI:

```sql
create or replace function search_chunks(
  _workspace_id uuid,
  _query_text text,
  _query_embedding vector(1536),
  _limit int default 20
)
returns table (
  chunk_id uuid,
  atom_id uuid,
  text text,
  vector_score real,
  fts_score real,
  rrf_score real
)
language sql stable security invoker as $$
  with vector_hits as (
    select id as chunk_id, atom_id, text,
           1 - (embedding <=> _query_embedding) as vector_score,
           row_number() over (order by embedding <=> _query_embedding) as v_rank
    from chunks
    where workspace_id = _workspace_id
    order by embedding <=> _query_embedding
    limit _limit * 2
  ),
  fts_hits as (
    select id as chunk_id, atom_id, text,
           ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', _query_text)) as fts_score,
           row_number() over (order by ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', _query_text)) desc) as f_rank
    from chunks
    where workspace_id = _workspace_id
      and to_tsvector('english', text) @@ websearch_to_tsquery('english', _query_text)
    limit _limit * 2
  ),
  fused as (
    select coalesce(v.chunk_id, f.chunk_id) as chunk_id,
           coalesce(v.atom_id, f.atom_id) as atom_id,
           coalesce(v.text, f.text) as text,
           coalesce(v.vector_score, 0) as vector_score,
           coalesce(f.fts_score, 0) as fts_score,
           (coalesce(1.0 / (60 + v.v_rank), 0) + coalesce(1.0 / (60 + f.f_rank), 0)) as rrf_score
    from vector_hits v
    full outer join fts_hits f on v.chunk_id = f.chunk_id
  )
  select * from fused
  order by rrf_score desc
  limit _limit;
$$;
```

## 3.6 Privacy zones — note for Phase 4

The schema is already set up for the privacy zones described in `01-product-spec.md`:

- `atoms.visibility` controls inheritance from chapter shares.
- `comments.is_private` separates personal notes from shared notes.
- `intents` are author-scoped via RLS — never shared automatically.

In Phase 4 we will add: `shares` table, more workspace_member roles, and richer RLS policies that union the chapter-share-derived access with direct shares. Schema scaffolding for that is already in place via `workspace_members.role`.
