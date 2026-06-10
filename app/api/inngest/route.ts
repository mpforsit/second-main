import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { processAtom } from "@/inngest/functions/process-atom";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processAtom],
});
