"use client";

import { EditIcon, TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addComment, deleteComment, updateComment } from "@/server-actions/comments";

export interface CommentItem {
  id: string;
  text: string;
  is_private: boolean;
  created_at: string;
  author_id: string;
}

interface Props {
  atomId: string;
  comments: CommentItem[];
  currentUserId: string;
}

export function CommentsSection({ atomId, comments, currentUserId }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Comments
      </h2>
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-xs">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} isMine={c.author_id === currentUserId} />
          ))}
        </ul>
      )}
      <CommentComposer atomId={atomId} />
    </section>
  );
}

function CommentRow({ comment, isMine }: { comment: CommentItem; isMine: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const [busy, setBusy] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || draft === comment.text) {
      setEditing(false);
      setDraft(comment.text);
      return;
    }
    setBusy(true);
    const res = await updateComment({ comment_id: comment.id, text: draft.trim() });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function onDelete() {
    if (!confirm("Delete this comment?")) return;
    setBusy(true);
    const res = await deleteComment(comment.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <li className="border-border flex flex-col gap-1 rounded-md border p-2">
      <div className="text-muted-foreground flex items-center justify-between text-[10px]">
        <span>{formatDate(comment.created_at)}</span>
        {isMine && !editing && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="hover:text-foreground"
              aria-label="Edit"
            >
              <EditIcon className="size-3" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="hover:text-destructive"
              aria-label="Delete"
            >
              <TrashIcon className="size-3" />
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <form onSubmit={onSave} className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="border-input bg-background rounded-md border px-2 py-1 text-sm"
            disabled={busy}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setDraft(comment.text);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{comment.text}</p>
      )}
    </li>
  );
}

function CommentComposer({ atomId }: { atomId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    const res = await addComment({ atom_id: atomId, text: trimmed });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setText("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment…"
        disabled={busy}
      />
      <Button type="submit" size="sm" disabled={busy || !text.trim()} className="self-end">
        {busy ? "Adding…" : "Add comment"}
      </Button>
    </form>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
