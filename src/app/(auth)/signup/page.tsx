import type { Metadata } from "next";
import Link from "next/link";
import { publicEnv } from "@/lib/public-env";
import { Divider, GoogleButton } from "../google-button";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="grid gap-6">
      {publicEnv.googleAuthEnabled && (
        <>
          <GoogleButton />
          <Divider />
        </>
      )}
      <SignupForm />
      <p className="text-center text-sm text-muted">
        Already playing?{" "}
        <Link href="/login" className="font-medium text-fg underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
