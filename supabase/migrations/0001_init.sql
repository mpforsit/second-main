-- Phase 1 schema — Lattice / Second
-- Source of truth: docs/03-data-model.md
--
-- Order: extensions → enums → tables (+ indexes inline) → grants → RLS helper
-- → RLS policies → updated_at trigger → handle_new_user trigger
-- → search_chunks function.

-- ===========================================================================
-- 3.1 Extensions
-- ===========================================================================

create extension if not exists "pgcrypto";        -- gen_random_uuid()
create extension if not exists "vector";           -- pgvector
create extension if not exists "pg_trgm";          -- trigram FTS helper


-- ===========================================================================
-- 3.2 Tables (with enums and indexes)
-- ===========================================================================

-- profiles ------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- workspaces ----------------------------------------------------------------

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  is_personal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_idx on workspaces(owner_id);

-- workspace_members ---------------------------------------------------------

create type workspace_role as enum ('owner', 'collaborator', 'commenter', 'reader', 'suggester');

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role workspace_role not null,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- user_models ---------------------------------------------------------------

create table user_models (
  user_id uuid primary key references profiles(id) on delete cascade,
  model jsonb not null default '{}'::jsonb,
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- chapters ------------------------------------------------------------------

create table chapters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  parent_chapter_id uuid references chapters(id) on delete set null,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chapters_workspace_idx on chapters(workspace_id) where archived_at is null;
create index chapters_parent_idx on chapters(parent_chapter_id) where parent_chapter_id is not null;

-- sources -------------------------------------------------------------------

create type source_type as enum ('paste', 'url', 'upload', 'voice', 'connector');

create table sources (
  id uuid primary key default gen_random_uuid(),
  type source_type not null,
  original_url text,
  storage_path text,
  extracted_title text,
  extracted_author text,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- atoms ---------------------------------------------------------------------

create type atom_status as enum ('processing', 'ready', 'failed');
create type atom_visibility as enum ('chapter-default', 'personal', 'explicit-only');

create table atoms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  primary_chapter_id uuid references chapters(id) on delete set null,
  source_id uuid not null references sources(id) on delete restrict,
  content text not null,
  content_hash text not null,
  content_token_count int,
  capture_comment text,
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
create unique index atoms_workspace_hash_idx on atoms(workspace_id, content_hash);

-- atom_chapter_secondaries --------------------------------------------------

create table atom_chapter_secondaries (
  atom_id uuid not null references atoms(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (atom_id, chapter_id)
);

-- chunks --------------------------------------------------------------------

create table chunks (
  id uuid primary key default gen_random_uuid(),
  atom_id uuid not null references atoms(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ordinal int not null,
  text text not null,
  token_count int,
  embedding vector(1536),
  embedding_model text not null default 'text-embedding-3-small',
  created_at timestamptz not null default now(),
  unique (atom_id, ordinal)
);

create index chunks_atom_idx on chunks(atom_id);
create index chunks_workspace_idx on chunks(workspace_id);
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index chunks_text_fts_idx on chunks using gin (to_tsvector('english', text));

-- comments ------------------------------------------------------------------

create table comments (
  id uuid primary key default gen_random_uuid(),
  atom_id uuid not null references atoms(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  is_private boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_atom_idx on comments(atom_id);

-- intents -------------------------------------------------------------------

create type intent_action as enum (
  'read', 'reach_out', 'use_in', 'research', 'review', 'share', 'decide', 'other'
);
create type intent_status as enum ('open', 'done', 'dismissed');

create table intents (
  id uuid primary key default gen_random_uuid(),
  atom_id uuid not null references atoms(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  text text not null,
  action_type intent_action not null,
  due_at timestamptz,
  recurrence text,
  status intent_status not null default 'open',
  surfaced_at timestamptz,
  surface_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index intents_atom_idx on intents(atom_id);
create index intents_workspace_status_idx on intents(workspace_id, status);
create index intents_due_idx on intents(due_at) where status = 'open' and due_at is not null;

-- links ---------------------------------------------------------------------

create type link_status as enum ('suggested', 'confirmed', 'vetoed');
create type link_relation as enum ('related_to', 'contradicts', 'elaborates', 'is_source_for');

create table links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  atom_a_id uuid not null references atoms(id) on delete cascade,
  atom_b_id uuid not null references atoms(id) on delete cascade,
  relation link_relation not null default 'related_to',
  status link_status not null default 'suggested',
  strength real,
  proposed_by text not null default 'llm',
  reasoning text,
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (atom_a_id < atom_b_id),
  unique (atom_a_id, atom_b_id, relation)
);

create index links_atom_a_idx on links(atom_a_id);
create index links_atom_b_idx on links(atom_b_id);
create index links_workspace_status_idx on links(workspace_id, status);

-- suggestions ---------------------------------------------------------------

create type suggestion_type as enum (
  'chapter_assignment', 'new_chapter', 'restructure', 'link', 'intent_surface'
);
create type suggestion_status as enum ('open', 'accepted', 'rejected', 'superseded');

create table suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  type suggestion_type not null,
  payload jsonb not null,
  status suggestion_status not null default 'open',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index suggestions_workspace_idx on suggestions(workspace_id);
create index suggestions_user_open_idx on suggestions(user_id) where status = 'open';

-- llm_call_logs -------------------------------------------------------------

create table llm_call_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete set null,
  use_case text not null,
  provider text not null,
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

-- quotas --------------------------------------------------------------------

create table quotas (
  user_id uuid primary key references profiles(id) on delete cascade,
  plan text not null default 'free',
  month_start date not null,
  captures_used int not null default 0,
  questions_used int not null default 0,
  voice_seconds_used int not null default 0,
  cost_usd_used numeric(10, 4) not null default 0,
  updated_at timestamptz not null default now()
);


-- ===========================================================================
-- Grants for the API roles
-- ===========================================================================
-- Supabase's new API-key system (sb_publishable_*, sb_secret_*) still maps to
-- the legacy `anon`, `authenticated`, and `service_role` Postgres roles, but
-- newly-created tables don't inherit grants automatically — we hand them out
-- explicitly so PostgREST can execute SELECT/INSERT/UPDATE/DELETE against
-- them. RLS still gates row-level access.

grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;


-- ===========================================================================
-- 3.3 Row-Level Security
-- ===========================================================================

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

-- sources
-- The spec §3.3 doesn't list a policy for sources, but Supabase enables RLS
-- on every new table by default. Source rows hold provenance metadata
-- (URL, storage path, extracted title) referenced by atoms, and atom RLS
-- already gates what a user can see — so a permissive authenticated policy
-- is safe and lets capture() insert source rows.
alter table sources enable row level security;
create policy "sources_authenticated_all" on sources
  for all to authenticated using (true) with check (true);

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


-- ===========================================================================
-- 3.4 Triggers
-- ===========================================================================

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_touch    before update on profiles    for each row execute function touch_updated_at();
create trigger trg_workspaces_touch  before update on workspaces  for each row execute function touch_updated_at();
create trigger trg_user_models_touch before update on user_models for each row execute function touch_updated_at();
create trigger trg_chapters_touch    before update on chapters    for each row execute function touch_updated_at();
create trigger trg_atoms_touch       before update on atoms       for each row execute function touch_updated_at();
create trigger trg_comments_touch    before update on comments    for each row execute function touch_updated_at();
create trigger trg_intents_touch     before update on intents     for each row execute function touch_updated_at();
create trigger trg_quotas_touch      before update on quotas      for each row execute function touch_updated_at();

-- Auto-create profile + personal workspace on signup.
-- `set search_path = public` is required because triggers on auth.users are
-- invoked by the `supabase_auth_admin` role, whose default search_path
-- doesn't include `public` — without it the inserts fail with
-- "relation profiles does not exist".
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

-- supabase_auth_admin is the role GoTrue runs under; it needs EXECUTE on the
-- trigger function (SECURITY DEFINER only changes which role runs the body —
-- the caller still needs EXECUTE).
grant execute on function handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ===========================================================================
-- 3.5 Search helpers
-- ===========================================================================

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
