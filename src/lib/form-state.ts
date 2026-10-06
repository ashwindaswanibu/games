import type { z } from "zod";

/** What a `useActionState` form action returns when it doesn't redirect. */
export interface FormState {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  /** Echo of non-secret inputs so the form keeps them after a failed submit. */
  values?: Record<string, string>;
}

/** The first message per field, keyed by the field's name. */
export function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

/** A form field as a string ("" when missing or a file). */
export function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
