// Shared zod schemas. Imported by client and server.
// Source of truth: docs/04-api-spec.md §4.1.

import { z } from "zod";

export const IntentActionEnum = z.enum([
  "read",
  "reach_out",
  "use_in",
  "research",
  "review",
  "share",
  "decide",
  "other",
]);
export type IntentAction = z.infer<typeof IntentActionEnum>;

export const CaptureInputSchema = z
  .object({
    text: z.string().min(1).max(50_000).optional(),
    url: z.string().url().optional(),
    uploadStoragePath: z.string().optional(),
    voiceStoragePath: z.string().optional(),

    comment: z.string().max(2000).optional(),
    // action_type is optional here so the user can submit free-form text and
    // have the server fill it in via the intent-parse Haiku call.
    intent: z
      .object({
        text: z.string().min(1).max(500),
        action_type: IntentActionEnum.optional(),
        due_at: z.string().datetime().optional(),
      })
      .optional(),

    chapter_id: z.string().uuid().optional(),
  })
  .refine(
    (d) => [d.text, d.url, d.uploadStoragePath, d.voiceStoragePath].filter(Boolean).length === 1,
    { message: "Exactly one content source must be provided" },
  );
export type CaptureInput = z.infer<typeof CaptureInputSchema>;

export const IntentParseResultSchema = z.object({
  action_type: IntentActionEnum,
  due_at: z.string().datetime().nullable(),
  normalized_text: z.string().min(1).max(500),
});
export type IntentParseResult = z.infer<typeof IntentParseResultSchema>;

export const IntentUpdateSchema = z.object({
  intent_id: z.string().uuid(),
  status: z.enum(["open", "done", "dismissed"]).optional(),
  due_at: z.string().datetime().nullable().optional(),
  text: z.string().min(1).max(500).optional(),
  action_type: IntentActionEnum.optional(),
});
export type IntentUpdate = z.infer<typeof IntentUpdateSchema>;

export const CommentInputSchema = z.object({
  atom_id: z.string().uuid(),
  text: z.string().min(1).max(5000),
  is_private: z.boolean().optional(),
});
export type CommentInput = z.infer<typeof CommentInputSchema>;

export const UserModelSchema = z.object({
  projects: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .default([]),
  people: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string().optional(),
        context: z.string().optional(),
      }),
    )
    .default([]),
  vocabulary: z
    .array(
      z.object({
        term: z.string(),
        meaning: z.string(),
      }),
    )
    .default([]),
  preferences: z.record(z.string(), z.unknown()).default({}),
});

export type UserModel = z.infer<typeof UserModelSchema>;

export const ChapterInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export type ChapterInput = z.infer<typeof ChapterInputSchema>;
