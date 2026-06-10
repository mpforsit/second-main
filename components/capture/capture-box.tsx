"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { capture } from "@/server-actions/atoms";

export function CaptureBox() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    const res = await capture({ text: text.trim(), comment: comment.trim() || undefined });
    if (!res.ok) {
      toast.error(res.error);
      setSubmitting(false);
      return;
    }
    toast.success("Captured. Processing…");
    setText("");
    setComment("");
    setSubmitting(false);
    // Nudge the recent-atoms list to refetch immediately rather than waiting
    // for its next poll tick.
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs defaultValue="text">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="text">Text</TabsTrigger>
          <TabsTrigger value="voice" disabled>
            Voice
          </TabsTrigger>
          <TabsTrigger value="upload" disabled>
            Upload
          </TabsTrigger>
        </TabsList>
        <TabsContent value="text" className="flex flex-col gap-3 pt-3">
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What just came in?"
              rows={5}
              disabled={submitting}
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring resize-y rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50"
            />
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment (optional)"
              disabled={submitting}
            />
            <Button type="submit" disabled={!text.trim() || submitting} className="self-end">
              {submitting ? "Capturing…" : "Capture"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
