/**
 * How well players know a person: how often English Wikipedia readers open their article. Pure
 * helpers for `fame.mts` (the requests are there): reading Wikipedia's page views.
 */

/** Days of page views a measure covers (the most Wikipedia's API gives in one request). */
export const FAME_DAYS = 60;

/** The median of the days that have a count: a burst of news moves it little, a lasting interest does. */
export function medianDailyViews(days: Readonly<Record<string, number | null>> | null | undefined): number {
  const counts = Object.values(days ?? {})
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return 0;
  const mid = counts.length >> 1;
  return Math.round(counts.length % 2 ? counts[mid]! : (counts[mid - 1]! + counts[mid]!) / 2);
}

/**
 * Wikipedia's `prop=pageviews` answer: each asked title's median daily views, following the
 * answer's normalisations ("Riz_Ahmed" → "Riz Ahmed") and redirects. A title with no page is 0.
 */
export function viewsByTitle(
  asked: readonly string[],
  query: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: { title: string; missing?: boolean; pageviews?: Record<string, number | null> }[];
  },
): Map<string, number> {
  const step = (links: { from: string; to: string }[] | undefined) => new Map((links ?? []).map((l) => [l.from, l.to]));
  const normalized = step(query.normalized);
  const redirects = step(query.redirects);
  const pages = new Map((query.pages ?? []).map((page) => [page.title, page.missing ? 0 : medianDailyViews(page.pageviews)]));
  return new Map(
    asked.map((title) => {
      const name = normalized.get(title) ?? title;
      return [title, pages.get(redirects.get(name) ?? name) ?? 0];
    }),
  );
}

type PageviewsQuery = Parameters<typeof viewsByTitle>[1];

/**
 * One answer from the parts Wikipedia sends it in: a request for many titles comes back a few
 * pages' views at a time, with `continue` asking for the rest. A page keeps the part that had its
 * views.
 */
export function mergeQueries(parts: readonly PageviewsQuery[]): PageviewsQuery {
  const pages = new Map<string, NonNullable<PageviewsQuery["pages"]>[number]>();
  for (const part of parts) {
    for (const page of part.pages ?? []) {
      const had = pages.get(page.title);
      const counted = page.pageviews && Object.keys(page.pageviews).length > 0;
      if (!had || counted) pages.set(page.title, counted || !had?.pageviews ? page : had);
    }
  }
  return {
    normalized: parts.flatMap((part) => part.normalized ?? []),
    redirects: parts.flatMap((part) => part.redirects ?? []),
    pages: [...pages.values()],
  };
}
