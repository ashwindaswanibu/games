import type { Metadata } from "next";
import Link from "next/link";
import { publicEnv } from "@/lib/public-env";
import styles from "../auth.module.css";
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
      <p className={styles.switch}>
        Already playing?{" "}
        <Link href="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
