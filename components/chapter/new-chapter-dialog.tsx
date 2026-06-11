"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { zodResolver } from "@/lib/forms/zod-resolver";
import { createChapter } from "@/server-actions/chapters";

const schema = z.object({
  name: z.string().min(1, "Required").max(100),
  description: z.string().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

export function NewChapterDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    const res = await createChapter(values);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Chapter created");
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="New chapter">
          <PlusIcon className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New chapter</DialogTitle>
          <DialogDescription>
            Chapters group related atoms. Name them after a project, a topic, or a recurring theme.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="name"
              autoFocus
              {...register("name")}
              aria-invalid={!!errors.name}
              placeholder="e.g. Investor outreach"
            />
            {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="description" className="text-sm font-medium">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input id="description" {...register("description")} />
            {errors.description && (
              <p className="text-destructive text-xs">{errors.description.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
