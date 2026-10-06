import Link from "next/link";
import { BottomNav } from "@/components/bottom-nav";
import { BrandMark } from "@/components/brand-mark";
import { APP_NAME } from "@/config";
import { requireProfile } from "@/server/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireProfile();
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-bg/90 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <BrandMark size={26} />
          {APP_NAME}
        </Link>
        {profile.is_admin && (
          <Link href="/admin" className="text-xs font-medium text-muted hover:text-fg">
            Admin
          </Link>
        )}
      </header>
      <main className="flex-1 px-4 pt-2 pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</main>
      <BottomNav username={profile.username} />
    </div>
  );
}
