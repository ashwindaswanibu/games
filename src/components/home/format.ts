import type { HomeDay } from "@/core/home-view";

/** "End of Wednesday, October 7" (the FIN card sets it in mono caps). */
export function formatEndOf(day: Pick<HomeDay, "weekday" | "month" | "dayOfMonth">): string {
  return `End of ${day.weekday}, ${day.month} ${day.dayOfMonth}`;
}
