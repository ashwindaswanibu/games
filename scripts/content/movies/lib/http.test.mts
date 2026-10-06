import { describe, expect, it } from "vitest";
import { backoffDelay, chunk, fetchWithRetry, HttpError, mapPool, parseRetryAfter, redact, USER_AGENT } from "./http.mjs";

function fakeFetch(responses: Array<Response | Error>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

const quiet = { log: () => {}, sleep: async () => {}, random: () => 0.5 };

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("12")).toBe(12_000);
    expect(parseRetryAfter("Tue, 06 Oct 2026 12:00:10 GMT", Date.parse("2026-10-06T12:00:00Z"))).toBe(10_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("backoffDelay", () => {
  it("doubles per retry, jitters ±25% and caps", () => {
    expect(backoffDelay(1, 1000, 60_000, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, 1000, 60_000, () => 0.5)).toBe(4000);
    expect(backoffDelay(3, 1000, 60_000, () => 0)).toBe(3000);
    expect(backoffDelay(3, 1000, 60_000, () => 1)).toBe(5000);
    expect(backoffDelay(20, 1000, 60_000, () => 0.5)).toBe(60_000);
  });
});

describe("fetchWithRetry", () => {
  it("retries transient statuses and network errors, then succeeds", async () => {
    const waits: number[] = [];
    const { impl, calls } = fakeFetch([new Response("busy", { status: 503 }), new TypeError("fetch failed"), new Response("ok")]);
    const response = await fetchWithRetry("https://example.test/x", {}, { ...quiet, fetchImpl: impl, sleep: async (ms) => void waits.push(ms) });
    expect(await response.text()).toBe("ok");
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it("honours Retry-After on 429", async () => {
    const waits: number[] = [];
    const { impl } = fakeFetch([new Response("slow down", { status: 429, headers: { "retry-after": "7" } }), new Response("ok")]);
    await fetchWithRetry("https://example.test/x", {}, { ...quiet, fetchImpl: impl, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([7000]);
  });

  it("fails immediately on a client error, with the body", async () => {
    const { impl, calls } = fakeFetch([new Response("bad query", { status: 400 })]);
    await expect(fetchWithRetry("https://example.test/x", {}, { ...quiet, fetchImpl: impl })).rejects.toThrow(/HTTP 400 .*bad query/);
    expect(calls).toHaveLength(1);
  });

  it("gives up after the last attempt", async () => {
    const { impl, calls } = fakeFetch([new Response("", { status: 502 }), new Response("", { status: 502 }), new Response("", { status: 502 })]);
    const error = await fetchWithRetry("https://example.test/x", {}, { ...quiet, attempts: 3, fetchImpl: impl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(502);
    expect(calls).toHaveLength(3);
  });

  it("sends a descriptive User-Agent unless one is given", async () => {
    const { impl, calls } = fakeFetch([new Response("ok"), new Response("ok")]);
    await fetchWithRetry("https://example.test/x", {}, { ...quiet, fetchImpl: impl });
    await fetchWithRetry("https://example.test/x", { headers: { "user-agent": "custom" } }, { ...quiet, fetchImpl: impl });
    expect(new Headers(calls[0]!.init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(new Headers(calls[1]!.init.headers).get("user-agent")).toBe("custom");
    expect(USER_AGENT).not.toMatch(/@/);
  });
});

describe("helpers", () => {
  it("redacts keys in URLs", () => {
    expect(redact("https://api.test/3/movie/1?api_key=secret&x=1")).toBe("https://api.test/3/movie/1?api_key=***&x=1");
  });

  it("chunks and maps with bounded concurrency in order", async () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([5, 1, 3, 2], 2, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBe(2);
  });
});
