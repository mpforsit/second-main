import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

// Source of truth: docs/05-llm-operations.md §5.7.
const TARGET_TOKENS = 600;
const MAX_TOKENS = 800;
const OVERLAP_TOKENS = 100;

let _enc: Tiktoken | null = null;
function enc(): Tiktoken {
  if (!_enc) _enc = new Tiktoken(cl100k_base);
  return _enc;
}

interface Unit {
  text: string;
  tokens: number;
}

/**
 * Splits text into chunks of roughly TARGET_TOKENS tokens, hard-capped at
 * MAX_TOKENS, with OVERLAP_TOKENS of overlap between adjacent chunks.
 * Boundary preference: paragraph > sentence > word. Pure function, no I/O.
 */
export function chunk(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const units = decompose(trimmed);
  if (units.length === 0) return [];

  const chunks: string[] = [];
  let currentText: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (currentText.length === 0) return;
    chunks.push(currentText.join("\n\n"));
  };

  for (const u of units) {
    const wouldExceed = currentTokens + u.tokens > MAX_TOKENS;
    if (wouldExceed && currentText.length > 0) {
      flush();
      const overlap = lastTokens(currentText.join("\n\n"), OVERLAP_TOKENS);
      currentText = overlap ? [overlap] : [];
      currentTokens = overlap ? enc().encode(overlap).length : 0;
    }
    currentText.push(u.text);
    currentTokens += u.tokens;
  }
  flush();

  return chunks;
}

// Split into roughly-paragraph-sized units, recursively breaking down anything
// that exceeds MAX_TOKENS by sentences (and ultimately by word groups).
function decompose(text: string): Unit[] {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const units: Unit[] = [];
  for (const p of paragraphs) {
    const t = enc().encode(p).length;
    if (t <= MAX_TOKENS) {
      units.push({ text: p, tokens: t });
      continue;
    }
    for (const s of splitSentences(p)) {
      const st = enc().encode(s).length;
      if (st <= MAX_TOKENS) {
        units.push({ text: s, tokens: st });
      } else {
        units.push(...splitByTokenBudget(s, TARGET_TOKENS));
      }
    }
  }
  return units;
}

// Naive sentence splitter — sufficient for prose (atoms = articles, notes,
// transcripts). Handles "Mr. Smith" and similar edge cases poorly; we'll
// upgrade if it becomes a problem in user-facing chunks.
function splitSentences(p: string): string[] {
  const out: string[] = [];
  const re = /[^.!?]+(?:[.!?]+(?:\s+|$)|$)/g;
  for (const m of p.matchAll(re)) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out.length > 0 ? out : [p];
}

function splitByTokenBudget(text: string, budget: number): Unit[] {
  const words = text.split(/\s+/);
  const units: Unit[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  for (const w of words) {
    const wt = enc().encode(w + " ").length;
    if (bufTokens + wt > budget && buf.length > 0) {
      const joined = buf.join(" ");
      units.push({ text: joined, tokens: enc().encode(joined).length });
      buf = [];
      bufTokens = 0;
    }
    buf.push(w);
    bufTokens += wt;
  }
  if (buf.length > 0) {
    const joined = buf.join(" ");
    units.push({ text: joined, tokens: enc().encode(joined).length });
  }
  return units;
}

function lastTokens(text: string, n: number): string {
  const encoded = enc().encode(text);
  if (encoded.length <= n) return text;
  return enc().decode(encoded.slice(-n));
}
