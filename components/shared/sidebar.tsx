import { LogOutIcon, SearchIcon } from "lucide-react";
import Link from "next/link";

import { NewChapterDialog } from "@/components/chapter/new-chapter-dialog";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { getServerSupabase } from "@/lib/supabase/server";
import { signOut } from "@/server-actions/auth";

export async function Sidebar() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS scopes this to the user's workspaces; we don't need a workspace_id filter.
  const { data: chapters } = await supabase
    .from("chapters")
    .select("id, name")
    .is("archived_at", null)
    .order("sort_order");

  return (
    <aside className="bg-card flex h-svh w-60 shrink-0 flex-col border-r p-4">
      <Link href="/" className="text-base font-semibold tracking-tight">
        Second
      </Link>

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        <Link
          href="/search"
          className="hover:bg-muted text-muted-foreground flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
        >
          <span className="flex items-center gap-2">
            <SearchIcon className="size-3.5" />
            Search
          </span>
          <kbd className="bg-muted-foreground/10 rounded px-1 py-0.5 text-[10px]">⌘K</kbd>
        </Link>

        <section>
          <div className="text-muted-foreground mb-1 flex items-center justify-between px-2">
            <Link
              href="/chapters"
              className="text-xs font-medium tracking-wide uppercase hover:underline"
            >
              Chapters
            </Link>
            <NewChapterDialog />
          </div>
          <ul className="flex flex-col">
            {(chapters ?? []).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chapters/${c.id}`}
                  className="hover:bg-muted block truncate rounded-md px-2 py-1.5 text-sm"
                  title={c.name}
                >
                  {c.name}
                </Link>
              </li>
            ))}
            {chapters?.length === 0 && (
              <li className="text-muted-foreground px-2 py-1 text-xs">No chapters yet.</li>
            )}
          </ul>
        </section>

        <section>
          <p className="text-muted-foreground/70 px-2 text-xs tracking-wide uppercase">
            Coming soon
          </p>
          <ul className="text-muted-foreground flex flex-col text-sm">
            <li className="px-2 py-1.5">Ask</li>
            <li className="px-2 py-1.5">User model</li>
            <li className="px-2 py-1.5">Settings</li>
          </ul>
        </section>
      </div>

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
