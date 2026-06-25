"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { highlightSegments, snippetAround } from "@/lib/text/highlight";

interface PaletteResult {
  atom_id: string;
  title: string;
  snippet: string;
  chapter_name: string | null;
}

const DEBOUNCE_MS = 250;

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PaletteResult[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Global Cmd/Ctrl+K to toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced fetch when the query changes.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) return;

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      void fetch(`/api/search?q=${encodeURIComponent(term)}&limit=8`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((body: { results?: PaletteResult[]; error?: string }) => {
          if (controller.signal.aborted) return;
          if (body.results) {
            setResults(body.results);
            setActive(0);
          } else {
            setResults([]);
          }
        })
        .catch((err) => {
          if ((err as { name?: string })?.name !== "AbortError") {
            console.error("[palette] search failed", err);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [q, open]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQ("");
      setResults([]);
      setActive(0);
      setLoading(false);
      abortRef.current?.abort();
    }
  }

  function navigate(atomId: string) {
    handleOpenChange(false);
    router.push(`/atoms/${atomId}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const term = q.trim();
      if (results[active]) {
        navigate(results[active].atom_id);
      } else if (term) {
        handleOpenChange(false);
        router.push(`/search?q=${encodeURIComponent(term)}`);
      }
    }
  }

  function onChange(value: string) {
    setQ(value);
    if (value.trim() === "") {
      setResults([]);
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <SearchIcon className="text-muted-foreground size-4 shrink-0" />
          <input
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search atoms…"
            autoFocus
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
          />
          {loading && <span className="text-muted-foreground text-[10px]">Searching…</span>}
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {q.trim() === "" ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-xs">
              Type to search. Enter to open a result. <kbd>Esc</kbd> to close.
            </p>
          ) : results.length === 0 && !loading ? (
            <div className="flex flex-col items-center gap-2 py-6 text-xs">
              <span className="text-muted-foreground">No results.</span>
              <Link
                href={`/search?q=${encodeURIComponent(q.trim())}`}
                onClick={() => handleOpenChange(false)}
                className="text-foreground underline-offset-4 hover:underline"
              >
                Open full search page
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col">
              {results.map((r, i) => {
                const around = snippetAround(r.snippet, q, 180);
                const segs = highlightSegments(around, q);
                return (
                  <li key={r.atom_id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => navigate(r.atom_id)}
                      className={`flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left transition-colors ${
                        active === i ? "bg-muted" : ""
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">
                          {r.title || "Untitled"}
                        </span>
                        {r.chapter_name && (
                          <span className="bg-muted-foreground/10 text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]">
                            {r.chapter_name}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground line-clamp-2 text-xs">
                        {segs.map((s, j) =>
                          s.match ? (
                            <mark
                              key={j}
                              className="text-foreground bg-yellow-200/60 dark:bg-yellow-500/30"
                            >
                              {s.text}
                            </mark>
                          ) : (
                            <span key={j}>{s.text}</span>
                          ),
                        )}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
