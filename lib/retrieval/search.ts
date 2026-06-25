import { embedBatch } from "@/lib/openai/embeddings";
import { getServerSupabase } from "@/lib/supabase/server";

export interface SearchResultAtom {
  atom_id: string;
  content: string;
  capture_comment: string | null;
  captured_at: string;
  source: {
    type: "paste" | "url" | "upload" | "voice" | "connector";
    extracted_title: string | null;
    original_url: string | null;
  };
  chapter: { id: string; name: string } | null;
  best_chunk_text: string;
  vector_score: number;
  fts_score: number;
  rrf_score: number;
}

interface RpcRow {
  chunk_id: string;
  atom_id: string;
  text: string;
  vector_score: number;
  fts_score: number;
  rrf_score: number;
}

interface AtomRow {
  id: string;
  content: string;
  capture_comment: string | null;
  captured_at: string;
  primary_chapter_id: string | null;
  sources:
    | { type: string; extracted_title: string | null; original_url: string | null }[]
    | { type: string; extracted_title: string | null; original_url: string | null };
  chapters: { id: string; name: string }[] | { id: string; name: string } | null;
}

/**
 * Runs hybrid search (vector + FTS via RRF) against the workspace's chunks
 * and returns atom-level results with the best matching chunk's text.
 * docs/03-data-model.md §3.5 + docs/05-llm-operations.md §5.5.
 */
export async function searchAtoms(
  workspace_id: string,
  user_id: string,
  query: string,
  limit = 20,
): Promise<SearchResultAtom[]> {
  const q = query.trim();
  if (!q) return [];

  // 1. Embed the query.
  const [embedding] = await embedBatch([q], { user_id, workspace_id, use_case: "embed.query" });
  if (!embedding) return [];

  const supabase = await getServerSupabase();

  // 2. Hybrid search via the RPC. Embedding vectors are sent as JSON arrays;
  // PostgREST converts to vector(1536) for the function parameter.
  const { data: hits, error } = await supabase.rpc("search_chunks", {
    _workspace_id: workspace_id,
    _query_text: q,
    _query_embedding: embedding,
    _limit: limit,
  });
  if (error) throw new Error(`search_chunks rpc failed: ${error.message}`);
  const allRows = (hits ?? []) as RpcRow[];
  if (allRows.length === 0) return [];

  // Relevance floor: keep hits that the FTS matched OR whose vector_score
  // is plausibly on-topic. Without this, the vector branch always returns
  // the K nearest chunks regardless of how distant they really are, which
  // produces ghost results for off-topic queries on small corpora.
  // 0.3 is empirically the cleanest cutoff for text-embedding-3-small:
  // "phone conversation" → a chunk about a call lands around 0.30–0.40,
  // while truly unrelated queries (e.g. "Giraffe") stay below 0.2.
  const MIN_VECTOR_SCORE = 0.3;
  const rows = allRows.filter((r) => r.fts_score > 0 || r.vector_score >= MIN_VECTOR_SCORE);
  if (rows.length === 0) return [];

  // 3. Keep only the top-scoring chunk per atom.
  const bestByAtom = new Map<string, RpcRow>();
  for (const row of rows) {
    const existing = bestByAtom.get(row.atom_id);
    if (!existing || row.rrf_score > existing.rrf_score) {
      bestByAtom.set(row.atom_id, row);
    }
  }
  const atomIds = [...bestByAtom.keys()];

  // 4. Load atom metadata (RLS-scoped to the user).
  const { data: atomRows, error: atomErr } = await supabase
    .from("atoms")
    .select(
      "id, content, capture_comment, captured_at, primary_chapter_id, sources!inner(type, extracted_title, original_url), chapters!primary_chapter_id(id, name)",
    )
    .in("id", atomIds);
  if (atomErr) throw new Error(`atom fetch failed: ${atomErr.message}`);

  const atomsById = new Map<string, AtomRow>();
  for (const a of (atomRows ?? []) as AtomRow[]) atomsById.set(a.id, a);

  // 5. Stitch + sort by rrf_score desc.
  const results: SearchResultAtom[] = [];
  for (const [atomId, hit] of bestByAtom) {
    const atom = atomsById.get(atomId);
    if (!atom) continue;
    const source = Array.isArray(atom.sources) ? atom.sources[0] : atom.sources;
    const chapter = Array.isArray(atom.chapters) ? atom.chapters[0] : atom.chapters;
    results.push({
      atom_id: atom.id,
      content: atom.content,
      capture_comment: atom.capture_comment,
      captured_at: atom.captured_at,
      source: {
        type: (source?.type ?? "paste") as SearchResultAtom["source"]["type"],
        extracted_title: source?.extracted_title ?? null,
        original_url: source?.original_url ?? null,
      },
      chapter: chapter ? { id: chapter.id, name: chapter.name } : null,
      best_chunk_text: hit.text,
      vector_score: hit.vector_score,
      fts_score: hit.fts_score,
      rrf_score: hit.rrf_score,
    });
  }
  results.sort((a, b) => b.rrf_score - a.rrf_score);
  return results;
}
