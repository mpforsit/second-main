import { notFound } from "next/navigation";

import { AtomCard } from "@/components/atom/atom-card";
import { ChapterHeader } from "@/components/chapter/chapter-header";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function ChapterFeedPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;

  const supabase = await getServerSupabase();
  const { data: chapter } = await supabase
    .from("chapters")
    .select("id, name, description, archived_at")
    .eq("id", chapterId)
    .maybeSingle();

  if (!chapter || chapter.archived_at) notFound();

  const { data: atoms } = await supabase
    .from("atoms")
    .select(
      "id, content, capture_comment, captured_at, status, sources!inner(type, extracted_title)",
    )
    .eq("primary_chapter_id", chapterId)
    .eq("status", "ready")
    .order("captured_at", { ascending: false });

  const rows = atoms ?? [];

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-8">
      <ChapterHeader
        id={chapter.id}
        name={chapter.name}
        description={chapter.description}
        atomCount={rows.length}
      />

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((a) => {
            const source = Array.isArray(a.sources) ? a.sources[0] : a.sources;
            return (
              <li key={a.id}>
                <AtomCard
                  id={a.id}
                  content={a.content}
                  source_type={source?.type ?? "paste"}
                  source_title={source?.extracted_title ?? null}
                  capture_comment={a.capture_comment}
                  chapter_name={null /* the page itself names the chapter */}
                  captured_at={a.captured_at}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="border-border text-muted-foreground rounded-md border border-dashed p-12 text-center text-sm">
      No atoms in this chapter yet. Capture something from the right rail.
    </div>
  );
}
