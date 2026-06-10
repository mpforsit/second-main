// Source of truth: docs/05-llm-operations.md §5.4.2.

export const CLASSIFY_CHAPTER_PROMPT_VERSION = 1;

export const CLASSIFY_CHAPTER_SYSTEM_PROMPT = `You assign captured content to a chapter in the user's knowledge base.

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
- New chapter names: 1–3 words, no emoji, title case.`;

export interface ClassifyChapterInput {
  user_model_serialized: string;
  existing_chapters: Array<{ id: string; name: string; description: string | null }>;
  content: string;
  capture_comment?: string | null;
  intent?: { text: string; action_type: string } | null;
}

export function renderClassifyUserPrompt(input: ClassifyChapterInput): string {
  const chapters = input.existing_chapters
    .map(
      (c) =>
        `- id: ${c.id} | name: ${c.name}${c.description ? ` | description: ${c.description}` : ""}`,
    )
    .join("\n");
  const comment = input.capture_comment?.trim() ? input.capture_comment.trim() : "(none)";
  const intent = input.intent ? `${input.intent.text} (${input.intent.action_type})` : "(none)";
  const truncated = input.content.length > 3000 ? input.content.slice(0, 3000) : input.content;

  return [
    "<user_model>",
    input.user_model_serialized,
    "</user_model>",
    "",
    "<existing_chapters>",
    chapters || "(none)",
    "</existing_chapters>",
    "",
    `<user_comment>${comment}</user_comment>`,
    "",
    `<intent>${intent}</intent>`,
    "",
    "<content>",
    truncated,
    "</content>",
  ].join("\n");
}

export interface ClassifyChapterResult {
  decision: "assign" | "new";
  chapter_id?: string;
  new_chapter?: { name: string; description: string } | null;
  confidence: number;
  reasoning: string;
}
