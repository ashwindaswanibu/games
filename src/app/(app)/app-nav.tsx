"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./app-frame.module.css";

/** The pages the frame's nav lists. */
export type FramePage = "scores" | "me" | "admin";

/** Which of the nav's pages `pathname` is: Me is the viewer's own profile only, not a friend's. */
function framePage(pathname: string, username: string): FramePage | null {
  if (pathname === "/leaderboard") return "scores";
  if (pathname === "/admin") return "admin";
  // Usernames are letters, digits and underscores, so the path needs no decoding.
  if (pathname.toLowerCase() === `/u/${username}`) return "me";
  return null;
}

/** The frame's nav, the home's three words: the page you're on in ink, the others dim. */
export function FrameNav({ username, isAdmin, current }: { username: string; isAdmin: boolean; current: FramePage | null }) {
  const pages: { page: FramePage; href: string; label: string }[] = [
    { page: "scores", href: "/leaderboard", label: "Scores" },
    { page: "me", href: `/u/${username}`, label: "Me" },
    ...(isAdmin ? [{ page: "admin" as const, href: "/admin", label: "Admin" }] : []),
  ];
  return (
    <nav aria-label="Pages" data-app-chrome="app-nav" className={styles.nav}>
      {pages.map(({ page, href, label }) => (
        <Link key={page} href={href} prefetch={true} aria-current={page === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** `FrameNav` for the page being shown. */
export function AppNav({ username, isAdmin }: { username: string; isAdmin: boolean }) {
  const pathname = usePathname();
  return <FrameNav username={username} isAdmin={isAdmin} current={framePage(pathname, username)} />;
}
