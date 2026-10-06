import "server-only";
import { z } from "zod";

/** Server-only secrets, validated on first use so a misconfigured deploy fails loudly. */
const schema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  /** Salts the daily puzzle seed so future puzzles can't be computed from the source code. */
  PUZZLE_SEED_SECRET: z.string().min(32),
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
