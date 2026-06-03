"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { completeOnboarding } from "@/server-actions/user-model";
import { signOut } from "@/server-actions/auth";
import type { ChapterInput, UserModel } from "@/types/schemas";

type Role = "user" | "assistant";
interface Message {
  role: Role;
  content: string;
}

const KICKOFF: Message = { role: "user", content: "Hi, let's get started." };

interface CompletePayload {
  user_model: UserModel;
  suggested_chapters: ChapterInput[];
}

export function OnboardingChat() {
  const router = useRouter();

  // Full conversation incl. the hidden kickoff turn we use to prime the model.
  const [messages, setMessages] = useState<Message[]>([KICKOFF]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [input, setInput] = useState("");
  const [complete, setComplete] = useState<CompletePayload | null>(null);
  const [confirming, setConfirming] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // Auto-scroll on new content.
  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streamingText]);

  // Auto-kick off the assistant's first question once on mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runTurn([KICKOFF]);
  }, []);

  async function runTurn(history: Message[]) {
    setStreaming(true);
    setStreamingText("");

    try {
      const res = await fetch("/api/onboarding/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        toast.error(`Chat failed (HTTP ${res.status})`);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));

          if (payload.type === "token") {
            assistantText += payload.text;
            setStreamingText(assistantText);
          } else if (payload.type === "complete") {
            setComplete({
              user_model: payload.user_model,
              suggested_chapters: payload.suggested_chapters,
            });
          } else if (payload.type === "error") {
            toast.error(payload.message);
          }
        }
      }

      if (assistantText) {
        setMessages((prev) => [...prev, { role: "assistant", content: assistantText }]);
      }
      setStreamingText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setStreaming(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    await runTurn(next);
  }

  async function onConfirm() {
    if (!complete) return;
    setConfirming(true);
    const res = await completeOnboarding(complete);
    if (res?.ok === false) {
      toast.error(res.error);
      setConfirming(false);
      return;
    }
    // completeOnboarding calls redirect('/'); router refresh covers the rare
    // case the action returns normally (it shouldn't).
    router.refresh();
  }

  // Step counter: count assistant turns (each one is roughly one question).
  const assistantTurns = messages.filter((m) => m.role === "assistant").length;
  const stepNumber = Math.min(assistantTurns + (streaming ? 1 : 0), 5);

  if (complete) {
    return <ConfirmationCard payload={complete} confirming={confirming} onConfirm={onConfirm} />;
  }

  const visibleMessages = messages.slice(1); // hide KICKOFF turn

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="text-base font-semibold tracking-tight">Second</span>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-xs">
            Step {Math.max(stepNumber, 1)} of about 5
          </span>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div
        ref={transcriptRef}
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-6"
      >
        {visibleMessages.map((m, i) => (
          <ChatBubble key={i} role={m.role} text={m.content} />
        ))}
        {streaming && streamingText && <ChatBubble role="assistant" text={streamingText} />}
        {streaming && !streamingText && <p className="text-muted-foreground text-sm">…</p>}
      </div>

      <form
        onSubmit={onSubmit}
        className="mx-auto flex w-full max-w-2xl items-center gap-2 border-t p-4"
      >
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your answer…"
          disabled={streaming}
        />
        <Button type="submit" disabled={streaming || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}

function ChatBubble({ role, text }: { role: Role; text: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-br-md px-4 py-2 text-sm whitespace-pre-wrap"
            : "bg-muted text-foreground max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2 text-sm whitespace-pre-wrap"
        }
      >
        {text}
      </div>
    </div>
  );
}

function ConfirmationCard({
  payload,
  confirming,
  onConfirm,
}: {
  payload: CompletePayload;
  confirming: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Here&apos;s your starter setup</CardTitle>
          <CardDescription>
            We&apos;ll create these chapters and remember the people + projects you mentioned. You
            can edit any of it later from the User model page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Section title="Starter chapters">
            <ul className="flex flex-col gap-1.5 text-sm">
              {payload.suggested_chapters.map((c, i) => (
                <li key={i}>
                  <span className="font-medium">{c.name}</span>
                  {c.description ? (
                    <span className="text-muted-foreground"> — {c.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          {payload.user_model.projects.length > 0 && (
            <Section title="Projects">
              <ul className="flex flex-col gap-1 text-sm">
                {payload.user_model.projects.map((p) => (
                  <li key={p.id}>
                    <span className="font-medium">{p.name}</span>
                    {p.description ? (
                      <span className="text-muted-foreground"> — {p.description}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {payload.user_model.people.length > 0 && (
            <Section title="Key people">
              <ul className="flex flex-col gap-1 text-sm">
                {payload.user_model.people.map((p) => (
                  <li key={p.id}>
                    <span className="font-medium">{p.name}</span>
                    {p.role ? <span className="text-muted-foreground"> — {p.role}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Button onClick={onConfirm} disabled={confirming} className="self-end">
            {confirming ? "Setting up…" : "Looks good, let's go"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h3>
      {children}
    </div>
  );
}
