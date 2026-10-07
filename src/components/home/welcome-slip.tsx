"use client";

import Link from "next/link";
import { memo, useEffect, useState, type CSSProperties } from "react";
import type { WelcomeNote } from "@/core/home-view";
import styles from "./chrome.module.css";

/**
 * A first sign-in (§5.7): a slip of cream paper pasted at the top of the credits, saying how
 * friends see you and where to change it. Closes for this page view (the close button or Esc).
 */
export const WelcomeSlip = memo(function WelcomeSlip({ welcome, cut }: { welcome: WelcomeNote; cut: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <aside className={styles.welcome} style={{ "--cut": cut } as CSSProperties} aria-label="Welcome" data-comes-up="">
      <span className={styles.slipPlate} aria-hidden="true" />
      <span className={styles.slipPaper} aria-hidden="true" />
      <div className={styles.welcomeBody}>
        <p className={styles.hey}>Hey {welcome.firstName}.</p>
        <p className={styles.welcomeText}>
          Friends see you as {welcome.displayName} (@{welcome.username}).{" "}
          <Link href={`/u/${welcome.username}`} className={styles.welcomeLink}>
            Change either on your profile
          </Link>
        </p>
        <button type="button" className={styles.close} aria-label="Close" onClick={() => setOpen(false)}>
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
    </aside>
  );
});
