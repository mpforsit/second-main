"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getServerSupabase } from "@/lib/supabase/server";
import { ChapterInputSchema } from "@/types/schemas";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type AuthCtx =
  | { ok: true; supabase: Awaited<ReturnType<typeof getServerSupabase>>; workspace_id: string }
  | { ok: false; error: "unauthorized" | "workspace_not_found" };

async function getUserAndWorkspace(): Promise<AuthCtx> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: ws, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_personal", true)
    .maybeSingle();
  if (error || !ws) return { ok: false, error: "workspace_not_found" };

  return { ok: true, supabase, workspace_id: ws.id };
}

export async function createChapter(rawInput: unknown): Promise<Result<{ id: string }>> {
  const parsed = ChapterInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }
  const ctx = await getUserAndWorkspace();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  // Append at the end of the existing sort order.
  const { data: maxRow } = await ctx.supabase
    .from("chapters")
    .select("sort_order")
    .eq("workspace_id", ctx.workspace_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("chapters")
    .insert({
      workspace_id: ctx.workspace_id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      sort_order: (maxRow?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };

  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id } };
}

const RenameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
});

export async function renameChapter(id: string, name: string): Promise<Result<void>> {
  const parsed = RenameSchema.safeParse({ id, name });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }
  const ctx = await getUserAndWorkspace();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const { error } = await ctx.supabase
    .from("chapters")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .eq("workspace_id", ctx.workspace_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function archiveChapter(id: string): Promise<Result<void>> {
  const ctx = await getUserAndWorkspace();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const { error } = await ctx.supabase
    .from("chapters")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", ctx.workspace_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
