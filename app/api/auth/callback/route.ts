import { NextResponse } from "next/server";

import { getServerSupabase } from "@/lib/supabase/server";

// Handles both PKCE OAuth callbacks (Google) and email-confirmation links —
// both deliver `?code=<...>` and `exchangeCodeForSession` resolves either.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${url.origin}/login?error=missing_code`);
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${url.origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${url.origin}${next.startsWith("/") ? next : "/"}`);
}
