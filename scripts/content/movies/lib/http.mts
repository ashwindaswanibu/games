/**
 * HTTP for the content pipeline: per-request timeouts, retries with exponential backoff and jitter
 * on transient failures (network errors, 408/425/429/5xx), and `Retry-After` honoured when a server
 * asks us to slow down. Everything else (4xx) fails immediately with the response body, because
 * retrying a bad request only hides the bug.
 */

/** Descriptive User-Agent, as the Wikimedia and TMDB API policies ask. No personal contact data. */
export const USER_AGENT = "games-movies-content-pipeline/1.0 (private daily-puzzle site; local catalog import)";

export interface RetryOptions {
  /** Attempts in total, including the first. Default 6. */
  attempts?: number;
  /** First backoff delay in ms (doubles each retry, ±25% jitter). Default 1000. */
  baseDelayMs?: number;
  /** Cap for a single wait, including a server's Retry-After. Default 60 s. */
  maxDelayMs?: number;
  /** Per-attempt timeout. Default 90 s (Wikidata's own query limit is 60 s). */
  timeoutMs?: number;
  /** Short name for log lines, e.g. "wikidata sparql". */
  label?: string;
  /** Where retry notices go. Default: stderr. */
  log?: (message: string) => void;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} from ${redact(url)}${body ? `: ${body.slice(0, 300)}` : ""}`);
    this.name = "HttpError";
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Never print API keys that travel in a query string. */
export function redact(url: string): string {
  return url.replace(/([?&](?:api_key|key|token)=)[^&]+/gi, "$1***");
}

/** Seconds or an HTTP date → milliseconds from now; null when absent or unparseable. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Backoff for retry number `retry` (1-based): base · 2^(retry-1), ±25% jitter, capped. */
export function backoffDelay(retry: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const exponential = baseDelayMs * 2 ** (retry - 1);
  const jitter = 1 + (random() * 0.5 - 0.25);
  return Math.min(maxDelayMs, Math.round(exponential * jitter));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `fetch` that retries transient failures. Resolves only with an OK (2xx) response. */
export async function fetchWithRetry(url: string, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  const {
    attempts = 6,
    baseDelayMs = 1000,
    maxDelayMs = 60_000,
    timeoutMs = 90_000,
    label = new URL(url).host,
    log = (message: string) => console.warn(message),
    fetchImpl = fetch,
    sleep = defaultSleep,
    random = Math.random,
  } = options;
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);

  for (let attempt = 1; ; attempt++) {
    let waitMs: number;
    let reason: string;
    try {
      const response = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      const body = await response.text().catch(() => "");
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= attempts) throw new HttpError(response.status, url, body);
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      waitMs = Math.min(maxDelayMs, retryAfter ?? backoffDelay(attempt, baseDelayMs, maxDelayMs, random));
      reason = `HTTP ${response.status}`;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Network failure or timeout.
      if (attempt >= attempts) {
        throw new Error(`${label}: request failed after ${attempts} attempts: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      waitMs = backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
      reason = error instanceof Error ? error.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : error.message : String(error);
    }
    log(`  ${label}: ${reason}; retry ${attempt}/${attempts - 1} in ${(waitMs / 1000).toFixed(1)} s`);
    await sleep(waitMs);
  }
}

/** Runs `worker` over `items` with at most `concurrency` in flight; results keep input order. */
export async function mapPool<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, run));
  return results;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`Invalid chunk size ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
