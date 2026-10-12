import Link from "next/link";
import type { ReactNode } from "react";
import { DISPLAY_FONT_VARS } from "@/components/display-font";
import { formatPuzzleDate, type PuzzleDate } from "@/core/day";
import styles from "./app-frame.module.css";

/**
 * The signed-in app's pages (Scores, Me, Admin and the older play screens) in the house's dark room,
 * under the home's own edge: the way back to today, the day, and the nav (`nav`, see `AppNav`). No
 * bottom bar: the home has none, and every page here is one step from it.
 */
export function AppFrame({ date, nav, children }: { date: PuzzleDate; nav: ReactNode; children: ReactNode }) {
  const long = formatPuzzleDate(date, { weekday: "long", month: "long", day: "numeric" }).replace(",", " ·");
  const short = formatPuzzleDate(date).replace(",", " ·");
  return (
    <div className={`${DISPLAY_FONT_VARS} ${styles.room}`}>
      <header className={styles.edge} data-app-chrome="edge">
        <Link href="/" prefetch={true} className={styles.back}>
          <span aria-hidden>‹ </span>Today
        </Link>
        <time dateTime={date}>
          <span className={styles.dateLong}>{long}</span>
          <span className={styles.dateShort}>{short}</span>
        </time>
        {nav}
      </header>
      <main className={styles.column}>{children}</main>
    </div>
  );
}
