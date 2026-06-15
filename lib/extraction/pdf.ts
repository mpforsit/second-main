import { PDFParse } from "pdf-parse";

import { getServiceSupabase } from "@/lib/supabase/service";

export interface ExtractedPdf {
  title: string | null;
  author: string | null;
  content: string;
  page_count: number;
}

export async function extractPdfFromStorage(storage_path: string): Promise<ExtractedPdf> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.storage.from("uploads").download(storage_path);
  if (error || !data) {
    throw new Error(`Storage download failed: ${error?.message ?? "no body"}`);
  }
  const bytes = new Uint8Array(await data.arrayBuffer());

  const parser = new PDFParse({ data: bytes });
  try {
    const text = await parser.getText();
    const info = await parser.getInfo();
    const meta = (info.info ?? {}) as { Title?: string; Author?: string };
    return {
      title: meta.Title?.trim() || null,
      author: meta.Author?.trim() || null,
      content: text.text.trim(),
      page_count: text.total ?? text.pages.length ?? 0,
    };
  } finally {
    await parser.destroy();
  }
}
