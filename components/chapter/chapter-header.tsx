"use client";

import { ArchiveIcon, CheckIcon, EditIcon, MoreHorizontalIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { archiveChapter, renameChapter } from "@/server-actions/chapters";

interface Props {
  id: string;
  name: string;
  description: string | null;
  atomCount: number;
}

export function ChapterHeader({ id, name, description, atomCount }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);

  async function commitRename() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setDraft(name);
      return;
    }
    setSaving(true);
    const res = await renameChapter(id, trimmed);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function onArchive() {
    if (
      !confirm(`Archive "${name}"? It will disappear from the sidebar but stay in the database.`)
    ) {
      return;
    }
    const res = await archiveChapter(id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Archived");
    router.push("/chapters");
    router.refresh();
  }

  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commitRename();
            }}
            className="flex flex-1 items-center gap-2"
          >
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving}
              className="h-9 text-2xl font-semibold"
            />
            <Button type="submit" size="icon" variant="ghost" disabled={saving} aria-label="Save">
              <CheckIcon className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setDraft(name);
              }}
              aria-label="Cancel"
            >
              <XIcon className="size-4" />
            </Button>
          </form>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setEditing(true)}
              aria-label="Rename"
              className="size-8"
            >
              <EditIcon className="size-3.5" />
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {atomCount} {atomCount === 1 ? "atom" : "atoms"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Chapter actions" className="size-8">
                <MoreHorizontalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onArchive}>
                <ArchiveIcon className="size-4" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
    </header>
  );
}
