import { notFound, redirect } from "next/navigation";

import { AtomDetail } from "@/components/atom/atom-detail";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/service";

interface SourceRow {
  type: "paste" | "url" | "upload" | "voice" | "connector";
  original_url: string | null;
  storage_path: string | null;
  extracted_title: string | null;
}
interface ChapterRow {
  id: string;
  name: string;
}

const AUDIO_URL_TTL_SEC = 6 * 60 * 60; // 6 hours

export default async function AtomDetailPage({ params }: { params: Promise<{ atomId: string }> }) {
  const { atomId } = await params;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: atomRow, error: atomErr }, { data: commentRows }, { data: intentRows }] =
    await Promise.all([
      supabase
        .from("atoms")
        .select(
          "id, content, capture_comment, captured_at, status, processing_error, sources!inner(type, original_url, storage_path, extracted_title), chapters!primary_chapter_id(id, name)",
        )
        .eq("id", atomId)
        .maybeSingle(),
      supabase
        .from("comments")
        .select("id, text, is_private, created_at, author_id")
        .eq("atom_id", atomId)
        .order("created_at"),
      supabase
        .from("intents")
        .select("id, text, action_type, due_at, status")
        .eq("atom_id", atomId)
        .order("created_at"),
    ]);

  if (atomErr || !atomRow) notFound();

  const source = (Array.isArray(atomRow.sources) ? atomRow.sources[0] : atomRow.sources) as
    | SourceRow
    | undefined;
  const chapter = (Array.isArray(atomRow.chapters) ? atomRow.chapters[0] : atomRow.chapters) as
    | ChapterRow
    | undefined;

  let audio_url: string | null = null;
  if (source?.type === "voice" && source.storage_path) {
    const service = getServiceSupabase();
    const { data: signed } = await service.storage
      .from("voice")
      .createSignedUrl(source.storage_path, AUDIO_URL_TTL_SEC);
    audio_url = signed?.signedUrl ?? null;
  }

  return (
    <AtomDetail
      id={atomRow.id}
      content={atomRow.content}
      capture_comment={atomRow.capture_comment}
      captured_at={atomRow.captured_at}
      status={atomRow.status}
      processing_error={atomRow.processing_error}
      source_type={source?.type ?? "paste"}
      source_url={source?.original_url ?? null}
      source_title={source?.extracted_title ?? null}
      audio_url={audio_url}
      chapter={chapter ? { id: chapter.id, name: chapter.name } : null}
      comments={commentRows ?? []}
      intents={intentRows ?? []}
      current_user_id={user.id}
    />
  );
}
