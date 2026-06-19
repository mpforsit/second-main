"use client";

import { LinkIcon, MicIcon, SquareIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  EMPTY_INTENT,
  IntentInput,
  serializeIntent,
  type IntentDraft,
} from "@/components/capture/intent-input";
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
        <TabsTrigger value="voice">Voice</TabsTrigger>
      </TabsList>
      <TabsContent value="text" className="pt-3">
        <TextCapture />
      </TabsContent>
      <TabsContent value="upload" className="pt-3">
        <UploadCapture />
      </TabsContent>
      <TabsContent value="voice" className="pt-3">
        <VoiceCapture />
      </TabsContent>
    </Tabs>
  );
}

function TextCapture() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [comment, setComment] = useState("");
  const [intent, setIntent] = useState<IntentDraft>(EMPTY_INTENT);
  const [submitting, setSubmitting] = useState(false);
  const detectedUrl = isSingleUrl(text);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    const base = {
      comment: comment.trim() || undefined,
      intent: serializeIntent(intent),
    };
    const payload = detectedUrl
      ? { ...base, url: detectedUrl.toString() }
      : { ...base, text: text.trim() };
    const res = await capture(payload);
    if (!res.ok) {
      toast.error(res.error);
      setSubmitting(false);
      return;
    }
    toast.success(detectedUrl ? "Fetching article…" : "Captured. Processing…");
    setText("");
    setComment("");
    setIntent(EMPTY_INTENT);
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
      <IntentInput value={intent} onChange={setIntent} disabled={submitting} />
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
  const [intent, setIntent] = useState<IntentDraft>(EMPTY_INTENT);
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
        intent: serializeIntent(intent),
      });
      if (!res.ok) {
        toast.error(res.error);
        setSubmitting(false);
        return;
      }

      toast.success("Uploaded. Extracting…");
      setFile(null);
      setComment("");
      setIntent(EMPTY_INTENT);
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
      <IntentInput value={intent} onChange={setIntent} disabled={submitting} />
      <Button type="submit" disabled={!file || submitting} className="self-end">
        {submitting ? "Uploading…" : "Capture PDF"}
      </Button>
    </form>
  );
}

function pickAudioMime(): string {
  // Prefer audio/webm (Chrome, Firefox, Edge). Safari only offers audio/mp4.
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

function extForMime(mime: string): "webm" | "mp4" {
  if (mime.startsWith("audio/mp4")) return "mp4";
  return "webm";
}

function VoiceCapture() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "recording" | "recorded" | "submitting">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<{ data: Blob; url: string; ext: "webm" | "mp4" } | null>(null);
  const [comment, setComment] = useState("");
  const [intent, setIntent] = useState<IntentDraft>(EMPTY_INTENT);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      // Clean up any leftover stream when the component unmounts.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (blob?.url) URL.revokeObjectURL(blob.url);
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Microphone is not available in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickAudioMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const actualMime = rec.mimeType || mime || "audio/webm";
        const ext = extForMime(actualMime);
        const data = new Blob(chunksRef.current, { type: actualMime });
        const url = URL.createObjectURL(data);
        if (blob?.url) URL.revokeObjectURL(blob.url);
        setBlob({ data, url, ext });
        setState("recorded");
        // Release the mic.
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      setElapsed(0);
      const start = performance.now();
      tickRef.current = window.setInterval(() => {
        setElapsed(Math.floor((performance.now() - start) / 1000));
      }, 250);

      rec.start();
      setState("recording");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start recording");
    }
  }

  function stopRecording() {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    recorderRef.current?.stop();
  }

  function discard() {
    if (blob?.url) URL.revokeObjectURL(blob.url);
    setBlob(null);
    setComment("");
    setIntent(EMPTY_INTENT);
    setElapsed(0);
    setState("idle");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!blob) return;
    setState("submitting");
    try {
      const signedRes = await fetch("/api/capture/upload-signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "voice" }),
      });
      const signed = (await signedRes.json()) as
        | { storage_path: string; token: string; bucket: string }
        | { error: string };
      if (!signedRes.ok || "error" in signed) {
        toast.error(("error" in signed && signed.error) || "Failed to get upload URL");
        setState("recorded");
        return;
      }

      const supabase = getBrowserSupabase();
      const upload = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.storage_path, signed.token, blob.data, {
          contentType: blob.data.type || "audio/webm",
        });
      if (upload.error) {
        toast.error(`Upload failed: ${upload.error.message}`);
        setState("recorded");
        return;
      }

      const res = await capture({
        voiceStoragePath: signed.storage_path,
        comment: comment.trim() || undefined,
        intent: serializeIntent(intent),
      });
      if (!res.ok) {
        toast.error(res.error);
        setState("recorded");
        return;
      }

      toast.success("Uploaded. Transcribing…");
      discard();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
      setState("recorded");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="border-border bg-muted/30 flex flex-col items-center gap-2 rounded-md border p-4 text-center">
        {state === "idle" && (
          <Button type="button" onClick={startRecording} variant="default">
            <MicIcon className="size-4" />
            Record
          </Button>
        )}
        {state === "recording" && (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-block size-2 animate-pulse rounded-full bg-red-500" />
              Recording — {formatDuration(elapsed)}
            </div>
            <Button type="button" onClick={stopRecording} variant="outline">
              <SquareIcon className="size-3.5" />
              Stop
            </Button>
          </>
        )}
        {state === "recorded" && blob && (
          <div className="flex w-full flex-col gap-2">
            <audio controls preload="metadata" src={blob.url} className="w-full" />
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={discard} variant="ghost" size="sm">
                Discard
              </Button>
            </div>
          </div>
        )}
        {state === "submitting" && <p className="text-muted-foreground text-xs">Uploading…</p>}
      </div>

      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        disabled={state === "submitting"}
      />
      <IntentInput value={intent} onChange={setIntent} disabled={state === "submitting"} />
      <Button type="submit" disabled={!blob || state === "submitting"} className="self-end">
        {state === "submitting" ? "Uploading…" : "Capture voice"}
      </Button>
    </form>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
