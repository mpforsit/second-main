import { callClaudeStream } from "@/lib/anthropic/client";
import { QA_SYSTEM_PROMPT, renderQaUserPrompt, type QaAtom } from "@/lib/prompts/qa";
import { searchAtoms } from "@/lib/retrieval/search";
import { getServerSupabase } from "@/lib/supabase/server";
import type { UserModel } from "@/types/schemas";

// docs/04-api-spec.md §4.3 POST /api/ask — SSE stream.
export async function POST(request: Request) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await request.json().catch(() => null)) as { question?: string } | null;
  const question = body?.question?.trim();
  if (!question) return new Response("question required", { status: 400 });

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_personal", true)
    .maybeSingle();
  if (!ws) return new Response("workspace_not_found", { status: 404 });

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, payload: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1. Retrieve top 8 atoms via hybrid search.
        const hits = await searchAtoms(ws.id, user.id, question, 20);
        const top = hits.slice(0, 8);

        // 2. Send the candidate atoms upfront so the client can render
        //    citation pills with real titles as tokens stream in.
        const contextAtoms = top.map((a) => ({
          atom_id: a.atom_id,
          title: a.source.extracted_title ?? firstLine(a.content),
          chapter_name: a.chapter?.name ?? null,
          source_type: a.source.type,
        }));
        send(controller, { type: "context", atoms: contextAtoms });

        if (top.length === 0) {
          // Nothing retrieved — let Sonnet say so. Still call to keep the UX
          // consistent + log the call.
        }

        // 3. Load user_model for the prompt.
        const { data: um } = await supabase
          .from("user_models")
          .select("model")
          .eq("user_id", user.id)
          .single();
        const userModel = (um?.model ?? {}) as UserModel;

        // 4. Build the prompt.
        const qaAtoms: QaAtom[] = top.map((a) => ({
          atom_id: a.atom_id,
          source_type: a.source.type,
          source_label: sourceLabel(a.source.type, a.source.original_url),
          captured_at: a.captured_at,
          capture_comment: a.capture_comment,
          chunk_text: a.best_chunk_text,
        }));
        const userPrompt = renderQaUserPrompt(question, userModel, qaAtoms);

        // 5. Stream Sonnet response.
        for await (const event of callClaudeStream({
          model: "claude-sonnet-4-6",
          system: QA_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
          max_tokens: 1024,
          use_case: "qa.synthesize",
          user_id: user.id,
          workspace_id: ws.id,
        })) {
          if (event.type === "text") {
            send(controller, { type: "token", text: event.text });
          } else if (event.type === "done") {
            send(controller, { type: "done" });
          }
        }
      } catch (err) {
        send(controller, {
          type: "error",
          message: err instanceof Error ? err.message : "ask failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function firstLine(content: string): string {
  const first = content.split(/\n+/).find((l) => l.trim().length > 0) ?? "Untitled";
  return first.length > 80 ? first.slice(0, 80) + "…" : first;
}

function sourceLabel(
  type: "paste" | "url" | "upload" | "voice" | "connector",
  original_url: string | null,
): string {
  if (type === "url" && original_url) return original_url;
  if (type === "upload") return "PDF";
  if (type === "voice") return "voice memo";
  return "paste";
}
