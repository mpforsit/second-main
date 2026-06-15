import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  content: string; // plain text
  excerpt: string | null;
  url: string; // resolved URL after redirects
}

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (compatible; SecondBot/0.1; +https://second-red.vercel.app)";

export async function extractArticleFromUrl(url: string): Promise<ExtractedArticle> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
    throw new Error(`Not HTML: ${contentType || "unknown content-type"}`);
  }

  const finalUrl = res.url || url;
  const html = await res.text();

  const dom = new JSDOM(html, { url: finalUrl });
  const article = new Readability(dom.window.document).parse();

  if (!article) {
    throw new Error("Readability could not parse the page");
  }

  // article.textContent has the full extracted text, no HTML.
  return {
    title: article.title?.trim() || null,
    byline: article.byline?.trim() || null,
    content: (article.textContent ?? "").trim(),
    excerpt: article.excerpt?.trim() || null,
    url: finalUrl,
  };
}
