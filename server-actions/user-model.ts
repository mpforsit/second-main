"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getServerSupabase } from "@/lib/supabase/server";
import { ChapterInputSchema, UserModelSchema } from "@/types/schemas";

const InputSchema = z.object({
  user_model: UserModelSchema,
  suggested_chapters: z.array(ChapterInputSchema).min(1).max(20),
});

// Spec (docs/04-api-spec.md §4.2) lists `completeOnboarding(messages)`. We
// instead take the structured payload parsed from the SSE `complete` event —
// less round-trip, zod-validated. The conversation transcript is recreatable
// from `llm_call_logs` if we ever need it.
export async function completeOnboarding(rawInput: unknown) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "unauthorized" };

  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false as const, error: "invalid_input", issues: parsed.error.issues };
  }
  const { user_model, suggested_chapters } = parsed.data;

  const { data: ws, error: wsError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_personal", true)
    .maybeSingle();
  if (wsError || !ws) {
    return { ok: false as const, error: "workspace_not_found" };
  }

  // 1. Persist the user model + mark onboarding complete.
  const { error: umError } = await supabase
    .from("user_models")
    .update({
      model: user_model,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (umError) {
    return { ok: false as const, error: `user_model_update_failed: ${umError.message}` };
  }

  // 2. Insert starter chapters.
  const rows = suggested_chapters.map((c, i) => ({
    workspace_id: ws.id,
    name: c.name,
    description: c.description ?? null,
    sort_order: i,
  }));
  const { data: chapters, error: chError } = await supabase
    .from("chapters")
    .insert(rows)
    .select("id");
  if (chError) {
    return { ok: false as const, error: `chapter_insert_failed: ${chError.message}` };
  }

  redirect("/");

  // unreachable — `redirect` throws, but satisfies the TS return-type
  return { ok: true as const, chapter_ids: (chapters ?? []).map((c) => c.id) };
}
