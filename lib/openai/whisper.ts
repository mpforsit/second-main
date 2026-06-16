import path from "node:path";

import { computeWhisperCost } from "@/lib/openai/pricing";
import { getOpenAI } from "@/lib/openai/client";
import { getServiceSupabase } from "@/lib/supabase/service";

const MODEL = "whisper-1";

export interface TranscribedAudio {
  text: string;
  duration_sec: number;
  language: string | null;
}

interface Opts {
  user_id: string;
  workspace_id?: string;
}

/**
 * Downloads an audio blob from Supabase Storage (bucket `voice`) and
 * transcribes it with Whisper. Records one llm_call_logs row with
 * cost_usd derived from the returned duration. Spec: docs/05-llm-operations.md §5.6.
 */
export async function transcribeFromStorage(
  storage_path: string,
  opts: Opts,
): Promise<TranscribedAudio> {
  const start = performance.now();
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.storage.from("voice").download(storage_path);
  if (error || !data) {
    throw new Error(`Storage download failed: ${error?.message ?? "no body"}`);
  }

  const bytes = await data.arrayBuffer();
  const filename = path.basename(storage_path) || "audio.webm";
  const mime = data.type || "audio/webm";
  const file = new File([bytes], filename, { type: mime });

  let text = "";
  let duration_sec = 0;
  let language: string | null = null;
  let succeeded = true;
  let errorMessage: string | null = null;

  try {
    const client = getOpenAI();
    const res = await client.audio.transcriptions.create({
      file,
      model: MODEL,
      response_format: "verbose_json",
    });
    text = res.text.trim();
    duration_sec = res.duration ?? 0;
    language = res.language ?? null;
  } catch (err) {
    succeeded = false;
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const latency_ms = Math.round(performance.now() - start);
    const cost_usd = computeWhisperCost(duration_sec);

    void logCall({
      user_id: opts.user_id,
      workspace_id: opts.workspace_id,
      use_case: "voice.transcribe",
      provider: "openai",
      model: MODEL,
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      cost_usd,
      latency_ms,
      succeeded,
      error: errorMessage,
    });
  }

  return { text, duration_sec, language };
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
    if (error) console.error("[llm_call_logs] whisper insert failed", error);
  } catch (err) {
    console.error("[llm_call_logs] whisper insert threw", err);
  }
}
