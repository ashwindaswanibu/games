"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  today: "M4 5h16v15H4zM4 9h16M9 3v4M15 3v4",
  board: "M5 20V10M12 20V4M19 20v-7",
  me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
} as const;

export function BottomNav({ username }: { username: string }) {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Today", icon: ICONS.today, active: pathname === "/" || pathname.startsWith("/play") },
    { href: "/leaderboard", label: "Leaderboard", icon: ICONS.board, active: pathname.startsWith("/leaderboard") },
    { href: `/u/${username}`, label: "Me", icon: ICONS.me, active: pathname.startsWith("/u/") },
  ];

  return (
    <nav data-app-chrome="bottom-nav" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => (
          <li key={item.href} className="flex-1">
            <Link
              href={item.href}
              prefetch={true}
              aria-current={item.active ? "page" : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                item.active ? "text-fg" : "text-muted hover:text-fg"
              }`}
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={item.active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
