import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { withRoles, type Roles } from "@/lib/access";

export { ALLOWED_EMAILS, isAllowedEmail } from "@/lib/access";

declare module "next-auth" {
  /** The session the browser gets says what its address may do (`withRoles`). */
  interface Session {
    user?: DefaultSession["user"] & Partial<Roles>;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    // The browser is told what the signed-in address may do, never who else may.
    session: ({ session }) => withRoles(session),
  },
});
