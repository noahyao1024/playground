import { sameSitePath } from "@/lib/paths";
import { SignInPanel } from "./sign-in-panel";

/** Lands on ?callbackUrl= afterwards, a path on this site, or else the split
 *  bill. /auth/signin?callbackUrl=/finance is the owner's way into a page that is
 *  missing to everyone else. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const { callbackUrl } = await searchParams;
  return <SignInPanel callbackUrl={sameSitePath(callbackUrl, "/split-bill")} />;
}
