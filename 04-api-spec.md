# 04 — API Specification

Lattice uses two patterns:

1. **Server Actions** (Next.js) for mutations triggered from client components — type-safe, no manual fetch.
2. **Route Handlers** (`/api/*`) for endpoints that need to be hit from outside the app (the Inngest webhook now; the browser extension and email ingest in Phase 2).

Every server-side function:
- Authenticates via Supabase server client (`createServerClient`).
- Validates input with Zod.
- Resolves the user's active workspace.
- Runs through RLS — no service-role keys in user-facing paths except where explicitly noted.
- Returns a discriminated union: `{ ok: true, data } | { ok: false, error }`.

All Zod schemas live in `/types/schemas.ts` and are imported by both client and server code.

## 4.1 Zod schemas (shared)

```ts
// types/schemas.ts
import { z } from 'zod';

export const IntentActionEnum = z.enum([
  'read', 'reach_out', 'use_in', 'research', 'review', 'share', 'decide', 'other'
]);

export const CaptureInputSchema = z.object({
  // Exactly one of these must be present:
  text: z.string().min(1).max(50_000).optional(),
  url: z.string().url().optional(),
  uploadStoragePath: z.string().optional(),
  voiceStoragePath: z.string().optional(),

  // Annotations
  comment: z.string().max(2000).optional(),
  intent: z.object({
    text: z.string().min(1).max(500),
    action_type: IntentActionEnum,
    due_at: z.string().datetime().optional(),
  }).optional(),

  // Optional explicit chapter override
  chapter_id: z.string().uuid().optional(),
}).refine(
  (d) => [d.text, d.url, d.uploadStoragePath, d.voiceStoragePath].filter(Boolean).length === 1,
  { message: 'Exactly one content source must be provided' }
);

export const AskInputSchema = z.object({
  question: z.string().min(2).max(1000),
});

export const LinkResolutionSchema = z.object({
  link_id: z.string().uuid(),
  decision: z.enum(['confirm', 'veto']),
});

export const ChapterInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const IntentUpdateSchema = z.object({
  intent_id: z.string().uuid(),
  status: z.enum(['open', 'done', 'dismissed']).optional(),
  due_at: z.string().datetime().nullable().optional(),
  text: z.string().min(1).max(500).optional(),
});

export const UserModelSchema = z.object({
  projects: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
  })).default([]),
  people: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.string().optional(),
    context: z.string().optional(),
  })).default([]),
  vocabulary: z.array(z.object({
    term: z.string(),
    meaning: z.string(),
  })).default([]),
  preferences: z.record(z.string(), z.any()).default({}),
});

export type CaptureInput = z.infer<typeof CaptureInputSchema>;
export type UserModel = z.infer<typeof UserModelSchema>;
```

## 4.2 Server Actions

### `capture(input: CaptureInput)`

```ts
// server-actions/atoms.ts
'use server';

export async function capture(input: CaptureInput): Promise<Result<{ atom_id: string }>> {
  // 1. Authenticate, get user + active workspace.
  // 2. Validate input via CaptureInputSchema.
  // 3. Check quota; abort if exceeded.
  // 4. If input.url: do nothing yet (extraction happens in background).
  //    If input.text: use as initial content.
  //    If upload/voice: same — content extracted in background.
  // 5. Create `sources` row.
  // 6. Create `atoms` row with status='processing', content='' or provisional text.
  // 7. If comment present, store in atoms.capture_comment.
  // 8. If intent present, create `intents` row.
  // 9. Emit Inngest event `atom.created` with { atom_id, workspace_id, user_id }.
  // 10. Return { atom_id }.
}
```

### `respondToSuggestion(suggestion_id, decision)`

```ts
export async function respondToSuggestion(
  suggestion_id: string,
  decision: 'accept' | 'reject',
  override?: { chapter_id?: string; new_chapter_name?: string }
): Promise<Result<void>> {
  // Used for chapter suggestions at capture time.
  // accept → apply payload to atom (set primary_chapter_id)
  // reject → mark superseded and apply override
}
```

### `resolveLink(link_id, decision)`

```ts
export async function resolveLink(link_id: string, decision: 'confirm' | 'veto'): Promise<Result<void>>;
```

### `createChapter(input: ChapterInput)`, `renameChapter(id, name)`, `archiveChapter(id)`

```ts
export async function createChapter(input: ChapterInput): Promise<Result<{ id: string }>>;
export async function renameChapter(id: string, name: string): Promise<Result<void>>;
export async function archiveChapter(id: string): Promise<Result<void>>;
```

### `updateIntent(input: IntentUpdateInput)`, `dismissIntent(id)`

```ts
export async function updateIntent(input: IntentUpdateInput): Promise<Result<void>>;
```

### `updateUserModel(model: UserModel)`

```ts
export async function updateUserModel(model: UserModel): Promise<Result<void>>;
```

### `completeOnboarding(messages: Message[])`

Saves user model derived from onboarding conversation and creates initial chapters.

```ts
export async function completeOnboarding(messages: Message[]): Promise<Result<{ chapter_ids: string[] }>>;
```

## 4.3 Route Handlers

### `POST /api/capture/upload-signed-url`

Returns a signed Supabase Storage URL for client-side direct upload. Required because files can be large and we don't want to proxy them through Vercel.

```ts
// Request: { kind: 'pdf' | 'voice', filename: string }
// Response: { storage_path: string, signed_url: string, expires_at: string }
```

### `POST /api/ask`

The Q&A endpoint. Server-Sent Events for streaming.

```ts
// Request: { question: string }
// Response: SSE stream of:
//   - { type: 'token', text: string }       (streamed answer text)
//   - { type: 'citation', atom_id: string } (when a citation token is finalized)
//   - { type: 'done', cited_atom_ids: string[] }
```

Implementation steps inside this handler:
1. Authenticate user, get workspace.
2. Quota check.
3. Generate embedding of question.
4. Call `search_chunks(workspace_id, question, embedding, 20)`.
5. Group chunks by atom; take top 8 atoms.
6. Load full atom metadata for those 8.
7. Build prompt (see `05-llm-operations.md` § Q&A).
8. Stream Sonnet response, post-processing citations.
9. Log `llm_call_logs` row.

### `POST /api/inngest`

The Inngest webhook receiver. Auto-generated by Inngest SDK.

### `POST /api/auth/callback`

Supabase Auth OAuth callback.

### `POST /api/onboarding/chat`

Streaming chat endpoint for the onboarding interview.

```ts
// Request: { messages: Message[] }
// Response: SSE stream of:
//   - { type: 'token', text: string }
//   - { type: 'complete', user_model: UserModel, suggested_chapters: ChapterInput[] }
```

The server-side Sonnet call uses a system prompt that instructs the model to ask 3–5 questions, then emit a final structured object inside a `</onboarding>` marker block. The handler parses this and returns it as `complete`.

## 4.4 Inngest functions

Each function is one file in `/inngest/functions/`.

### `process-atom`

Triggered by `atom.created`.

```ts
inngest.createFunction(
  { id: 'process-atom', retries: 3 },
  { event: 'atom.created' },
  async ({ event, step }) => {
    const { atom_id, workspace_id, user_id } = event.data;

    // Step 1: Load atom + source
    const atom = await step.run('load', () => loadAtom(atom_id));

    // Step 2: Extract content (URL/PDF/voice/text)
    const content = await step.run('extract', async () => {
      if (atom.source.type === 'url') return await extractUrl(atom.source.original_url);
      if (atom.source.type === 'upload') return await extractPdf(atom.source.storage_path);
      if (atom.source.type === 'voice') return await transcribe(atom.source.storage_path, user_id);
      return atom.content;  // text/paste: already there
    });

    // Step 3: Update atom with extracted content
    await step.run('save-content', () => updateAtomContent(atom_id, content));

    // Step 4: Chunk
    const chunks = await step.run('chunk', () => chunk(content));

    // Step 5: Embed (in batches of up to 100)
    const embeddings = await step.run('embed', () => embedBatch(chunks, user_id));

    // Step 6: Persist chunks + embeddings
    await step.run('save-chunks', () => saveChunks(atom_id, workspace_id, chunks, embeddings));

    // Step 7: Classify into chapter
    const suggested_chapter = await step.run('classify', () =>
      classifyChapter({ content, comment: atom.capture_comment, user_id, workspace_id })
    );

    // Step 8: Write suggestion row + assign primary_chapter_id pre-emptively
    await step.run('record-suggestion', () => recordChapterSuggestion(atom_id, suggested_chapter));

    // Step 9: Propose links
    const link_candidates = await step.run('search-similar', () =>
      findSimilarAtoms(atom_id, workspace_id, 10)
    );
    const links = await step.run('filter-links', () =>
      filterLinks({ atom_id, candidates: link_candidates, user_id })
    );
    await step.run('save-links', () => saveLinks(workspace_id, atom_id, links));

    // Step 10: Mark ready
    await step.run('mark-ready', () => markAtomReady(atom_id));

    // Step 11: Realtime notify
    await step.run('notify', () => publishRealtime(workspace_id, 'atom.ready', { atom_id }));
  }
);
```

Note: Each `step.run` is checkpointed. If an LLM call fails, Inngest retries just that step.

## 4.5 Error model

```ts
type AppError =
  | { code: 'unauthenticated' }
  | { code: 'not_found'; resource: string }
  | { code: 'quota_exceeded'; resource: 'captures' | 'questions' | 'voice' | 'cost' }
  | { code: 'validation'; details: ZodIssue[] }
  | { code: 'rate_limited' }
  | { code: 'external_provider'; provider: 'anthropic' | 'openai' | 'supabase' }
  | { code: 'internal'; message: string };

type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };
```

User-facing strings live in `/lib/errors.ts` and map error codes to friendly messages.

## 4.6 Realtime channels

Subscribe to per-workspace channel `workspace:{workspace_id}` to receive:
- `atom.ready` — `{ atom_id }`
- `atom.failed` — `{ atom_id, error }`
- `intent.surfaced` — `{ intent_id }` (Phase 2+)

Supabase Realtime is used (`channel.on('broadcast', { event: '...' }, ...)`), with broadcasts sent from Inngest functions via the service role.

## 4.7 Rate limiting

- Server actions: 60/minute per user (in-memory token bucket via `@upstash/ratelimit`; defer Redis until Phase 4).
- `/api/ask`: 10/minute per user.
- Upload signed-URL endpoint: 30/minute per user.
- Capture: bounded by quota, not rate-limited per second.
