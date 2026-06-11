import { notFound } from "next/navigation";

import { AtomDetail } from "@/components/atom/atom-detail";
import { getServerSupabase } from "@/lib/supabase/server";

interface SourceRow {
  type: "paste" | "url" | "upload" | "voice" | "connector";
  original_url: string | null;
  extracted_title: string | null;
}
interface ChapterRow {
  id: string;
  name: string;
}

export default async function AtomDetailPage({ params }: { params: Promise<{ atomId: string }> }) {
  const { atomId } = await params;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("atoms")
    .select(
      "id, content, capture_comment, captured_at, sources!inner(type, original_url, extracted_title), chapters!primary_chapter_id(id, name)",
    )
    .eq("id", atomId)
    .maybeSingle();

  if (error || !data) notFound();

  const source = (Array.isArray(data.sources) ? data.sources[0] : data.sources) as
    | SourceRow
    | undefined;
  const chapter = (Array.isArray(data.chapters) ? data.chapters[0] : data.chapters) as
    | ChapterRow
    | undefined;

  return (
    <AtomDetail
      id={data.id}
      content={data.content}
      capture_comment={data.capture_comment}
      captured_at={data.captured_at}
      source_type={source?.type ?? "paste"}
      source_url={source?.original_url ?? null}
      source_title={source?.extracted_title ?? null}
      chapter={chapter ? { id: chapter.id, name: chapter.name } : null}
    />
  );
}
