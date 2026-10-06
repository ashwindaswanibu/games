import type { ComponentProps, ReactNode } from "react";

/** Small, dependency-free primitives shared across pages. */

type ButtonVariant = "primary" | "secondary" | "ghost" | "accent";

const BUTTON_BASE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-fg text-bg hover:opacity-90",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-2",
  ghost: "text-muted hover:text-fg",
  accent: "bg-accent text-black hover:opacity-90",
};

export function buttonClass(variant: ButtonVariant = "primary", extra = "") {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${extra}`;
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-2xl border border-border bg-surface ${className}`} {...props} />;
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="text-xs font-semibold tracking-wider text-muted uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  ...input
}: ComponentProps<"input"> & { label: string; error?: string; hint?: string }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        className="h-11 rounded-xl border border-border bg-surface px-3.5 outline-none transition focus:border-fg aria-invalid:border-bad"
        aria-invalid={error ? true : undefined}
        {...input}
      />
      {error ? <span className="text-xs text-bad">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function FormMessage({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
      {children}
    </p>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  // Stable pastel from the name, so each friend keeps their color everywhere.
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-black/75"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 70% 78%)` }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
