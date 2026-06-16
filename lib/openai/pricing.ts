// USD per million tokens. Source of truth: docs/05-llm-operations.md §5.5–5.6.

export const OPENAI_PRICING_USD_PER_MTOK = {
  "text-embedding-3-small": { input: 0.02 },
} as const;

export type OpenAIEmbeddingModel = keyof typeof OPENAI_PRICING_USD_PER_MTOK;

export function computeOpenAIEmbeddingCost(model: OpenAIEmbeddingModel, tokens: number): number {
  return (tokens * OPENAI_PRICING_USD_PER_MTOK[model].input) / 1_000_000;
}

// Whisper is priced per minute, not per token.
export const WHISPER_USD_PER_MINUTE = 0.006;

export function computeWhisperCost(duration_sec: number): number {
  return (duration_sec / 60) * WHISPER_USD_PER_MINUTE;
}
