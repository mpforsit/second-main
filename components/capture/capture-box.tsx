"use client";

import { LinkIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { capture } from "@/server-actions/atoms";

// Single-line URL (no whitespace, has scheme). Used to switch the text-mode
// UI into "Fetch article" mode without changing the underlying input.
function isSingleUrl(s: string): URL | null {
  const trimmed = s.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return u;
    return null;
  } catch {
    return null;
  }
}

export function CaptureBox() {
  return (
    <Tabs defaultValue="text">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="text">Text</TabsTrigger>
        <TabsTrigger value="upload">Upload</TabsTrigger>
        <TabsTrigger value="voice" disabled>
          Voice
        </TabsTrigger>
      </TabsList>
      <TabsContent value="text" className="pt-3">
        <TextCapture />
      </TabsContent>
      <TabsContent value="upload" className="pt-3">
        <UploadCapture />
      </TabsContent>
    </Tabs>
  );
}

function TextCapture() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const detectedUrl = isSingleUrl(text);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    const payload = detectedUrl
      ? { url: detectedUrl.toString(), comment: comment.trim() || undefined }
      : { text: text.trim(), comment: comment.trim() || undefined };
    const res = await capture(payload);
    if (!res.ok) {
      toast.error(res.error);
      setSubmitting(false);
      return;
    }
    toast.success(detectedUrl ? "Fetching article…" : "Captured. Processing…");
    setText("");
    setComment("");
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What just came in?"
        rows={5}
        disabled={submitting}
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring resize-y rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50"
      />
      {detectedUrl && (
        <div className="bg-muted/50 border-border text-muted-foreground flex items-start gap-2 rounded-md border p-2 text-xs">
          <LinkIcon className="size-3.5 shrink-0 translate-y-0.5" />
          <span>
            Looks like a URL. We&apos;ll fetch the article when you capture —{" "}
            <span className="text-foreground font-medium">{detectedUrl.hostname}</span>.
          </span>
        </div>
      )}
      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        disabled={submitting}
      />
      <Button type="submit" disabled={!text.trim() || submitting} className="self-end">
        {submitting ? "Capturing…" : detectedUrl ? "Fetch article" : "Capture"}
      </Button>
    </form>
  );
}

function UploadCapture() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!f) return;
    if (f.type !== "application/pdf") {
      toast.error("Only PDF files are supported for now");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("PDF is too large (max 10 MB)");
      return;
    }
    setFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || submitting) return;
    setSubmitting(true);

    try {
      // 1. Get a signed upload URL from our API.
      const signedRes = await fetch("/api/capture/upload-signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "pdf", filename: file.name }),
      });
      const signed = (await signedRes.json()) as
        | { storage_path: string; token: string; bucket: string }
        | { error: string };
      if (!signedRes.ok || "error" in signed) {
        toast.error(("error" in signed && signed.error) || "Failed to get upload URL");
        setSubmitting(false);
        return;
      }

      // 2. Upload the file directly to Supabase Storage.
      const supabase = getBrowserSupabase();
      const upload = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.storage_path, signed.token, file, {
          contentType: file.type,
        });
      if (upload.error) {
        toast.error(`Upload failed: ${upload.error.message}`);
        setSubmitting(false);
        return;
      }

      // 3. Capture with the storage path; the pipeline does the extraction.
      const res = await capture({
        uploadStoragePath: signed.storage_path,
        comment: comment.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        setSubmitting(false);
        return;
      }

      toast.success("Uploaded. Extracting…");
      setFile(null);
      setComment("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`border-border bg-muted/30 hover:bg-muted/50 flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed p-6 text-center text-xs transition-colors ${
          dragOver ? "bg-muted border-foreground/40" : ""
        }`}
      >
        <UploadIcon className="text-muted-foreground size-5" />
        {file ? (
          <span className="text-foreground font-medium">{file.name}</span>
        ) : (
          <>
            <span className="text-foreground font-medium">Drop a PDF here</span>
            <span className="text-muted-foreground">or click to choose (max 10 MB)</span>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="sr-only"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>
      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        disabled={submitting}
      />
      <Button type="submit" disabled={!file || submitting} className="self-end">
        {submitting ? "Uploading…" : "Capture PDF"}
      </Button>
    </form>
  );
}
