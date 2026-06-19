"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getServerSupabase } from "@/lib/supabase/server";
import { IntentActionEnum, IntentUpdateSchema } from "@/types/schemas";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const AddIntentSchema = z.object({
  atom_id: z.string().uuid(),
  text: z.string().min(1).max(500),
  action_type: IntentActionEnum,
  due_at: z.string().datetime().nullable().optional(),
});

export async function addIntent(rawInput: unknown): Promise<Result<{ id: string }>> {
  const parsed = AddIntentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  // We need the workspace_id of the atom (RLS will block if the user can't
  // see the atom; a separate select is the cheapest way to discover it).
  const { data: atom } = await supabase
    .from("atoms")
    .select("workspace_id")
    .eq("id", parsed.data.atom_id)
    .maybeSingle();
  if (!atom) return { ok: false, error: "atom_not_found" };

  const { data, error } = await supabase
    .from("intents")
    .insert({
      atom_id: parsed.data.atom_id,
      author_id: user.id,
      workspace_id: atom.workspace_id,
      text: parsed.data.text,
      action_type: parsed.data.action_type,
      due_at: parsed.data.due_at ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };

  revalidatePath(`/atoms/${parsed.data.atom_id}`);
  return { ok: true, data: { id: data.id } };
}

export async function updateIntent(rawInput: unknown): Promise<Result<void>> {
  const parsed = IntentUpdateSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const patch: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.text !== undefined) patch.text = parsed.data.text;
  if (parsed.data.action_type !== undefined) patch.action_type = parsed.data.action_type;
  if (parsed.data.due_at !== undefined) patch.due_at = parsed.data.due_at;

  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const { data: row, error } = await supabase
    .from("intents")
    .update(patch)
    .eq("id", parsed.data.intent_id)
    .eq("author_id", user.id)
    .select("atom_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (row) revalidatePath(`/atoms/${row.atom_id}`);

  return { ok: true, data: undefined };
}

export async function dismissIntent(intent_id: string): Promise<Result<void>> {
  return updateIntent({ intent_id, status: "dismissed" });
}

export async function deleteIntent(intent_id: string): Promise<Result<void>> {
  if (!z.string().uuid().safeParse(intent_id).success) {
    return { ok: false, error: "invalid_id" };
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: row, error } = await supabase
    .from("intents")
    .delete()
    .eq("id", intent_id)
    .eq("author_id", user.id)
    .select("atom_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (row) revalidatePath(`/atoms/${row.atom_id}`);

  return { ok: true, data: undefined };
}
