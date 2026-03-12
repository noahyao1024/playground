"use client";

import Link from "next/link";
import { Receipt, Server, ArrowUpRight } from "lucide-react";
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

export default function HomePage() {
  return (
    <div className="min-h-[75vh] flex flex-col justify-center -mt-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="mb-12"
      >
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Playground
        </h1>
        <p className="mt-2 text-muted-foreground">
          Tools for everyday use. Pick one.
        </p>
      </motion.div>

      {/* Cards */}
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

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.3 }}
        className="mt-8 text-xs text-muted-foreground/40"
      >
        more coming soon
      </motion.p>
    </div>
  );
}
