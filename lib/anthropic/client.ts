import Anthropic from "@anthropic-ai/sdk";

import { getServiceSupabase } from "@/lib/supabase/service";
import { computeCostUsd, type ClaudeModel } from "@/lib/anthropic/pricing";

let _client: Anthropic | null = null;
function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

type SystemPrompt =
  | string
  | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;

interface CallOpts {
  model: ClaudeModel;
  system: SystemPrompt;
  messages: Anthropic.MessageParam[];
  max_tokens: number;
  use_case: string;
  user_id: string;
  workspace_id?: string;
}

export interface CallUsage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

// Stream events emitted by callClaudeStream.
export type ClaudeStreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; usage: CallUsage; full_text: string };

/**
 * Streams a Claude response, yielding incremental text deltas followed by a
 * single `done` event with the accumulated text + usage. Logs the call to
 * llm_call_logs after the stream ends (fire-and-forget).
 *
 * Quota enforcement lands in Step 14.
 */
export async function* callClaudeStream(opts: CallOpts): AsyncGenerator<ClaudeStreamEvent> {
  const start = performance.now();
  const client = getClient();

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let fullText = "";

  let succeeded = true;
  let errorMessage: string | null = null;

  try {
    const stream = client.messages.stream({
      model: opts.model,
      system: opts.system,
      messages: opts.messages,
      max_tokens: opts.max_tokens,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = event.delta.text;
        fullText += text;
        yield { type: "text", text };
      } else if (event.type === "message_start") {
        const u = event.message.usage;
        inputTokens = u.input_tokens ?? 0;
        cachedInputTokens = u.cache_read_input_tokens ?? 0;
      } else if (event.type === "message_delta") {
        if (event.usage.output_tokens != null) {
          outputTokens = event.usage.output_tokens;
        }
      }
    }
  } catch (err) {
    succeeded = false;
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const latency_ms = Math.round(performance.now() - start);
    const cost_usd = computeCostUsd(opts.model, {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: cachedInputTokens,
    });

    // Fire-and-forget log. The void is intentional — we don't await the
    // database round-trip on the response path.
    void logCall({
      user_id: opts.user_id,
      workspace_id: opts.workspace_id,
      use_case: opts.use_case,
      provider: "anthropic",
      model: opts.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: cachedInputTokens,
      cost_usd,
      latency_ms,
      succeeded,
      error: errorMessage,
    });

    if (succeeded) {
      yield {
        type: "done",
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cached_input_tokens: cachedInputTokens,
          cost_usd,
          latency_ms,
        },
        full_text: fullText,
      };
    }
  }
}

interface LogRow {
  user_id: string;
  workspace_id?: string;
  use_case: string;
  provider: "anthropic" | "openai";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  latency_ms: number;
  succeeded: boolean;
  error: string | null;
}

async function logCall(row: LogRow) {
  try {
    const supabase = getServiceSupabase();
    const { error } = await supabase.from("llm_call_logs").insert(row);
    if (error) {
      console.error("[llm_call_logs] insert failed", error);
    }
  } catch (err) {
    console.error("[llm_call_logs] insert threw", err);
  }
}
