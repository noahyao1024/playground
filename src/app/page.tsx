"use client";

import Link from "next/link";
import {
  Receipt,
  Server,
  ArrowUpRight,
  ShieldCheck,
  UserRoundCheck,
  FileText,
} from "lucide-react";
import { motion } from "framer-motion";

const tools = [
  {
    title: "Split Bill",
    subtitle: "分账",
    description: "Track shared subscription costs with SGD & USD to CNY conversion.",
    icon: Receipt,
    href: "/split-bill",
  },
  {
    title: "SRE Machines",
    subtitle: "交付追踪",
    description: "Track server deliveries with status timeline from order to deploy.",
    icon: Server,
    href: "/machines",
  },
];

const overview = [
  {
    title: "What Playground does",
    description:
      "Playground is a small web app by Noah Yao for managing subscription cost sharing and tracking SRE machine deliveries.",
    icon: ShieldCheck,
  },
  {
    title: "Why Google Sign-In is used",
    description:
      "Google Sign-In is used only to authenticate users, keep sessions secure, and restrict editing access to approved accounts.",
    icon: UserRoundCheck,
  },
  {
    title: "Public policies",
    description:
      "Privacy Policy and Terms of Service are published publicly for users and Google OAuth review.",
    icon: FileText,
  },
];

export default function HomePage() {
  return (
    <div className="space-y-12">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="grid gap-8 rounded-[2rem] border border-border/70 bg-card px-6 py-8 shadow-sm sm:px-8 lg:grid-cols-[1.4fr_0.9fr] lg:items-end"
      >
        <div className="space-y-5">
          <div className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Public app overview
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Playground by Noah Yao
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
              Playground is a small web application that provides two tools:
              Split Bill for tracking shared subscription costs across friends
              and currencies, and SRE Machines for tracking server delivery from
              order to deployment.
            </p>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
              Google Sign-In is used only for authentication and access control.
              The app uses basic Google profile data such as name, email address,
              and avatar to identify users and protect editing features.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/privacy"
              className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Terms of Service
            </Link>
          </div>
        </div>

        <div className="grid gap-3">
          {overview.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08 + i * 0.08 }}
              className="rounded-2xl border border-border/70 bg-background/80 p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <item.icon className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-medium text-foreground">
                  {item.title}
                </h2>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-medium tracking-tight text-foreground">
            Available tools
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Public descriptions of the current features available in Playground.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
        {tools.map((tool, i) => (
          <motion.div
            key={tool.href}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 + i * 0.08 }}
          >
            <Link href={tool.href} className="group block">
              <div className="relative rounded-xl border border-border bg-card p-5 transition-colors duration-200 hover:bg-accent hover:border-border/80">
                <div className="flex items-start justify-between mb-3">
                  <tool.icon className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.5} />
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground/0 transition-all group-hover:text-muted-foreground group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-sm font-medium text-foreground">
                    {tool.title}
                    <span className="ml-1.5 text-muted-foreground font-normal">{tool.subtitle}</span>
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {tool.description}
                  </p>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
        </div>
      </div>

      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.3 }}
        className="rounded-[2rem] border border-border/70 bg-card px-6 py-6 shadow-sm sm:px-8"
      >
        <h2 className="text-lg font-medium tracking-tight text-foreground">
          Contact and review information
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
          Playground is operated by Noah Yao. For privacy, policy, or Google
          OAuth review questions, contact{" "}
          <a
            href="mailto:hi@noahyao.me"
            className="underline underline-offset-4 transition-opacity hover:opacity-70"
          >
            hi@noahyao.me
          </a>
          .
        </p>
      </motion.section>
    </div>
  );
}
