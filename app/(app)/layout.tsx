import { redirect } from "next/navigation";

import { Sidebar } from "@/components/shared/sidebar";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated users, but if for any reason
  // we land here without a session don't try to query.
  if (user) {
    const { data: userModel } = await supabase
      .from("user_models")
      .select("onboarding_completed_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!userModel?.onboarding_completed_at) {
      redirect("/onboarding");
    }
  }

  return (
    <div className="flex min-h-svh flex-1">
      <Sidebar />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
