"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase/browser";

interface RecentAtom {
  id: string;
  content: string;
  status: "processing" | "ready" | "failed";
  created_at: string;
  primary_chapter_id: string | null;
  chapter_name: string | null;
}

// Fixed 3-second polling — atom processing usually completes in 5–15s so the
// poll cost is bounded and the UX feels live. Realtime broadcasts can replace
// this later (deferred per Step 5 build plan).
const POLL_MS = 3000;

export function RecentAtoms() {
  const [atoms, setAtoms] = useState<RecentAtom[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getBrowserSupabase();

    async function fetchOnce() {
      const { data, error } = await supabase
        .from("atoms")
        .select(
          "id, content, status, created_at, primary_chapter_id, chapters!primary_chapter_id(name)",
        )
        .order("created_at", { ascending: false })
        .limit(8);
      if (cancelled) return;
      if (error) {
        console.error("[RecentAtoms] fetch failed", error);
        return;
      }
      setAtoms(
        (data ?? []).map((row) => ({
          id: row.id,
          content: row.content,
          status: row.status,
          created_at: row.created_at,
          primary_chapter_id: row.primary_chapter_id,
          chapter_name: Array.isArray(row.chapters) ? (row.chapters[0]?.name ?? null) : null,
        })),
      );
    }

    void fetchOnce();
    const tick = setInterval(() => void fetchOnce(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, []);

  if (atoms === null) {
    return <p className="text-muted-foreground text-xs">Loading…</p>;
  }

  if (atoms.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        Nothing yet. Paste something into the box above.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {atoms.map((a) => (
        <li key={a.id}>
          <Link
            href={`/atoms/${a.id}`}
            className="border-border hover:bg-muted/40 flex flex-col gap-1 rounded-md border p-2 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <StatusPill status={a.status} />
              <span className="text-muted-foreground text-[10px]">
                {relativeTime(a.created_at)}
              </span>
            </div>
            <p className="line-clamp-2 text-xs">
              {firstLine(a.content) || (
                <span className="text-muted-foreground italic">
                  {a.status === "failed" ? "(extraction failed)" : "(no content yet)"}
                </span>
              )}
            </p>
            {a.chapter_name && (
              <span className="text-muted-foreground text-[10px]">→ {a.chapter_name}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: RecentAtom["status"] }) {
  const label = status === "processing" ? "Processing…" : status === "ready" ? "Ready" : "Failed";
  const className =
    status === "processing"
      ? "bg-muted text-muted-foreground"
      : status === "ready"
        ? "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200"
        : "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${className}`}>{label}</span>
  );
}

function firstLine(content: string): string {
  const first = content.split(/\n+/)[0]?.trim() ?? "";
  return first.length > 140 ? first.slice(0, 140) + "…" : first;
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
