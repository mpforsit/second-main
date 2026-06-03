// USD per million tokens. Source of truth: docs/05-llm-operations.md §5.2.

export const PRICING_USD_PER_MTOK = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cached_input: 0.1 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cached_input: 0.3 },
  "claude-opus-4-7": { input: 5.0, output: 25.0, cached_input: 0.5 },
} as const;

export type ClaudeModel = keyof typeof PRICING_USD_PER_MTOK;

export function computeCostUsd(
  model: ClaudeModel,
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number },
): number {
  const rate = PRICING_USD_PER_MTOK[model];
  const cached = usage.cached_input_tokens ?? 0;
  const freshInput = Math.max(0, usage.input_tokens - cached);
  return (
    (freshInput * rate.input + cached * rate.cached_input + usage.output_tokens * rate.output) /
    1_000_000
  );
}
