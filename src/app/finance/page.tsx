import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFinanceOwner } from "@/lib/access";
import { FinanceApp } from "@/components/finance/finance-app";

/** The owner's own money. Checked here, before anything renders, and again by
 *  /api/finance on every request -- the page is a door, the route is the lock.
 *  To anyone else, signed in or not, there is no such page: it answers as any
 *  missing one does, and says nothing of what it is. The owner, signed out,
 *  comes in by /auth/signin?callbackUrl=/finance. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const session = await auth();
  if (!isFinanceOwner(session?.user?.email)) return {};
  return { title: "Finance | Playground", robots: { index: false, follow: false } };
}

export default async function FinancePage() {
  const session = await auth();
  if (!isFinanceOwner(session?.user?.email)) notFound();
  return <FinanceApp />;
}
