import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl" aria-hidden>
        🧩
      </p>
      <h1 className="text-xl font-bold">Nothing here</h1>
      <p className="text-sm text-muted">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className={buttonClass("primary")}>
        Back to today
      </Link>
    </main>
  );
}
