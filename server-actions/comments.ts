"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getServerSupabase } from "@/lib/supabase/server";
import { CommentInputSchema } from "@/types/schemas";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function addComment(rawInput: unknown): Promise<Result<{ id: string }>> {
  const parsed = CommentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data, error } = await supabase
    .from("comments")
    .insert({
      atom_id: parsed.data.atom_id,
      author_id: user.id,
      text: parsed.data.text,
      is_private: parsed.data.is_private ?? true,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };

  revalidatePath(`/atoms/${parsed.data.atom_id}`);
  return { ok: true, data: { id: data.id } };
}

const UpdateCommentSchema = z.object({
  comment_id: z.string().uuid(),
  text: z.string().min(1).max(5000),
});

export async function updateComment(rawInput: unknown): Promise<Result<void>> {
  const parsed = UpdateCommentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: row, error } = await supabase
    .from("comments")
    .update({ text: parsed.data.text })
    .eq("id", parsed.data.comment_id)
    .eq("author_id", user.id)
    .select("atom_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (row) revalidatePath(`/atoms/${row.atom_id}`);

  return { ok: true, data: undefined };
}

export async function deleteComment(comment_id: string): Promise<Result<void>> {
  if (!z.string().uuid().safeParse(comment_id).success) {
    return { ok: false, error: "invalid_id" };
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: row, error } = await supabase
    .from("comments")
    .delete()
    .eq("id", comment_id)
    .eq("author_id", user.id)
    .select("atom_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (row) revalidatePath(`/atoms/${row.atom_id}`);

  return { ok: true, data: undefined };
}
