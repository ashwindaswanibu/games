import "server-only";
import { z } from "zod";

/** Server-only secrets, validated on first use so a misconfigured deploy fails loudly. */
const schema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  /** Salts the daily puzzle seed so future puzzles can't be computed from the source code. */
  PUZZLE_SEED_SECRET: z.string().min(32),
  /**
   * Comma-separated auth user ids of the owner(s). Only an owner may reset another admin's password
   * or remove their admin rights, and nobody can do either to an owner, so a compromised admin
   * account can't lock the owner out. Optional: without it, no one can change other admins in the app.
   */
  OWNER_USER_IDS: z
    .string()
    .optional()
    .transform((value) => (value ?? "").split(",").map((id) => id.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.uuid())),
});

let cached: z.infer<typeof schema> | undefined;

export function serverEnv() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment (${fields}); see .env.example`);
    }
    cached = parsed.data;
  }
  return cached;
}
