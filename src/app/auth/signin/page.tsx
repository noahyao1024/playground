"use client";

import Link from "next/link";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { motion } from "framer-motion";

export default function SignInPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-xs space-y-6"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-medium tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Continue to access your tools.
          </p>
        </div>

        <GoogleSignInButton callbackUrl="/split-bill" />

        <div className="space-y-2 text-center">
          <p className="text-[11px] text-muted-foreground/50">
            Google OAuth 2.0
          </p>
          <p className="text-[11px] leading-5 text-muted-foreground/70">
            By continuing, you agree to the{" "}
            <Link
              href="/terms"
              className="underline underline-offset-4 transition-opacity hover:opacity-70"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-4 transition-opacity hover:opacity-70"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </motion.div>
    </div>
  );
}
