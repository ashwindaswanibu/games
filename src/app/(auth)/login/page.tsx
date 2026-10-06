import type { Metadata } from "next";
import Link from "next/link";
import { publicEnv } from "@/lib/public-env";
import { Divider, GoogleButton } from "../google-button";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  google: "Google sign-in didn't work. Try again.",
  oauth: "Sign-in link expired or was already used. Try again.",
  welcome: "Couldn't finish setting up your account. Try again in a minute.",
  account: "That account can't be used here. Continue with Google, or create an account with a username.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <div className="grid gap-6">
      {publicEnv.googleAuthEnabled && (
        <>
          <GoogleButton />
          <Divider />
        </>
      )}
      <LoginForm initialError={typeof error === "string" ? ERRORS[error] : undefined} />
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-fg underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}
