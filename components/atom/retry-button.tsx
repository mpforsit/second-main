"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { retryAtom } from "@/server-actions/atoms";

export function RetryButton({ atomId }: { atomId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const res = await retryAtom(atomId);
    if (!res.ok) {
      toast.error(res.error);
      setPending(false);
      return;
    }
    toast.success("Retrying…");
    setPending(false);
    router.refresh();
  }

  return (
    <Button onClick={onClick} disabled={pending} size="sm" variant="outline" className="self-start">
      <RefreshCwIcon className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Retrying…" : "Retry"}
    </Button>
  );
}
