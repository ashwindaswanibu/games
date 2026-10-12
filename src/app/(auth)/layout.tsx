import { connection } from "next/server";
import { DISPLAY_FONT_VARS } from "@/components/display-font";
import { APP_DESCRIPTION, APP_NAME } from "@/config";
import { formatPuzzleDate, today } from "@/core/day";
import styles from "./auth.module.css";

/**
 * Signing in and signing up: the house's dark room, the day along its edge (the site is a daily
 * one), the name set as a title card, and the form in the games' own hand (mono labels, fields
 * written on a line like a guess). Nothing of today's puzzles: anyone can open this page.
 */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  // The date is today's in New York, so this is rendered for each visit.
  await connection();
  const date = formatPuzzleDate(today(), { weekday: "long", day: "numeric", month: "long" }).replace(",", " ·");
  return (
    <div className={`${DISPLAY_FONT_VARS} ${styles.room}`}>
      <div className={styles.edge}>
        <span>{date}</span>
        <span className={styles.edgeNote}>{APP_DESCRIPTION}</span>
      </div>
      <main className={styles.stage}>
        <h1 className={styles.mark}>{APP_NAME}</h1>
        <div className={styles.panel}>{children}</div>
      </main>
    </div>
  );
}
