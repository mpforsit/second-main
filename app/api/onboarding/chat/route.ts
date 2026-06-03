import type { MessageParam } from "@anthropic-ai/sdk/resources";

import { callClaudeStream } from "@/lib/anthropic/client";
import { ONBOARDING_SYSTEM_PROMPT } from "@/lib/prompts/onboarding";
import { getServerSupabase } from "@/lib/supabase/server";

const MARKER_OPEN = "<onboarding_complete>";
const MARKER_CLOSE = "</onboarding_complete>";

// Per docs/04-api-spec.md §4.3 — SSE stream of { type: 'token' | 'complete' }.
// (Spec lists POST; matches the chat-completion convention.)
export async function POST(request: Request) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as { messages: MessageParam[] };
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, payload: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      let sentLen = 0;
      let foundMarker = false;

      try {
        for await (const event of callClaudeStream({
          model: "claude-sonnet-4-6",
          system: ONBOARDING_SYSTEM_PROMPT,
          messages: body.messages,
          max_tokens: 2048,
          use_case: "onboarding",
          user_id: user.id,
        })) {
          if (event.type === "text") {
            fullText += event.text;
            if (foundMarker) continue;

            const idx = fullText.indexOf(MARKER_OPEN);
            if (idx !== -1) {
              // Marker has arrived: flush up to it, then go silent for the
              // rest of the stream. The structured block is surfaced via
              // the `complete` event when the stream finishes.
              if (idx > sentLen) {
                send(controller, { type: "token", text: fullText.slice(sentLen, idx) });
                sentLen = idx;
              }
              foundMarker = true;
            } else {
              // Hold back enough trailing chars that a marker being formed
              // mid-token can't slip out into the transcript.
              const safeEnd = Math.max(sentLen, fullText.length - MARKER_OPEN.length);
              if (safeEnd > sentLen) {
                send(controller, { type: "token", text: fullText.slice(sentLen, safeEnd) });
                sentLen = safeEnd;
              }
            }
          } else if (event.type === "done") {
            if (!foundMarker) {
              if (fullText.length > sentLen) {
                send(controller, { type: "token", text: fullText.slice(sentLen) });
              }
            } else {
              const startIdx = fullText.indexOf(MARKER_OPEN) + MARKER_OPEN.length;
              const endIdx = fullText.indexOf(MARKER_CLOSE);
              if (endIdx > startIdx) {
                const json = fullText.slice(startIdx, endIdx).trim();
                try {
                  const parsed = JSON.parse(json);
                  send(controller, {
                    type: "complete",
                    user_model: parsed.user_model,
                    suggested_chapters: parsed.suggested_chapters,
                  });
                } catch (err) {
                  send(controller, {
                    type: "error",
                    message: `Failed to parse onboarding_complete block: ${err instanceof Error ? err.message : String(err)}`,
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        send(controller, {
          type: "error",
          message: err instanceof Error ? err.message : "stream failed",
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
