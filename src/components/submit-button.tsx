"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "./ui";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: Parameters<typeof buttonClass>[0];
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, className)}>
      {pending ? (pendingText ?? "…") : children}
    </button>
  );
}
