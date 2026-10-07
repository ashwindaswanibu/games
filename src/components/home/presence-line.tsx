import Link from "next/link";
import type { PresenceLine as Presence } from "@/core/home-view";
import styles from "./title.module.css";

/** "Marco is playing Number Hunt": one line as of page load, never a result (§5.2). */
export function PresenceLine({ presence }: { presence: Presence }) {
  return (
    <p className={styles.presence} data-op="presence">
      <span className={styles.presenceDot} aria-hidden="true" />
      <span className={styles.presenceText}>
        <b>{presence.firstName}</b> {presence.kind === "playing" ? "is playing" : "finished"}{" "}
        <Link href={presence.gameHref} className={styles.presenceGame}>
          {presence.gameName}
        </Link>
      </span>
    </p>
  );
}
