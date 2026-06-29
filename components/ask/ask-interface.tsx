"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface CtxAtom {
  atom_id: string;
  title: string;
  chapter_name: string | null;
  source_type: "paste" | "url" | "upload" | "voice" | "connector";
}

const RECENT_KEY = "second:ask:recent";
const RECENT_MAX = 10;

export function AskInterface() {
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [response, setResponse] = useState("");
  const [contextAtoms, setContextAtoms] = useState<CtxAtom[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate recent questions from localStorage on mount. Deferred via
  // setTimeout to keep the setState outside the synchronous effect body
  // (React 19's react-hooks/set-state-in-effect rule).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(RECENT_KEY);
        if (raw) setRecent(JSON.parse(raw) as string[]);
      } catch {
        // ignore
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  function persistRecent(next: string[]) {
    setRecent(next);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  async function ask(q: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSubmittedQuestion(q);
    setResponse("");
    setContextAtoms([]);
    setStreaming(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        toast.error(`Ask failed (HTTP ${res.status})`);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
          if (payload.type === "context") {
            setContextAtoms(payload.atoms as CtxAtom[]);
          } else if (payload.type === "token") {
            setResponse((prev) => prev + payload.text);
          } else if (payload.type === "error") {
            toast.error(payload.message);
          }
        }
      }

      // Save to recents on success.
      const next = [q, ...recent.filter((r) => r !== q)].slice(0, RECENT_MAX);
      persistRecent(next);
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        toast.error(err instanceof Error ? err.message : "Network error");
      }
    } finally {
      setStreaming(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    void ask(q);
    setQuestion("");
  }

  // Index the context for fast citation rendering.
  const byId = useMemo(() => {
    const m = new Map<string, CtxAtom>();
    for (const a of contextAtoms) m.set(a.atom_id, a);
    return m;
  }, [contextAtoms]);

  // Cited atoms = those whose UUID appears in the response text.
  const citedAtoms = useMemo(() => {
    if (!response) return [];
    const seen = new Set<string>();
    const re = /\[atom:([0-9a-f-]{36})\]/gi;
    for (const m of response.matchAll(re)) {
      if (m[1]) seen.add(m[1]);
    }
    return [...seen].map((id) => byId.get(id)).filter((a): a is CtxAtom => !!a);
  }, [response, byId]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        <p className="text-muted-foreground text-sm">
          Questions answered from your own captures, with inline citations.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit(e as unknown as React.FormEvent);
            }
          }}
          rows={3}
          placeholder="Ask anything about what you've captured…"
          disabled={streaming}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring resize-y rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-[10px]">⌘+Enter to send</span>
          <Button type="submit" disabled={streaming || !question.trim()}>
            {streaming ? "Thinking…" : "Ask"}
          </Button>
        </div>
      </form>

      {submittedQuestion && (
        <section className="flex flex-col gap-4">
          <p className="text-muted-foreground text-xs">You asked:</p>
          <p className="text-sm">{submittedQuestion}</p>

          {response ? (
            <article className="text-sm leading-7">
              <RenderedAnswer text={response} byId={byId} />
            </article>
          ) : streaming ? (
            <p className="text-muted-foreground text-sm">…</p>
          ) : null}

          {citedAtoms.length > 0 && (
            <section className="flex flex-col gap-2 pt-4">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Cited atoms
              </h2>
              <ul className="flex flex-col gap-2">
                {citedAtoms.map((a) => (
                  <li key={a.atom_id}>
                    <Link
                      href={`/atoms/${a.atom_id}`}
                      className="border-border hover:bg-muted/40 flex items-center justify-between gap-3 rounded-md border p-2 text-sm transition-colors"
                    >
                      <span className="truncate">{a.title}</span>
                      {a.chapter_name && (
                        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]">
                          {a.chapter_name}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-2 pt-4">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Recent questions
          </h2>
          <ul className="flex flex-col">
            {recent.map((q, i) => (
              <li key={`${q}-${i}`}>
                <button
                  type="button"
                  onClick={() => void ask(q)}
                  disabled={streaming}
                  className="hover:bg-muted text-foreground w-full truncate rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-50"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/**
 * Renders streamed answer text with [atom:UUID] tokens replaced by clickable
 * citation pills. UUIDs not in the context map render as a generic [↗] pill
 * (rare; happens if Sonnet cites an atom we didn't include in retrieval).
 */
function RenderedAnswer({ text, byId }: { text: string; byId: Map<string, CtxAtom> }) {
  // Split on [atom:UUID] tokens while preserving the matches.
  const parts: Array<{ kind: "text"; value: string } | { kind: "cite"; id: string }> = [];
  const re = /\[atom:([0-9a-f-]{36})\]/gi;
  let lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const before = text.slice(lastIndex, m.index);
    if (before) parts.push({ kind: "text", value: before });
    if (m[1]) parts.push({ kind: "cite", id: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push({ kind: "text", value: text.slice(lastIndex) });

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.value}</span>;
        const atom = byId.get(p.id);
        return (
          <Link
            key={i}
            href={`/atoms/${p.id}`}
            className="bg-muted text-foreground hover:bg-muted-foreground/20 mx-0.5 inline-flex items-baseline rounded px-1.5 py-0.5 text-xs no-underline"
            title={atom?.title ?? p.id}
          >
            {atom ? truncateTitle(atom.title) : "↗"}
          </Link>
        );
      })}
    </span>
  );
}

function truncateTitle(s: string): string {
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
