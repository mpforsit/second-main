/**
 * Splits `text` into tokens where any sequence of characters matching one of
 * the query words is flagged. Returns an array of plain strings and marked
 * strings the renderer can wrap in <mark>.
 *
 * Pure string logic — UI components decide how to render the segments.
 */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "in",
  "to",
  "for",
  "on",
  "is",
  "are",
  "be",
]);

export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  if (terms.length === 0) return [{ text, match: false }];

  // Escape regex special chars in each term.
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts.filter((p) => p.length > 0).map((p) => ({ text: p, match: pattern.test(p) }));
}

/**
 * Picks a ~`window` character slice of `text` centered on the densest match
 * cluster, so the snippet shows the relevant context rather than the opening
 * sentence.
 */
export function snippetAround(text: string, query: string, window = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= window) return clean;
  const segs = highlightSegments(clean, query);
  // Find the position of the first matched segment in the joined string.
  let pos = 0;
  let firstMatch = -1;
  for (const s of segs) {
    if (s.match) {
      firstMatch = pos;
      break;
    }
    pos += s.text.length;
  }
  if (firstMatch === -1) return clean.slice(0, window) + "…";
  const start = Math.max(0, firstMatch - Math.floor(window / 3));
  const end = Math.min(clean.length, start + window);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return prefix + clean.slice(start, end) + suffix;
}
