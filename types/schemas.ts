// Shared zod schemas. Imported by client and server.
// Source of truth: docs/04-api-spec.md §4.1.

import { z } from "zod";

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
