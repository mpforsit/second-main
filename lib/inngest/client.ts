import { eventType, Inngest, staticSchema } from "inngest";

export const AtomCreatedEvent = eventType("atom.created", {
  schema: staticSchema<{
    atom_id: string;
    workspace_id: string;
    user_id: string;
  }>(),
});

export const inngest = new Inngest({ id: "second" });
