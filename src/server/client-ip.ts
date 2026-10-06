import "server-only";
import { headers } from "next/headers";
import { z } from "zod";

const ipSchema = z.union([z.ipv4(), z.ipv6()]);

/**
 * The caller's IP address as the hosting platform reports it, or null. On Vercel, `x-real-ip` and
 * `x-forwarded-for` are set by the platform's edge, which overwrites any value the client sends,
 * so they can be trusted for rate limiting. Behind another proxy, check it does the same.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const candidate = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0];
  const parsed = ipSchema.safeParse(candidate?.trim());
  return parsed.success ? parsed.data : null;
}
