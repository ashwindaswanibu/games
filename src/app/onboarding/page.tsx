import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getProfile, requireUser } from "@/server/auth";
import { signOut } from "../(auth)/actions";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await getProfile(user.id)) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col items-center gap-3 text-center">
        <BrandMark size={56} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">One more step</h1>
          <p className="text-sm text-muted">Pick a username and enter the invite code.</p>
        </div>
      </header>
      <OnboardingForm suggestedName={user.suggestedName ?? ""} />
      <form action={signOut} className="text-center">
        <button type="submit" className="text-sm text-muted underline underline-offset-4">
          Use a different account
        </button>
      </form>
    </main>
  );
}
