import crypto from "node:crypto";

import { z } from "zod";

import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/service";

const RequestSchema = z.object({
  kind: z.enum(["pdf", "voice"]),
  filename: z.string().min(1).max(255).optional(),
});

const BUCKETS = {
  pdf: "uploads",
  voice: "voice",
} as const;

const EXTENSIONS = {
  pdf: "pdf",
  voice: "webm",
} as const;

const SIGNED_URL_TTL_SEC = 60 * 5; // 5 minutes is more than enough for client upload

// docs/04-api-spec.md §4.3 POST /api/capture/upload-signed-url
export async function POST(request: Request) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  }
  const { kind } = parsed.data;

  // Path: {user_id}/{uuid}.{ext}. The atom_id isn't known yet (capture()
  // hasn't run), so we use a fresh uuid as the object name and let
  // capture() pin it via sources.storage_path.
  const ext = EXTENSIONS[kind];
  const objectName = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const bucket = BUCKETS[kind];

  const service = getServiceSupabase();
  const { data, error } = await service.storage
    .from(bucket)
    .createSignedUploadUrl(objectName, { upsert: false });
  if (error || !data) {
    return Response.json(
      { error: `signed_url_failed: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return Response.json({
    storage_path: objectName,
    signed_url: data.signedUrl,
    token: data.token,
    bucket,
    expires_at: new Date(Date.now() + SIGNED_URL_TTL_SEC * 1000).toISOString(),
  });
}
