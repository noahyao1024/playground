import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFinanceOwner } from "@/lib/access";
import { FinanceApp } from "@/components/finance/finance-app";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

/** The owner's own money. Checked here, before anything renders, and again by
 *  /api/finance on every request -- the page is a door, the route is the lock. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Finance | Playground",
  robots: { index: false, follow: false },
};

export default async function FinancePage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="w-full max-w-xs space-y-6">
          <div className="space-y-1">
            <h1 className="text-lg font-medium tracking-tight">Finance</h1>
            <p className="text-sm text-muted-foreground">Private. Sign in to continue.</p>
          </div>
          <GoogleSignInButton callbackUrl="/finance" />
        </div>
      </div>
    );
  }
  // Anyone else signed in is told nothing is here.
  if (!isFinanceOwner(session.user.email)) notFound();
  return <FinanceApp />;
}
