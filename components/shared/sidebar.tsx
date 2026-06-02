import { LogOutIcon } from "lucide-react";

import { signOut } from "@/server-actions/auth";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { getServerSupabase } from "@/lib/supabase/server";

export async function Sidebar() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <aside className="bg-card flex h-svh w-56 shrink-0 flex-col border-r p-4">
      <div className="text-base font-semibold tracking-tight">Second</div>

      <nav className="text-muted-foreground mt-6 flex flex-1 flex-col gap-1 text-sm">
        {/* Real nav lands in Step 6 (chapters/search/ask/etc.). */}
        <span className="text-muted-foreground/70 px-2 py-1 text-xs tracking-wide uppercase">
          Coming in Step 6
        </span>
        <span className="px-2 py-1.5">Chapters</span>
        <span className="px-2 py-1.5">Ask</span>
        <span className="px-2 py-1.5">Search</span>
        <span className="px-2 py-1.5">User model</span>
      </nav>

      <div className="flex flex-col gap-2">
        {user?.email && (
          <p className="text-muted-foreground truncate px-2 text-xs" title={user.email}>
            {user.email}
          </p>
        )}
        <div className="flex items-center gap-2">
          <form action={signOut} className="flex-1">
            <Button type="submit" variant="outline" size="sm" className="w-full justify-start">
              <LogOutIcon className="size-4" />
              Sign out
            </Button>
          </form>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
