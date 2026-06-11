import { RightRail } from "@/components/shared/right-rail";

export default function WithRailLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="flex flex-1 flex-col">{children}</div>
      <RightRail />
    </>
  );
}
