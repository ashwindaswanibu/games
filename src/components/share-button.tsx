"use client";

import { useState } from "react";
import { buttonClass } from "./ui";

/** Uses the native share sheet on phones, clipboard elsewhere. */
export function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const full = `${text}\n${window.location.origin}`;
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ text: full });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={share} className={buttonClass("accent", "w-full")}>
      {copied ? "Copied!" : "Share result"}
    </button>
  );
}
