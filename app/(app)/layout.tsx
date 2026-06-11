import { redirect } from "next/navigation";

import { Sidebar } from "@/components/shared/sidebar";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  // The right rail is mounted by app/(app)/(with-rail)/layout.tsx so pages
  // like /atoms/[id] can opt out by living under app/(app)/ directly.
  return (
    <div className="flex min-h-svh flex-1">
      <Sidebar />
      {children}
    </div>
  );
}
