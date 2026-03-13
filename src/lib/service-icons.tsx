import {
  Bot, Play, Music, Tv, Cloud, MousePointer, Code,
  FileText, Globe, Shield, Mail, Database, Cpu, Wifi,
  type LucideIcon,
} from "lucide-react";

interface ServiceIconInfo {
  Icon: LucideIcon;
  from: string;
  to: string;
}

const SERVICE_MAP: [string[], LucideIcon, string, string][] = [
  [["chatgpt", "openai", "gpt"], Bot, "oklch(0.65 0.25 290)", "oklch(0.55 0.28 310)"],
  [["youtube"], Play, "oklch(0.63 0.25 25)", "oklch(0.55 0.28 15)"],
  [["spotify"], Music, "oklch(0.72 0.2 155)", "oklch(0.62 0.22 145)"],
  [["netflix"], Tv, "oklch(0.6 0.26 20)", "oklch(0.5 0.28 30)"],
  [["icloud", "cloud", "drive"], Cloud, "oklch(0.7 0.15 240)", "oklch(0.6 0.2 250)"],
  [["cursor"], MousePointer, "oklch(0.6 0.22 280)", "oklch(0.5 0.25 295)"],
  [["github", "copilot"], Code, "oklch(0.55 0.05 270)", "oklch(0.4 0.08 280)"],
  [["notion"], FileText, "oklch(0.55 0.08 60)", "oklch(0.45 0.1 50)"],
  [["vpn", "nord", "express", "surf"], Shield, "oklch(0.65 0.2 210)", "oklch(0.55 0.22 220)"],
  [["mail", "email", "outlook", "gmail"], Mail, "oklch(0.65 0.18 230)", "oklch(0.55 0.2 240)"],
  [["supabase", "database", "mongo", "postgres"], Database, "oklch(0.7 0.18 160)", "oklch(0.6 0.2 150)"],
  [["vercel", "server", "aws", "hosting"], Cpu, "oklch(0.5 0.05 260)", "oklch(0.4 0.08 270)"],
  [["wifi", "internet", "broadband"], Wifi, "oklch(0.65 0.2 200)", "oklch(0.55 0.22 210)"],
];

export function getServiceIcon(name: string): ServiceIconInfo {
  const lower = name.toLowerCase();
  for (const [patterns, Icon, from, to] of SERVICE_MAP) {
    if (patterns.some((p) => lower.includes(p))) {
      return { Icon, from, to };
    }
  }
  return { Icon: Globe, from: "oklch(0.6 0.12 250)", to: "oklch(0.5 0.15 260)" };
}

export interface PersonColor {
  from: string;
  to: string;
}

const PERSON_COLORS: PersonColor[] = [
  { from: "oklch(0.7 0.2 330)", to: "oklch(0.6 0.25 350)" },   // pink
  { from: "oklch(0.65 0.25 290)", to: "oklch(0.55 0.28 300)" }, // violet
  { from: "oklch(0.72 0.15 200)", to: "oklch(0.62 0.18 210)" }, // cyan
  { from: "oklch(0.72 0.18 160)", to: "oklch(0.62 0.2 150)" },  // emerald
  { from: "oklch(0.75 0.16 70)", to: "oklch(0.65 0.2 55)" },    // amber
  { from: "oklch(0.68 0.22 15)", to: "oklch(0.58 0.25 5)" },    // rose
  { from: "oklch(0.65 0.2 260)", to: "oklch(0.55 0.25 270)" },  // indigo
  { from: "oklch(0.7 0.15 180)", to: "oklch(0.6 0.18 170)" },   // teal
];

export function getPersonColor(index: number): PersonColor {
  return PERSON_COLORS[index % PERSON_COLORS.length];
}
