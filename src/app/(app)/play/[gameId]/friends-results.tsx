import { Avatar, Card, SectionTitle } from "@/components/ui";
import type { FriendResult } from "@/server/plays";

export function FriendsResults({ results, viewerId }: { results: FriendResult[]; viewerId: string }) {
  return (
    <section>
      <SectionTitle>How everyone did</SectionTitle>
      <Card className="divide-y divide-border overflow-hidden">
        {results.map((r) => {
          const done = r.status === "won" || r.status === "lost";
          return (
            <div key={r.profile.id} className={`flex items-center gap-3 px-4 py-3 ${r.profile.id === viewerId ? "bg-accent/8" : ""}`}>
              <Avatar name={r.profile.display_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.profile.display_name}</p>
                <p className="truncate text-sm tracking-wide text-muted">
                  {done ? r.shareGrid : r.status === "in_progress" ? "Playing…" : "Not played yet"}
                </p>
              </div>
              {done && (
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{r.score}</p>
                  <p className="text-xs text-muted tabular-nums">{r.label}</p>
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </section>
  );
}

export function LockedResults() {
  return (
    <Card className="flex items-center gap-3 p-4 text-sm text-muted">
      <span className="text-xl" aria-hidden>
        🔒
      </span>
      Finish the puzzle to see how your friends did.
    </Card>
  );
}
