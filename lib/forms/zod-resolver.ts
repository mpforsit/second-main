import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

// @hookform/resolvers' bundled zod adapter is several minor versions behind
// the latest zod and trips the overload checker. This is the same logic,
// written against the current zod public API.
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }
    const errors: FieldErrors<T> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") as keyof FieldErrors<T>;
      if (!errors[path]) {
        // @ts-expect-error — generic FieldErrors index access
        errors[path] = { type: issue.code, message: issue.message };
      }
    }
    return { values: {}, errors };
  };
}
