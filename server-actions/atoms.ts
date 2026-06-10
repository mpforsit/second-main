"use server";

import crypto from "node:crypto";

import { inngest } from "@/lib/inngest/client";
import { getServerSupabase } from "@/lib/supabase/server";
import { CaptureInputSchema, type CaptureInput } from "@/types/schemas";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Phase 1 / Step 5: handles the text-mode branch end-to-end. URL / upload /
 * voice branches accept the input but content extraction is no-op until
 * Steps 7–8 wire those in.
 */
export async function capture(rawInput: unknown): Promise<Result<{ atom_id: string }>> {
  const parsed = CaptureInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: `validation: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  }
  const input: CaptureInput = parsed.data;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_personal", true)
    .maybeSingle();
  if (wsErr || !ws) return { ok: false, error: "workspace_not_found" };

  // Quota check — Step 14 wires the enforcement.

  // 5. Create the source row. (URL/PDF/voice branches add their metadata
  //    when those modes get implemented in later steps.)
  const sourceType: CaptureInput["text"] extends string ? "paste" : "paste" = "paste";
  void sourceType;

  let source_type: "paste" | "url" | "upload" | "voice" = "paste";
  let original_url: string | null = null;
  let storage_path: string | null = null;
  if (input.url) {
    source_type = "url";
    original_url = input.url;
  } else if (input.uploadStoragePath) {
    source_type = "upload";
    storage_path = input.uploadStoragePath;
  } else if (input.voiceStoragePath) {
    source_type = "voice";
    storage_path = input.voiceStoragePath;
  }

  const { data: srcRow, error: srcErr } = await supabase
    .from("sources")
    .insert({ type: source_type, original_url, storage_path })
    .select("id")
    .single();
  if (srcErr || !srcRow)
    return { ok: false, error: `source_insert: ${srcErr?.message ?? "no row"}` };

  // 6. Atom row. Text/paste captures already have content; other modes get
  //    a placeholder until the background extractor fills it in.
  const content = input.text ?? "";
  const content_hash = sha256(content || `placeholder:${srcRow.id}`);

  const { data: atomRow, error: atomErr } = await supabase
    .from("atoms")
    .insert({
      workspace_id: ws.id,
      source_id: srcRow.id,
      content,
      content_hash,
      capture_comment: input.comment ?? null,
      status: "processing",
      created_by: user.id,
      primary_chapter_id: input.chapter_id ?? null,
    })
    .select("id")
    .single();
  if (atomErr || !atomRow) {
    // Surface unique-violation on (workspace_id, content_hash) cleanly.
    if (atomErr?.code === "23505") {
      return { ok: false, error: "duplicate_content" };
    }
    return { ok: false, error: `atom_insert: ${atomErr?.message ?? "no row"}` };
  }

  // 7. Intent row (optional)
  if (input.intent) {
    const { error: intErr } = await supabase.from("intents").insert({
      atom_id: atomRow.id,
      author_id: user.id,
      workspace_id: ws.id,
      text: input.intent.text,
      action_type: input.intent.action_type,
      due_at: input.intent.due_at ?? null,
    });
    if (intErr) console.error("[capture] intent insert failed", intErr);
  }

  // 8. Fire-and-forget Inngest event. The pipeline does extract → chunk →
  //    embed → classify → ready.
  await inngest.send({
    name: "atom.created",
    data: { atom_id: atomRow.id, workspace_id: ws.id, user_id: user.id },
  });

  return { ok: true, data: { atom_id: atomRow.id } };
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
