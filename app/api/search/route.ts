import { searchAtoms } from "@/lib/retrieval/search";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "8"), 1), 20);
  if (!q) return Response.json({ results: [] });

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_personal", true)
    .maybeSingle();
  if (!ws) return Response.json({ error: "workspace_not_found" }, { status: 404 });

  try {
    const results = await searchAtoms(ws.id, user.id, q, limit);
    return Response.json({
      results: results.map((r) => ({
        atom_id: r.atom_id,
        title: r.source.extracted_title || firstLine(r.content),
        snippet: r.best_chunk_text,
        chapter_name: r.chapter?.name ?? null,
      })),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "search_failed" },
      { status: 500 },
    );
  }
}

function firstLine(content: string): string {
  const first = content.split(/\n+/).find((l) => l.trim().length > 0) ?? "Untitled";
  return first.length > 100 ? first.slice(0, 100) + "…" : first;
}
