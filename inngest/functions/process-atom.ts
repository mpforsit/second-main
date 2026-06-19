import crypto from "node:crypto";

import { callClaude } from "@/lib/anthropic/client";
import { chunk } from "@/lib/chunking/chunker";
import { extractPdfFromStorage } from "@/lib/extraction/pdf";
import { extractArticleFromUrl } from "@/lib/extraction/url";
import { AtomCreatedEvent, inngest } from "@/lib/inngest/client";
import { embedBatch } from "@/lib/openai/embeddings";
import { transcribeFromStorage } from "@/lib/openai/whisper";
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

    try {
      // 1. Load atom + source (Step 7 needs source.type to route extraction).
      const atom = await step.run("load", async () => {
        const { data, error } = await supabase
          .from("atoms")
          .select(
            "id, content, capture_comment, status, source_id, sources!inner(type, original_url, storage_path)",
          )
          .eq("id", atom_id)
          .single();
        if (error || !data) throw new Error(`atom load: ${error?.message ?? "not found"}`);
        const source = Array.isArray(data.sources) ? data.sources[0] : data.sources;
        return {
          id: data.id,
          content: data.content as string,
          capture_comment: data.capture_comment as string | null,
          source_id: data.source_id as string,
          source_type: source?.type as
            | "paste"
            | "url"
            | "upload"
            | "voice"
            | "connector"
            | undefined,
          original_url: (source?.original_url as string | null) ?? null,
          storage_path: (source?.storage_path as string | null) ?? null,
        };
      });

      // 2. Extract (text → passthrough, url → Readability, upload → pdf-parse,
      //    voice → Step 8).
      const extracted = await step.run("extract", async () => {
        if (atom.source_type === "url") {
          if (!atom.original_url) throw new Error("extract: url source missing original_url");
          const article = await extractArticleFromUrl(atom.original_url);
          if (!article.content || article.content.length < 50) {
            throw new Error("extract: page produced no usable text (paywall or empty)");
          }
          return {
            content: article.content,
            extracted_title: article.title,
            extracted_author: article.byline,
          };
        }
        if (atom.source_type === "upload") {
          if (!atom.storage_path) throw new Error("extract: upload source missing storage_path");
          const pdf = await extractPdfFromStorage(atom.storage_path);
          if (!pdf.content) {
            throw new Error("extract: PDF produced no text (scanned/image-only?)");
          }
          return {
            content: pdf.content,
            extracted_title: pdf.title,
            extracted_author: pdf.author,
          };
        }
        if (atom.source_type === "voice") {
          if (!atom.storage_path) throw new Error("extract: voice source missing storage_path");
          const audio = await transcribeFromStorage(atom.storage_path, {
            user_id,
            workspace_id,
          });
          if (!audio.text) {
            throw new Error("extract: voice memo produced no text (silence?)");
          }
          return {
            content: audio.text,
            extracted_title: null as string | null,
            extracted_author: null as string | null,
          };
        }
        // text / paste
        return {
          content: atom.content,
          extracted_title: null as string | null,
          extracted_author: null as string | null,
        };
      });

      // 3. Persist extracted content on the atom + the source row, recomputing
      //    content_hash so dedup works on the resolved text rather than the
      //    pre-extraction placeholder.
      await step.run("save-content", async () => {
        if (extracted.content === atom.content) return; // text/paste path
        const content_hash = crypto.createHash("sha256").update(extracted.content).digest("hex");

        const { error: atomErr } = await supabase
          .from("atoms")
          .update({ content: extracted.content, content_hash })
          .eq("id", atom_id);
        if (atomErr) throw new Error(`save-content atom: ${atomErr.message}`);

        if (extracted.extracted_title || extracted.extracted_author) {
          const { error: srcErr } = await supabase
            .from("sources")
            .update({
              extracted_title: extracted.extracted_title,
              extracted_author: extracted.extracted_author,
            })
            .eq("id", atom.source_id);
          if (srcErr) console.error("[save-content] source title update failed", srcErr);
        }
      });

      const content = extracted.content;

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
        const [{ data: um }, { data: chapters }, { data: intentRows }] = await Promise.all([
          supabase.from("user_models").select("model").eq("user_id", user_id).single(),
          supabase
            .from("chapters")
            .select("id, name, description")
            .eq("workspace_id", workspace_id)
            .is("archived_at", null)
            .order("sort_order"),
          supabase
            .from("intents")
            .select("text, action_type")
            .eq("atom_id", atom_id)
            .order("created_at")
            .limit(1),
        ]);
        const userModel = (um?.model ?? {}) as UserModel;
        const firstIntent = intentRows?.[0];
        const intentForPrompt = firstIntent
          ? {
              text: firstIntent.text as string,
              action_type: firstIntent.action_type as string,
            }
          : null;
        const userPrompt = renderClassifyUserPrompt({
          user_model_serialized: serializeUserModel(userModel),
          existing_chapters: chapters ?? [],
          content,
          capture_comment: atom.capture_comment,
          intent: intentForPrompt,
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
        const { error } = await supabase
          .from("atoms")
          .update({ status: "ready" })
          .eq("id", atom_id);
        if (error) throw new Error(`mark-ready: ${error.message}`);
      });

      // 11. Realtime broadcast → skipped for Step 5 (client polls);
      //     Realtime lands when we need cross-page notifications.

      return { atom_id, chunks: chunks.length, classification };
    } catch (err) {
      // Persist the failure so AtomDetail can surface it (and offer Retry).
      // Inngest still retries the function per `retries: 3`; this update is
      // idempotent. After all retries fail, the atom stays marked failed.
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("atoms")
        .update({ status: "failed", processing_error: message })
        .eq("id", atom_id);
      throw err;
    }
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
