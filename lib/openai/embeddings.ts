import { computeOpenAIEmbeddingCost, type OpenAIEmbeddingModel } from "@/lib/openai/pricing";
import { getOpenAI } from "@/lib/openai/client";
import { getServiceSupabase } from "@/lib/supabase/service";

const MODEL: OpenAIEmbeddingModel = "text-embedding-3-small";
const BATCH_SIZE = 100; // OpenAI accepts up to 2048 but spec caps at 100.

export async function embedBatch(
  texts: string[],
  opts: { user_id: string; workspace_id?: string; use_case: "embed.chunk" | "embed.query" },
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getOpenAI();
  const start = performance.now();
  const embeddings: number[][] = [];
  let totalTokens = 0;
  let succeeded = true;
  let errorMessage: string | null = null;

  try {
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const slice = texts.slice(i, i + BATCH_SIZE);
      const res = await client.embeddings.create({ model: MODEL, input: slice });
      for (const row of res.data) {
        embeddings.push(row.embedding);
      }
      totalTokens += res.usage.total_tokens ?? 0;
    }
  } catch (err) {
    succeeded = false;
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const latency_ms = Math.round(performance.now() - start);
    const cost_usd = computeOpenAIEmbeddingCost(MODEL, totalTokens);

    void logCall({
      user_id: opts.user_id,
      workspace_id: opts.workspace_id,
      use_case: opts.use_case,
      provider: "openai",
      model: MODEL,
      input_tokens: totalTokens,
      output_tokens: 0,
      cached_input_tokens: 0,
      cost_usd,
      latency_ms,
      succeeded,
      error: errorMessage,
    });
  }

  return embeddings;
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
    if (error) console.error("[llm_call_logs] embed insert failed", error);
  } catch (err) {
    console.error("[llm_call_logs] embed insert threw", err);
  }
}
