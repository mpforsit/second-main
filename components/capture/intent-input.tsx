"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { type IntentAction } from "@/types/schemas";

export interface IntentDraft {
  text: string;
  action_type: IntentAction | null; // null = unparsed, server will auto-fill
  due_at: string | null; // ISO date (YYYY-MM-DD) — converted to ISO datetime on submit
}

export const EMPTY_INTENT: IntentDraft = {
  text: "",
  action_type: null,
  due_at: null,
};

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

const ACTION_ORDER: IntentAction[] = [
  "read",
  "reach_out",
  "use_in",
  "research",
  "review",
  "share",
  "decide",
  "other",
];

interface Props {
  value: IntentDraft;
  onChange: (next: IntentDraft) => void;
  disabled?: boolean;
}

export function IntentInput({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(value.text.length > 0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground self-start text-xs underline-offset-4 hover:underline disabled:opacity-50"
      >
        + Add intent
      </button>
    );
  }

  return (
    <div className="border-border bg-muted/30 flex flex-col gap-2 rounded-md border p-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Intent
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(EMPTY_INTENT);
            setOpen(false);
          }}
          disabled={disabled}
          aria-label="Remove intent"
          className="text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <Input
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder='e.g. "read before Thursday"'
        disabled={disabled}
        className="h-8 text-sm"
      />

      <div className="flex flex-wrap gap-1">
        {ACTION_ORDER.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange({ ...value, action_type: value.action_type === a ? null : a })}
            disabled={disabled}
            className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
              value.action_type === a
                ? "bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted border"
            }`}
          >
            {ACTION_LABELS[a]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-muted-foreground text-[10px]">Due</label>
        <Input
          type="date"
          value={value.due_at ?? ""}
          onChange={(e) => onChange({ ...value, due_at: e.target.value || null })}
          disabled={disabled}
          className="h-7 w-auto text-xs"
        />
      </div>

      {!value.action_type && value.text.length > 0 && (
        <p className="text-muted-foreground text-[10px]">
          No action type chosen — we&apos;ll parse the text for you on capture.
        </p>
      )}
    </div>
  );
}

/**
 * Serialize a draft into the shape CaptureInputSchema expects, or undefined
 * when no field was filled. Picking a pill or a date without typing text
 * still produces a valid intent — we fall back to the action label as the
 * text so the row has something to display.
 */
export function serializeIntent(d: IntentDraft):
  | {
      text: string;
      action_type?: IntentAction;
      due_at?: string;
    }
  | undefined {
  const text = d.text.trim();
  const hasAnySignal = text.length > 0 || d.action_type !== null || d.due_at !== null;
  if (!hasAnySignal) return undefined;

  const fallback = d.action_type ? ACTION_LABELS[d.action_type] : "Note";
  const out: { text: string; action_type?: IntentAction; due_at?: string } = {
    text: text || fallback,
  };
  if (d.action_type) out.action_type = d.action_type;
  if (d.due_at) {
    // Convert YYYY-MM-DD → ISO at end-of-day (so "before Thursday" semantics
    // include all of Thursday).
    const date = new Date(`${d.due_at}T23:59:59Z`);
    if (!Number.isNaN(date.valueOf())) out.due_at = date.toISOString();
  }
  return out;
}
