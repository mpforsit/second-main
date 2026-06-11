import Link from "next/link";

interface Props {
  id: string;
  content: string;
  source_type: "paste" | "url" | "upload" | "voice" | "connector";
  source_title: string | null;
  capture_comment: string | null;
  chapter_name: string | null;
  captured_at: string;
}

const SOURCE_ICON: Record<Props["source_type"], string> = {
  paste: "📝",
  url: "🔗",
  upload: "📄",
  voice: "🎙️",
  connector: "🔌",
};

export function AtomCard(props: Props) {
  const title = deriveTitle(props);
  const snippet = oneLineSnippet(props.content, title);

  return (
    <Link
      href={`/atoms/${props.id}`}
      className="border-border hover:bg-muted/40 flex flex-col gap-1.5 rounded-md border p-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-base leading-none">
            {SOURCE_ICON[props.source_type]}
          </span>
          <p className="truncate text-sm font-medium">{title || "Untitled"}</p>
        </div>
        <span className="text-muted-foreground shrink-0 text-xs">
          {relativeTime(props.captured_at)}
        </span>
      </div>
      {snippet && <p className="text-muted-foreground line-clamp-2 text-xs">{snippet}</p>}
      <div className="flex items-center gap-2">
        {props.chapter_name && (
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
            {props.chapter_name}
          </span>
        )}
        {props.capture_comment && (
          <span className="text-muted-foreground text-[10px]" title={props.capture_comment}>
            💬 has note
          </span>
        )}
      </div>
    </Link>
  );
}

function deriveTitle({
  source_title,
  source_type,
  content,
}: Pick<Props, "source_title" | "source_type" | "content">) {
  if (source_title) return source_title;
  // For pasted text and transcripts the first non-empty line is the de-facto title.
  void source_type;
  const first = content.split(/\n+/).find((l) => l.trim().length > 0) ?? "";
  return first.length > 100 ? first.slice(0, 100) + "…" : first;
}

function oneLineSnippet(content: string, title: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  // If the title is the first line, snippet starts after it.
  const rest = flat.startsWith(title) ? flat.slice(title.length).trim() : flat;
  if (!rest) return "";
  return rest.length > 200 ? rest.slice(0, 200) + "…" : rest;
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
