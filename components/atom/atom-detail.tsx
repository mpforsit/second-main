import Link from "next/link";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
  id: string;
  content: string;
  capture_comment: string | null;
  captured_at: string;
  source_type: "paste" | "url" | "upload" | "voice" | "connector";
  source_url: string | null;
  source_title: string | null;
  chapter: { id: string; name: string } | null;
}

const SOURCE_LABEL: Record<Props["source_type"], string> = {
  paste: "Pasted text",
  url: "Web article",
  upload: "PDF",
  voice: "Voice memo",
  connector: "Connector",
};

export function AtomDetail(props: Props) {
  const title = deriveTitle(props);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-8">
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link href={props.chapter ? `/chapters/${props.chapter.id}` : "/chapters"}>
          <ArrowLeftIcon className="size-4" />
          {props.chapter ? props.chapter.name : "Chapters"}
        </Link>
      </Button>

      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          <span>{SOURCE_LABEL[props.source_type]}</span>
          {props.source_url && (
            <a
              href={props.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              View original <ExternalLinkIcon className="size-3" />
            </a>
          )}
          <span>·</span>
          <span title={props.captured_at}>{formatDate(props.captured_at)}</span>
          {props.chapter && (
            <>
              <span>·</span>
              <Link
                href={`/chapters/${props.chapter.id}`}
                className="hover:text-foreground underline-offset-4 hover:underline"
              >
                {props.chapter.name}
              </Link>
            </>
          )}
        </div>
      </header>

      <article className="font-serif text-base leading-7 whitespace-pre-wrap">
        {props.content}
      </article>

      {props.capture_comment && (
        <section className="border-border flex flex-col gap-2 rounded-md border p-4">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Capture note
          </h2>
          <p className="text-sm whitespace-pre-wrap">{props.capture_comment}</p>
        </section>
      )}

      <section className="text-muted-foreground rounded-md border border-dashed p-4 text-xs">
        Comments, intents, and related atoms land in upcoming steps (9 and 12).
      </section>
    </main>
  );
}

function deriveTitle({ source_title, content }: Pick<Props, "source_title" | "content">) {
  if (source_title) return source_title;
  const first = content.split(/\n+/).find((l) => l.trim().length > 0) ?? "Untitled";
  return first.length > 140 ? first.slice(0, 140) + "…" : first;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
