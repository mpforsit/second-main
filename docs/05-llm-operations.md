# 05 — LLM Operations

Every LLM call in Lattice. Each section gives: purpose, model choice, system prompt, user prompt template, expected output, cost notes, and edge cases.

All prompts live as constants in `/lib/prompts/`. They are versioned: when a prompt changes, bump its version in the file and in any cached calls.

## 5.1 Cost discipline (rules that apply everywhere)

1. **Model tiering**: Haiku 4.5 for classification, light extraction, and filtering. Sonnet 4.6 for synthesis, Q&A, onboarding interviews. Opus 4.7 only for explicit "deep restructure" actions (Phase 3+).
2. **Prompt caching**: System prompts and the user model are cache-eligible. Use Anthropic's `cache_control: { type: 'ephemeral' }` on the system block.
3. **Logging**: Wrap every call. Record input/output token counts (`response.usage`) and computed `cost_usd` to `llm_call_logs`.
4. **Quota check before call**: If user is over monthly cost cap, abort with `quota_exceeded`.
5. **Streaming where it helps UX**: Q&A and onboarding stream. Background classifications don't.

## 5.2 Wrapper sketch

```ts
// lib/anthropic/client.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function callClaude(opts: {
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' | 'claude-opus-4-7';
  system: string | Array<{ type: 'text'; text: string; cache_control?: any }>;
  messages: Anthropic.MessageParam[];
  max_tokens: number;
  use_case: string;
  user_id: string;
  workspace_id?: string;
  stream?: false;
}): Promise<Anthropic.Message>;

// + a streaming variant returning AsyncIterable<Anthropic.MessageStreamEvent>
```

Wrapper responsibilities:
- Compute `cost_usd` from `response.usage` using the rate table.
- Insert `llm_call_logs` row (fire-and-forget; do not block response).
- Update `quotas.cost_usd_used`.
- Surface a typed error on quota exceed before calling the API.

Pricing table to use (in `lib/anthropic/pricing.ts`):

```ts
export const PRICING_USD_PER_MTOK = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, cached_input: 0.10 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-opus-4-7':           { input: 5.00, output: 25.00, cached_input: 0.50 },
};
```

## 5.3 The User Model — formatting for prompts

The user model is included as context in most calls. It's serialized compactly:

```
<user_model>
Projects:
- {name}: {description}
- ...
Key people:
- {name} ({role}): {context}
- ...
Vocabulary:
- {term}: {meaning}
- ...
</user_model>
```

This block is cached via `cache_control` since it changes rarely within a session.

## 5.4 Operations

### 5.4.1 Onboarding interview

**Model:** Sonnet 4.6 (streamed).
**Use case key:** `onboarding`.
**Trigger:** new user first session.

**System prompt:**

```
You are conducting a short onboarding interview for a knowledge tool called Lattice. The user is a multi-connected creative person — they likely juggle multiple projects, companies, and contexts. Your job in 3–5 turns is to learn enough about them to seed an initial structure.

Ask questions in this order, one per turn, in a warm, brisk tone:
1. What are the main projects or threads on your plate right now? (Aim to extract 3–6 named things.)
2. Who are 3–5 key people you collaborate with most or who matter most to your current work? (Get name + role briefly.)
3. What kinds of things do you most often want to capture? (Articles, contacts, ideas, voice notes, meeting takeaways, etc.)
4. (Optional) Any vocabulary or shorthand you use that's specific to your work? (e.g. internal project codenames.)
5. Confirm: "Based on this, I'd suggest starting with these chapters: [list]. Want to keep this set, change any, or add others?"

After the user confirms or revises the chapter list, emit ONLY this exact structured block as your final message (no other text):

<onboarding_complete>
{
  "user_model": {
    "projects": [{"id": "...", "name": "...", "description": "..."}],
    "people": [{"id": "...", "name": "...", "role": "...", "context": "..."}],
    "vocabulary": [{"term": "...", "meaning": "..."}],
    "preferences": {}
  },
  "suggested_chapters": [
    {"name": "...", "description": "..."}
  ]
}
</onboarding_complete>

Rules:
- Maximum 5 turns total. Be efficient.
- Generate UUIDs (v4) for project and person IDs.
- Suggest 4–8 starter chapters that reflect their actual projects and capture patterns.
- One chapter per major project, plus general-purpose chapters like "Reading", "People", "Ideas" where they make sense.
- Be warm but quick. The user wants this to be short.
```

**Cost:** ~2,000 input + ~1,500 output tokens × 5 turns ≈ $0.02 per onboarding. One-time per user.

### 5.4.2 Chapter classification (at capture)

**Model:** Haiku 4.5.
**Use case key:** `capture.classify`.
**Trigger:** every new atom, in the Inngest pipeline.

**System prompt:**

```
You assign captured content to a chapter in the user's knowledge base.

You will receive:
1. The user model.
2. The list of existing chapters with their descriptions.
3. The captured content (may be long; truncated to first ~3000 chars).
4. The user's capture comment (optional).
5. Any associated intent (optional).

Decide one of:
- ASSIGN to an existing chapter (by ID).
- PROPOSE a new chapter with a short name and one-line description.

Respond with ONLY this JSON, no prose:

{
  "decision": "assign" | "new",
  "chapter_id": "<uuid if assign>",
  "new_chapter": {"name": "...", "description": "..."} | null,
  "confidence": 0.0-1.0,
  "reasoning": "one short sentence"
}

Rules:
- Strongly prefer assigning to an existing chapter if a reasonable match exists (confidence >= 0.55).
- Propose a new chapter only when content is clearly outside the existing structure.
- The user's comment and intent are strong signals — weight them heavily.
- New chapter names: 1–3 words, no emoji, title case.
```

**User prompt:**

```
<existing_chapters>
- id: {id} | name: {name} | description: {description}
- ...
</existing_chapters>

<user_comment>{capture_comment or "(none)"}</user_comment>

<intent>{intent.text + intent.action_type or "(none)"}</intent>

<content>
{content truncated to 3000 chars}
</content>
```

**Output parsing:** strict JSON. If parse fails, retry once. If retry fails, log error and leave atom with `primary_chapter_id = NULL` (user assigns manually).

**Cost:** ~1,000 input + ~80 output ≈ $0.0014 per capture.

### 5.4.3 Link proposal (similar atoms)

**Model:** Haiku 4.5.
**Use case key:** `capture.propose_links`.
**Trigger:** every new atom, after embedding.

**Pipeline:**
1. Vector-search top 10 similar atoms (excluding the new atom itself) using its first chunk's embedding.
2. Pass those candidates + the new atom to Haiku for filtering.

**System prompt:**

```
You filter LLM-proposed semantic links. You will receive a NEW atom and 10 CANDIDATE atoms it was vector-matched against. Decide which candidates are genuine semantic links the user would care about — not just topical overlap, but real conceptual or referential connection.

Respond with ONLY this JSON:

{
  "links": [
    {"candidate_id": "<uuid>", "strength": 0.0-1.0, "reasoning": "one short clause"}
  ]
}

Rules:
- Return AT MOST 5 links.
- Only include strength >= 0.5.
- "Reasoning" should be ≤ 12 words and explain the relationship, not summarize either atom.
- If none of the candidates are genuine links, return {"links": []}.
```

**Cost:** ~1,500 input + ~200 output ≈ $0.0025 per atom.

### 5.4.4 Q&A synthesis

**Model:** Sonnet 4.6 (streamed).
**Use case key:** `qa.synthesize`.

**System prompt (cache-enabled):**

```
You answer questions using only the user's own captured knowledge base.

You will receive:
1. The user model (their projects, people, vocabulary).
2. A set of retrieved atoms, each prefixed with its UUID and source.
3. The user's question.

Your job:
- Answer the question concisely and accurately using only information from the retrieved atoms.
- Cite every factual claim by appending [atom:<UUID>] inline. Cite multiple atoms with [atom:UUID1][atom:UUID2] if a claim is supported by several.
- If the retrieved atoms don't contain the answer, say so honestly. Suggest what the user could capture or where else to look.
- Do not invent facts. Do not bring outside knowledge except common-sense framing.
- Match the user's tone: brisk, direct, no fluff.
- Maximum 250 words unless the question explicitly needs more.
```

**User prompt:**

```
<retrieved_atoms>
[atom:UUID-1]
Source: {url or filename or 'paste'}
Captured: {date}
Comment: {capture_comment if any}
Content:
{chunk_text_1}
---
[atom:UUID-2]
...
</retrieved_atoms>

<question>{user_question}</question>
```

**Output post-processing:** scan for `[atom:UUID]` tokens, replace with hyperlinks to `/atoms/{UUID}` in the rendered response, and collect the deduplicated list of cited atom IDs.

**Cost:** ~3,000–8,000 input + ~500 output ≈ $0.02 per question.

### 5.4.5 Intent extraction (auxiliary)

**Model:** Haiku 4.5.
**Use case key:** `capture.intent_parse`.
**Trigger:** only when user types intent free-form without picking an action_type.

**System prompt:**

```
You parse a short natural-language intent into a structured action.

Action types:
- "read": user intends to read/finish reading this later
- "reach_out": user intends to contact someone
- "use_in": user intends to use this in a specific output (podcast, deck, post, etc.)
- "research": user intends to investigate further
- "review": user intends to revisit before a decision
- "share": user intends to share with someone
- "decide": user intends to make a decision
- "other": fallback

You may also extract a due date if implied (e.g., "before Thursday", "next week").

Respond with ONLY:

{
  "action_type": "read"|"reach_out"|"use_in"|"research"|"review"|"share"|"decide"|"other",
  "due_at": "<ISO 8601 or null>",
  "normalized_text": "<the intent rewritten concisely if helpful, otherwise same as input>"
}
```

**Cost:** ~300 input + ~50 output ≈ $0.0006 per parse. Most users will pick action_type directly in UI; this fires only when they type free-form.

### 5.4.6 Restructure with hint (Phase 3+ — placeholder)

Not implemented in MVP. When implemented:
- Model: Opus 4.7 (heavy reasoning), one call per restructure action.
- Output: a *plan* of suggested moves (atom X → chapter Y; merge chapter A into B; create new chapter C) as suggestion rows; user approves item by item.

## 5.5 Embedding operations (OpenAI)

**Model:** `text-embedding-3-small`, 1536 dimensions.
**Pricing:** $0.02 per 1M tokens.
**Use cases:**
- Embed each chunk on insert.
- Embed every Q&A question.

**Wrapper:** batch up to 100 inputs per call when embedding atom chunks; one-off calls for single questions.

```ts
// lib/openai/embeddings.ts
export async function embedBatch(texts: string[], opts: { user_id: string }): Promise<number[][]>;
```

Same logging discipline: record token count and cost in `llm_call_logs` with `provider='openai'`, `model='text-embedding-3-small'`, `use_case='embed.chunk'` or `embed.query`.

## 5.6 Transcription (Whisper)

**Model:** `whisper-1` (OpenAI).
**Pricing:** $0.006/minute.
**Use case key:** `voice.transcribe`.

```ts
export async function transcribe(storage_path: string, user_id: string): Promise<{ text: string; duration_sec: number }>;
```

Flow:
1. Download audio from Supabase Storage.
2. Send to Whisper API.
3. Log duration to `llm_call_logs` (use `cost_usd = duration_sec * 0.006 / 60`).
4. Update `quotas.voice_seconds_used`.

## 5.7 Chunking strategy

In `/lib/chunking/chunker.ts`:

- Target chunk size: 600 tokens (~2400 chars).
- Overlap: 100 tokens.
- Boundary preference: paragraph > sentence > word.
- Implementation: use `@dqbd/tiktoken` for token counts. Walk paragraphs; greedily fill chunks; backtrack to last sentence boundary if a paragraph would overflow.
- Voice transcriptions: chunk by sentence pauses (Whisper returns segments). One chunk per ~30 seconds of speech.
- Single-paragraph atoms: one chunk.

## 5.8 Prompt caching strategy

For each long-running session (e.g., onboarding chat, multi-question Q&A session), cache:
- The system prompt (static).
- The user model serialization (changes rarely).

Pattern:

```ts
{
  model: '...',
  system: [
    { type: 'text', text: STATIC_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: serializeUserModel(model), cache_control: { type: 'ephemeral' } },
  ],
  messages: [...]
}
```

Saves up to 90% on cached input tokens.

## 5.9 Failure handling

For every LLM call:
- Network/timeout errors: retry once with exponential backoff inside the wrapper.
- 429 rate limit: retry with longer backoff (up to 3 attempts), then propagate.
- 5xx provider errors: retry once, then propagate as `external_provider` error.
- Malformed JSON output (for classifier-style calls): retry once with a stricter system-prompt addendum ("Return ONLY valid JSON. No prose."), then fall back to a default decision (e.g., leave chapter unset for the user to choose).
