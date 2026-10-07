import Link from "next/link";
import type { CSSProperties } from "react";
import type { HomeViewer } from "@/core/home-view";
import { navItems } from "./strip";
import styles from "./chrome.module.css";

/**
 * The phone chrome (§5.10): a torn strip of ink paper fixed at the foot, in every light. At night
 * its torn edge carries a faint hairline so it separates from the dark room.
 */
export function TabBar({ viewer, tear }: { viewer: HomeViewer; tear: string }) {
  return (
    <nav className={styles.tabBar} aria-label="Main" data-app-chrome="bottom-nav" data-op="chrome" style={{ "--tear": tear } as CSSProperties}>
      <span className={styles.tabEdge} aria-hidden="true" />
      <span className={styles.tabBg} aria-hidden="true" />
      {navItems(viewer).map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.current ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
