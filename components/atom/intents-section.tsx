"use client";

import { CheckIcon, TrashIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteIntent, updateIntent } from "@/server-actions/intents";
import type { IntentAction } from "@/types/schemas";

type Status = "open" | "done" | "dismissed";

export interface IntentItem {
  id: string;
  text: string;
  action_type: IntentAction;
  due_at: string | null;
  status: Status;
}

const ACTION_LABELS: Record<IntentAction, string> = {
  read: "Read",
  reach_out: "Reach out",
  use_in: "Use in",
  research: "Research",
  review: "Review",
  share: "Share",
  decide: "Decide",
  other: "Other",
};

interface Props {
  intents: IntentItem[];
}

export function IntentsSection({ intents }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Intents</h2>
      {intents.length === 0 ? (
        <p className="text-muted-foreground text-xs">No intents on this atom.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {intents.map((i) => (
            <IntentRow key={i.id} intent={i} />
          ))}
        </ul>
      )}
    </section>
  );
}

function IntentRow({ intent }: { intent: IntentItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setStatus(next: Status) {
    setBusy(true);
    const res = await updateIntent({ intent_id: intent.id, status: next });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    router.refresh();
  }

  async function onDelete() {
    if (!confirm("Delete this intent?")) return;
    setBusy(true);
    const res = await deleteIntent(intent.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    router.refresh();
  }

  const isClosed = intent.status !== "open";

  return (
    <li
      className={`border-border flex items-start justify-between gap-3 rounded-md border p-2 text-sm ${
        isClosed ? "text-muted-foreground line-through" : ""
      }`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="bg-muted text-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
            {ACTION_LABELS[intent.action_type]}
          </span>
          {intent.due_at && (
            <span className="text-muted-foreground text-[10px]">
              due {formatDueDate(intent.due_at)}
            </span>
          )}
          {intent.status !== "open" && (
            <span className="text-muted-foreground text-[10px] uppercase">{intent.status}</span>
          )}
        </div>
        <p className="text-sm">{intent.text}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {intent.status === "open" ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setStatus("done")}
              disabled={busy}
              aria-label="Mark done"
              title="Mark done"
              className="size-7"
            >
              <CheckIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setStatus("dismissed")}
              disabled={busy}
              aria-label="Dismiss"
              title="Dismiss"
              className="size-7"
            >
              <XIcon className="size-3.5" />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setStatus("open")}
            disabled={busy}
            aria-label="Reopen"
            title="Reopen"
            className="size-7"
          >
            <CheckIcon className="size-3.5 rotate-180" />
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete"
          className="size-7"
        >
          <TrashIcon className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
