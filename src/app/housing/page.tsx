import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFinanceOwner } from "@/lib/access";
import { HousingApp } from "@/components/housing/housing-app";

/** Renting against buying in Singapore, for the owner of /finance and nobody
 *  else: the same check, here before anything renders and again by
 *  /api/housing on every request. To anyone else it is a missing page. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const session = await auth();
  if (!isFinanceOwner(session?.user?.email)) return {};
  return { title: "Housing | Playground", robots: { index: false, follow: false } };
}

export default async function HousingPage() {
  const session = await auth();
  if (!isFinanceOwner(session?.user?.email)) notFound();
  return <HousingApp />;
}
