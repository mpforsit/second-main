import { ThemeToggle } from "@/components/shared/theme-toggle";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full max-w-3xl items-center justify-between">
        <h1 className="text-4xl font-semibold tracking-tight">Second</h1>
        <ThemeToggle />
      </div>
      <p className="text-muted-foreground text-center text-sm">
        Phase 1 bootstrap — Next.js + Tailwind + shadcn/ui + Supabase scaffold.
      </p>
    </main>
  );
}
