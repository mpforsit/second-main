import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. Use only for writes the spec explicitly
// designates as server-only (llm_call_logs inserts, chunks inserts, quota
// increments, etc.). Never expose to user-driven reads — that's what
// getServerSupabase()'s cookie-bound authenticated client is for.
export function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
