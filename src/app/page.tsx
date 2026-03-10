import Link from "next/link";
import { Receipt, Server } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const tools = [
  {
    title: "Split Bill / 分账",
    description: "Track subscription costs shared among friends. Supports SGD & USD with auto CNY conversion.",
    icon: Receipt,
    href: "/split-bill",
    gradient: "from-emerald-500/20 to-teal-500/20",
    iconColor: "text-emerald-500",
  },
  {
    title: "SRE Machine Delivery",
    description: "Track server/machine deliveries with status timeline — from ordered to deployed.",
    icon: Server,
    href: "/machines",
    gradient: "from-blue-500/20 to-indigo-500/20",
    iconColor: "text-blue-500",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Playground</h1>
        <p className="text-muted-foreground">
          Noah&apos;s collection of useful tools. Pick one to get started.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {tools.map((tool) => (
          <Link key={tool.href} href={tool.href}>
            <Card className="group relative overflow-hidden transition-all hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30 cursor-pointer h-full">
              <div className={`absolute inset-0 bg-gradient-to-br ${tool.gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
              <CardHeader className="relative">
                <div className="mb-3">
                  <tool.icon className={`h-8 w-8 ${tool.iconColor}`} />
                </div>
                <CardTitle className="text-lg">{tool.title}</CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
              <CardContent className="relative">
                <span className="text-sm text-muted-foreground group-hover:text-primary transition-colors">
                  Open tool →
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        More tools coming soon. Built for friends in Singapore 🇸🇬
      </div>
    </div>
  );
}
