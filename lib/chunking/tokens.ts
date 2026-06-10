import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

// Singleton tokenizer. cl100k_base matches the encoding used by
// text-embedding-3-small and Claude tokenization is within ~10% — close
// enough for chunk sizing. Source of truth: docs/05-llm-operations.md §5.7.
let _enc: Tiktoken | null = null;
function getEncoder(): Tiktoken {
  if (!_enc) _enc = new Tiktoken(cl100k_base);
  return _enc;
}

export function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}
