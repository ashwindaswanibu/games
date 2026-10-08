import Link from "next/link";
import { memo, type CSSProperties } from "react";
import type { HomeViewer } from "@/core/home-view";
import styles from "./chrome.module.css";

const MAX_TICKS = 12;

/** One vermilion bar per day of the streak, rising; at risk, today's bar is hollow. */
export function StreakTicks({ streak }: { streak: HomeViewer["streak"] }) {
  if (streak.current <= 0) return null;
  const filled = Math.min(streak.current, streak.atRisk ? MAX_TICKS - 1 : MAX_TICKS);
  const n = filled + (streak.atRisk ? 1 : 0);
  return (
    <span className={styles.ticks} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-open={streak.atRisk && i === n - 1 ? "" : undefined} style={{ height: `${n > 1 ? 6 + (10 * i) / (n - 1) : 16}px` } as CSSProperties} />
      ))}
    </span>
  );
}

export function navItems(viewer: HomeViewer): { href: string; label: string; current: boolean }[] {
  return [
    { href: "/", label: "Today", current: true },
    { href: "/leaderboard", label: "Leaderboard", current: false },
    { href: `/u/${viewer.username}`, label: "Me", current: false },
    ...(viewer.isAdmin ? [{ href: "/admin", label: "Admin", current: false }] : []),
  ];
}

/**
 * The laptop chrome (§5.1): the viewer, the streak, the nav, the Replay cue mark. On a phone the
 * nav moves to the torn tab bar and the strip keeps the name, the streak and Replay. With reduced
 * motion there is no opening, so no Replay (`onReplay` null).
 */
export const Strip = memo(function Strip({ viewer, onReplay }: { viewer: HomeViewer; onReplay: (() => void) | null }) {
  const { streak } = viewer;
  return (
    <header className={styles.strip} data-op="chrome">
      <div className={styles.who}>
        <span className={styles.name} title={viewer.firstName}>
          {viewer.firstName}
        </span>
        <StreakTicks streak={streak} />
        {streak.current > 0 && (
          <span className={styles.streak}>
            <span className={styles.long}>
              <b>{streak.current}</b>-day streak
              {streak.atRisk && <span className={styles.risk}> · play today to keep it</span>}
            </span>
            <span className={styles.short}>
              <b>{streak.current}</b> {streak.current === 1 ? "day" : "days"}
            </span>
          </span>
        )}
      </div>
      <nav className={styles.nav} aria-label="Main">
        {navItems(viewer).map((item) => (
          <Link key={item.href} href={item.href} prefetch={true} aria-current={item.current ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
      {onReplay && (
        <button type="button" className={styles.replay} aria-label="Replay the opening titles" onClick={onReplay}>
          <svg viewBox="0 0 30 30" aria-hidden="true" focusable="false">
            <circle cx="15" cy="15" r="13.2" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
            <circle cx="15" cy="15" r="4.6" fill="var(--verm)" />
          </svg>
        </button>
      )}
    </header>
  );
});
