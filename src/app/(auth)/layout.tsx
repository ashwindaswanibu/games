import { BrandMark } from "@/components/brand-mark";
import { APP_DESCRIPTION, APP_NAME } from "@/config";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col items-center gap-3 text-center">
        <BrandMark size={56} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{APP_NAME}</h1>
          <p className="text-sm text-muted">{APP_DESCRIPTION}</p>
        </div>
      </header>
      {children}
    </main>
  );
}
