import { CaptureBox } from "@/components/capture/capture-box";
import { RecentAtoms } from "@/components/shared/recent-atoms";

export function RightRail() {
  return (
    <aside className="bg-card flex h-svh w-80 shrink-0 flex-col gap-6 overflow-y-auto border-l p-4">
      <section>
        <h2 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Capture
        </h2>
        <CaptureBox />
      </section>
      <section>
        <h2 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Recent
        </h2>
        <RecentAtoms />
      </section>
    </aside>
  );
}
