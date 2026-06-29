// Source of truth: docs/05-llm-operations.md §5.4.4.

import type { UserModel } from "@/types/schemas";

export const QA_PROMPT_VERSION = 1;

export const QA_SYSTEM_PROMPT = `You answer questions using only the user's own captured knowledge base.

You will receive:
1. The user model (their projects, people, vocabulary).
2. A set of retrieved atoms, each prefixed with its UUID and source.
3. The user's question.

Your job:
- Answer the question concisely and accurately using only information from the retrieved atoms.
- Cite every factual claim by appending [atom:<UUID>] inline. Cite multiple atoms with [atom:UUID1][atom:UUID2] if a claim is supported by several.
- If the retrieved atoms don't contain the answer, say so honestly. Suggest what the user could capture or where else to look.
- Do not invent facts. Do not bring outside knowledge except common-sense framing.
- Match the user's tone: brisk, direct, no fluff.
- Maximum 250 words unless the question explicitly needs more.`;

export interface QaAtom {
  atom_id: string;
  source_type: "paste" | "url" | "upload" | "voice" | "connector";
  source_label: string; // URL, PDF name, or "paste"
  captured_at: string;
  capture_comment: string | null;
  chunk_text: string;
}

export function serializeUserModel(m: UserModel): string {
  const parts: string[] = [];
  if (m.projects?.length) {
    parts.push("Projects:");
    for (const p of m.projects) {
      parts.push(`- ${p.name}${p.description ? `: ${p.description}` : ""}`);
    }
  }
  if (m.people?.length) {
    parts.push("Key people:");
    for (const p of m.people) {
      parts.push(`- ${p.name}${p.role ? ` (${p.role})` : ""}${p.context ? `: ${p.context}` : ""}`);
    }
  }
  if (m.vocabulary?.length) {
    parts.push("Vocabulary:");
    for (const v of m.vocabulary) {
      parts.push(`- ${v.term}: ${v.meaning}`);
    }
  }
  return parts.join("\n") || "(empty)";
}

export function renderQaUserPrompt(
  question: string,
  userModel: UserModel,
  atoms: QaAtom[],
): string {
  const um = serializeUserModel(userModel);
  const blocks = atoms.map((a) => {
    const lines = [
      `[atom:${a.atom_id}]`,
      `Source: ${a.source_label}`,
      `Captured: ${a.captured_at.slice(0, 10)}`,
    ];
    if (a.capture_comment) lines.push(`Comment: ${a.capture_comment}`);
    lines.push("Content:");
    lines.push(a.chunk_text);
    return lines.join("\n");
  });

  return [
    "<user_model>",
    um,
    "</user_model>",
    "",
    "<retrieved_atoms>",
    blocks.join("\n---\n"),
    "</retrieved_atoms>",
    "",
    `<question>${question.trim()}</question>`,
  ].join("\n");
}
