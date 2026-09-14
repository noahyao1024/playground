import Link from "next/link";
import type { ReactNode } from "react";

type LegalPageProps = {
  title: string;
  summary: string;
  updatedAt: string;
  children: ReactNode;
};

type LegalSectionProps = {
  title: string;
  children: ReactNode;
};

export function LegalPage({
  title,
  summary,
  updatedAt,
  children,
}: LegalPageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="rounded-3xl border border-border/70 bg-card px-6 py-8 shadow-sm sm:px-8">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Google OAuth Support
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
          {summary}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Last updated: {updatedAt}
        </p>
      </section>

      <section className="space-y-6 rounded-3xl border border-border/70 bg-card px-6 py-8 shadow-sm sm:px-8">
        {children}
      </section>

      <section className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <Link
          href="/"
          className="underline underline-offset-4 transition-opacity hover:opacity-70"
        >
          Home
        </Link>
        <Link
          href="/auth/signin"
          className="underline underline-offset-4 transition-opacity hover:opacity-70"
        >
          Sign in
        </Link>
      </section>
    </div>
  );
}

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium tracking-tight text-foreground">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
