import { redirect } from "next/navigation";

import { OnboardingChat } from "@/components/onboarding/onboarding-chat";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: userModel } = await supabase
    .from("user_models")
    .select("onboarding_completed_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (userModel?.onboarding_completed_at) {
    redirect("/");
  }

  return <OnboardingChat />;
}
