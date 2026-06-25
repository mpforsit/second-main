import { redirect } from "next/navigation";

import { AtomCard } from "@/components/atom/atom-card";
import { SearchForm } from "@/components/search/search-form";
import { searchAtoms } from "@/lib/retrieval/search";
import { getServerSupabase } from "@/lib/supabase/server";
import { highlightSegments, snippetAround } from "@/lib/text/highlight";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_personal", true)
    .maybeSingle();

  let results: Awaited<ReturnType<typeof searchAtoms>> = [];
  let searchError: string | null = null;
  if (query && workspace) {
    try {
      results = await searchAtoms(workspace.id, user.id, query, 20);
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-muted-foreground text-sm">
          Hybrid full-text + semantic search across your atoms.
        </p>
      </header>

      <SearchForm initialQuery={query} />

      {searchError && <p className="text-destructive text-sm">Search failed: {searchError}</p>}

      {query && !searchError && (
        <p className="text-muted-foreground text-xs">
          {results.length === 0
            ? "No results."
            : `${results.length} result${results.length === 1 ? "" : "s"}.`}
        </p>
      )}

      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((r) => {
            const around = snippetAround(r.best_chunk_text, query, 280);
            const segs = highlightSegments(around, query);
            const snippet = (
              <span>
                {segs.map((s, i) =>
                  s.match ? (
                    <mark
                      key={i}
                      className="text-foreground bg-yellow-200/60 dark:bg-yellow-500/30"
                    >
                      {s.text}
                    </mark>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </span>
            );
            return (
              <li key={r.atom_id}>
                <AtomCard
                  id={r.atom_id}
                  content={r.content}
                  source_type={r.source.type}
                  source_title={r.source.extracted_title}
                  capture_comment={r.capture_comment}
                  chapter_name={r.chapter?.name ?? null}
                  captured_at={r.captured_at}
                  snippet={snippet}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
