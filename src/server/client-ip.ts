import "server-only";
import { headers } from "next/headers";
import { z } from "zod";

const ipv4Schema = z.ipv4();
const ipv6Schema = z.ipv6();

/**
 * The caller's IP address from request headers, or null. On Vercel, `x-real-ip` and
 * `x-forwarded-for` are set by the platform's edge, which overwrites any value the client sends,
 * so they can be trusted for rate limiting. Behind another proxy, check it does the same.
 */
export function clientIpFrom(h: Pick<Headers, "get">): string | null {
  const candidate = (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0])?.trim();
  if (!candidate) return null;
  return ipv4Schema.safeParse(candidate).success || ipv6Schema.safeParse(candidate).success ? candidate : null;
}

/** The eight 16-bit groups of a valid IPv6 address (`::` expanded, a trailing dotted IPv4 folded in). */
function ipv6Groups(ip: string): number[] {
  let text = ip.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.map((group) => parseInt(group, 16));
}

/**
 * What a per-client rate limit counts against: an IPv4 address as is, but an IPv6 address by its
 * /64 network, since one subscriber is usually handed a whole /64 and could otherwise rotate
 * through billions of addresses. An IPv4 address written as IPv6 (`::ffff:203.0.113.7`) counts as
 * the IPv4 address. Unknown callers share one key.
 */
export function rateLimitNetwork(ip: string | null): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const groups = ipv6Groups(ip);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** The rate-limit key for the current request's client (see `rateLimitNetwork`). */
export async function clientNetwork(): Promise<string> {
  return rateLimitNetwork(clientIpFrom(await headers()));
}
