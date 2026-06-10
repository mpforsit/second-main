import { callClaude } from "@/lib/anthropic/client";
import { chunk } from "@/lib/chunking/chunker";
import { AtomCreatedEvent, inngest } from "@/lib/inngest/client";
import { embedBatch } from "@/lib/openai/embeddings";
import {
  CLASSIFY_CHAPTER_SYSTEM_PROMPT,
  renderClassifyUserPrompt,
  type ClassifyChapterResult,
} from "@/lib/prompts/classify-chapter";
import { getServiceSupabase } from "@/lib/supabase/service";
import type { UserModel } from "@/types/schemas";

export const processAtom = inngest.createFunction(
  { id: "process-atom", triggers: [AtomCreatedEvent], retries: 3 },
  async ({ event, step }) => {
    const { atom_id, workspace_id, user_id } = event.data;
    const supabase = getServiceSupabase();

    // 1. Load atom + capture comment. (Source details aren't used until
    // URL/PDF/voice extraction lands in Steps 7–8.)
    const atom = await step.run("load", async () => {
      const { data, error } = await supabase
        .from("atoms")
        .select("id, content, capture_comment, status")
        .eq("id", atom_id)
        .single();
      if (error || !data) throw new Error(`atom load: ${error?.message ?? "not found"}`);
      return data as {
        id: string;
        content: string;
        capture_comment: string | null;
        status: string;
      };
    });

    // 2–3. Extract content. Text/paste already populated by capture(). URL,
    // PDF, voice are no-ops until later steps; treat whatever's in
    // atoms.content as canonical.
    const content = atom.content;

    // 4. Chunk
    const chunks = await step.run("chunk", async () => chunk(content));

    // 5. Embed in batches
    const embeddings = await step.run("embed", async () =>
      embedBatch(chunks, { user_id, workspace_id, use_case: "embed.chunk" }),
    );

    // 6. Persist chunks
    await step.run("save-chunks", async () => {
      if (chunks.length === 0) return;
      const rows = chunks.map((text, i) => ({
        atom_id,
        workspace_id,
        ordinal: i,
        text,
        embedding: embeddings[i],
      }));
      const { error } = await supabase.from("chunks").insert(rows);
      if (error) throw new Error(`save-chunks: ${error.message}`);
    });

    // 7. Classify into a chapter (Haiku → strict JSON, one retry)
    const classification = await step.run("classify", async () => {
      const [{ data: um }, { data: chapters }] = await Promise.all([
        supabase.from("user_models").select("model").eq("user_id", user_id).single(),
        supabase
          .from("chapters")
          .select("id, name, description")
          .eq("workspace_id", workspace_id)
          .is("archived_at", null)
          .order("sort_order"),
      ]);
      const userModel = (um?.model ?? {}) as UserModel;
      const userPrompt = renderClassifyUserPrompt({
        user_model_serialized: serializeUserModel(userModel),
        existing_chapters: chapters ?? [],
        content,
        capture_comment: atom.capture_comment,
        intent: null, // intents-on-classify lands in Step 9
      });

      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { text } = await callClaude({
          model: "claude-haiku-4-5-20251001",
          system: CLASSIFY_CHAPTER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
          max_tokens: 512,
          use_case: "capture.classify",
          user_id,
          workspace_id,
        });
        const cleaned = stripCodeFences(text).trim();
        try {
          return JSON.parse(cleaned) as ClassifyChapterResult;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw new Error(`classify: JSON parse failed twice (${lastErr?.message ?? "unknown"})`);
    });

    // 8. Record audit + pre-emptively assign primary_chapter_id
    await step.run("record-suggestion", async () => {
      let chapterId: string | null = null;
      let suggestionType: "chapter_assignment" | "new_chapter" | null = null;

      if (classification.decision === "assign" && classification.chapter_id) {
        chapterId = classification.chapter_id;
        suggestionType = "chapter_assignment";
      } else if (classification.decision === "new" && classification.new_chapter) {
        const { data, error } = await supabase
          .from("chapters")
          .insert({
            workspace_id,
            name: classification.new_chapter.name,
            description: classification.new_chapter.description,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`new chapter insert: ${error?.message ?? "no row"}`);
        chapterId = data.id;
        suggestionType = "new_chapter";
      }

      if (suggestionType && chapterId) {
        const { error: sErr } = await supabase.from("suggestions").insert({
          workspace_id,
          user_id,
          type: suggestionType,
          payload: { atom_id, chapter_id: chapterId, classification },
          status: "open",
        });
        if (sErr) throw new Error(`suggestion insert: ${sErr.message}`);

        const { error: uErr } = await supabase
          .from("atoms")
          .update({ primary_chapter_id: chapterId })
          .eq("id", atom_id);
        if (uErr) throw new Error(`atom assign: ${uErr.message}`);
      }
    });

    // 9. propose-links → no-op for Step 5 (Step 12 in build plan)

    // 10. Mark ready
    await step.run("mark-ready", async () => {
      const { error } = await supabase.from("atoms").update({ status: "ready" }).eq("id", atom_id);
      if (error) throw new Error(`mark-ready: ${error.message}`);
    });

    // 11. Realtime broadcast → skipped for Step 5 (client polls);
    //     Realtime lands when we need cross-page notifications.

    return { atom_id, chunks: chunks.length, classification };
  },
);

function stripCodeFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return m?.[1] ?? s;
}

function serializeUserModel(m: UserModel): string {
  const parts: string[] = [];
  if (m.projects?.length) {
    parts.push("Projects:");
    for (const p of m.projects) {
      parts.push(`- ${p.name}${p.description ? `: ${p.description}` : ""}`);
    }
  }
  if (m.people?.length) {
    parts.push("Key people:");
    for (const p of m.people) {
      parts.push(`- ${p.name}${p.role ? ` (${p.role})` : ""}${p.context ? `: ${p.context}` : ""}`);
    }
  }
  if (m.vocabulary?.length) {
    parts.push("Vocabulary:");
    for (const v of m.vocabulary) {
      parts.push(`- ${v.term}: ${v.meaning}`);
    }
  }
  return parts.join("\n") || "(empty)";
}
