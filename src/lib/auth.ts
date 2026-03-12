import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const ALLOWED_EMAILS = [
  "nicholasyao.sg@gmail.com",
  "hi@noahyao.me",
];

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && ALLOWED_EMAILS.includes(email);
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
});
