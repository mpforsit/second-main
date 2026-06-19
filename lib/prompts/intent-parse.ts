// Source of truth: docs/05-llm-operations.md §5.4.5.

import { callClaude } from "@/lib/anthropic/client";
import { IntentParseResultSchema, type IntentParseResult } from "@/types/schemas";

export const INTENT_PARSE_PROMPT_VERSION = 1;

export const INTENT_PARSE_SYSTEM_PROMPT = `You parse a short natural-language intent into a structured action.

Action types:
- "read": user intends to read/finish reading this later
- "reach_out": user intends to contact someone
- "use_in": user intends to use this in a specific output (podcast, deck, post, etc.)
- "research": user intends to investigate further
- "review": user intends to revisit before a decision
- "share": user intends to share with someone
- "decide": user intends to make a decision
- "other": fallback

You may also extract a due date if implied (e.g., "before Thursday", "next week"). The current time will be provided so relative dates resolve correctly.

Respond with ONLY:

{
  "action_type": "read"|"reach_out"|"use_in"|"research"|"review"|"share"|"decide"|"other",
  "due_at": "<ISO 8601 or null>",
  "normalized_text": "<the intent rewritten concisely if helpful, otherwise same as input>"
}`;

interface ParseOpts {
  user_id: string;
  workspace_id?: string;
}

export async function parseIntent(text: string, opts: ParseOpts): Promise<IntentParseResult> {
  const userPrompt = [
    `<now>${new Date().toISOString()}</now>`,
    "",
    `<intent>${text.trim()}</intent>`,
  ].join("\n");

  const { text: rawText } = await callClaude({
    model: "claude-haiku-4-5-20251001",
    system: INTENT_PARSE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    max_tokens: 256,
    use_case: "capture.intent_parse",
    user_id: opts.user_id,
    workspace_id: opts.workspace_id,
  });

  const cleaned = stripCodeFences(rawText).trim();
  const parsed = JSON.parse(cleaned);
  return IntentParseResultSchema.parse(parsed);
}

function stripCodeFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return m?.[1] ?? s;
}
