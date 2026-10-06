import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { clientIpFrom, rateLimitNetwork } = await import("./client-ip");

describe("clientIpFrom", () => {
  it("reads the platform's client IP headers", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIpFrom(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("ignores missing and malformed values", () => {
    expect(clientIpFrom(new Headers())).toBeNull();
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "x".repeat(500) }))).toBeNull();
    expect(clientIpFrom(new Headers({ "x-real-ip": "999.1.1.1" }))).toBeNull();
  });
});

describe("rateLimitNetwork", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(rateLimitNetwork("203.0.113.7")).toBe("203.0.113.7");
  });

  it("counts every address in an IPv6 /64 together", () => {
    const network = "2001:db8:85a3:42::/64";
    expect(rateLimitNetwork("2001:db8:85a3:42::1")).toBe(network);
    expect(rateLimitNetwork("2001:0DB8:85A3:0042:ffff:1:2:3")).toBe(network);
    expect(rateLimitNetwork("2001:db8:85a3:43::1")).not.toBe(network);
    expect(rateLimitNetwork("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitNetwork("fe80::")).toBe("fe80:0:0:0::/64");
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(rateLimitNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitNetwork("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("puts unknown callers in one bucket", () => {
    expect(rateLimitNetwork(null)).toBe("unknown");
  });
});
