// USD per million tokens. Source of truth: docs/05-llm-operations.md §5.5.

export const OPENAI_PRICING_USD_PER_MTOK = {
  "text-embedding-3-small": { input: 0.02 },
} as const;

export type OpenAIEmbeddingModel = keyof typeof OPENAI_PRICING_USD_PER_MTOK;

export function computeOpenAIEmbeddingCost(model: OpenAIEmbeddingModel, tokens: number): number {
  return (tokens * OPENAI_PRICING_USD_PER_MTOK[model].input) / 1_000_000;
}
