import { getServerSupabase } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Welcome to Second</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as <span className="text-foreground font-medium">{user?.email}</span>.
      </p>
      <p className="text-muted-foreground max-w-md text-center text-sm">
        The capture box, chapters, and Q&amp;A land in upcoming steps. For now, this confirms auth +
        the (app) route group are wired up correctly.
      </p>
    </main>
  );
}
