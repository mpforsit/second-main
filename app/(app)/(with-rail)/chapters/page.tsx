import Link from "next/link";

import { NewChapterDialog } from "@/components/chapter/new-chapter-dialog";
import { getServerSupabase } from "@/lib/supabase/server";

interface ChapterRow {
  id: string;
  name: string;
  description: string | null;
  atoms: Array<{ count: number }>;
}

export default async function ChaptersPage() {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("chapters")
    .select("id, name, description, atoms!primary_chapter_id(count)")
    .is("archived_at", null)
    .order("sort_order");

  if (error) {
    return (
      <main className="flex flex-1 flex-col p-8">
        <p className="text-destructive text-sm">Failed to load chapters: {error.message}</p>
      </main>
    );
  }

  const chapters = (data ?? []) as ChapterRow[];

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Chapters</h1>
        <NewChapterDialog />
      </div>

      {chapters.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {chapters.map((c) => {
            const count = c.atoms?.[0]?.count ?? 0;
            return (
              <li key={c.id}>
                <Link
                  href={`/chapters/${c.id}`}
                  className="border-border hover:bg-muted/40 flex items-center justify-between gap-4 rounded-md border p-4 transition-colors"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.description && (
                      <span className="text-muted-foreground truncate text-xs">
                        {c.description}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {count} {count === 1 ? "atom" : "atoms"}
                  </span>
                </Link>
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
    <div className="border-border text-muted-foreground flex flex-col items-center gap-2 rounded-md border border-dashed p-12 text-sm">
      <p>No chapters yet.</p>
      <p className="text-xs">Capture something to seed your first chapter, or create one above.</p>
    </div>
  );
}
