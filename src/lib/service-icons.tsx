import {
  Bot, Play, Music, Tv, Cloud, MousePointer, Code,
  FileText, Globe, Shield, Mail, Database, Cpu, Wifi,
  Sparkles, Compass, Image, Zap, MessageCircle, Brain,
  Apple, Search, Rocket, BookOpen, Video, Headphones,
  type LucideIcon,
} from "lucide-react";

interface ServiceIconInfo {
  Icon: LucideIcon;
  from: string;
  to: string;
}

const SERVICE_MAP: [string[], LucideIcon, string, string][] = [
  // ─── AI Services ───────────────────────────────────────────────────
  [["chatgpt", "openai", "gpt"], Bot, "#10a37f", "#1a7f64"],
  [["claude", "anthropic"], MessageCircle, "#d97706", "#b45309"],
  [["gemini", "google ai", "bard"], Sparkles, "#4285f4", "#1a73e8"],
  [["copilot", "github copilot"], Zap, "#6e40c9", "#553098"],
  [["cursor"], MousePointer, "#7c3aed", "#5b21b6"],
  [["midjourney", "mj"], Image, "#fff", "#c2c2c2"],
  [["perplexity"], Compass, "#20b2aa", "#178f89"],
  [["poe"], Brain, "#6366f1", "#4f46e5"],

  // ─── Streaming & Media ────────────────────────────────────────────
  [["youtube", "youtube premium"], Play, "#ff0000", "#cc0000"],
  [["spotify"], Music, "#1db954", "#169c46"],
  [["netflix"], Tv, "#e50914", "#b8070f"],
  [["apple music"], Headphones, "#fc3c44", "#d63139"],
  [["apple", "icloud", "apple one"], Apple, "#555", "#333"],
  [["bilibili"], Video, "#00a1d6", "#0088b5"],

  // ─── Dev & Cloud ──────────────────────────────────────────────────
  [["github"], Code, "#333", "#111"],
  [["notion"], FileText, "#333", "#111"],
  [["supabase"], Database, "#3ecf8e", "#2ea96d"],
  [["vercel"], Cpu, "#333", "#111"],
  [["aws", "amazon"], Cloud, "#ff9900", "#cc7a00"],
  [["google", "gcp", "workspace"], Search, "#4285f4", "#1a73e8"],
  [["microsoft", "azure", "office", "365"], Rocket, "#00a4ef", "#0088cc"],

  // ─── Productivity ─────────────────────────────────────────────────
  [["vpn", "nord", "express", "surf"], Shield, "#4687ff", "#3366cc"],
  [["mail", "email", "outlook", "gmail"], Mail, "#ea4335", "#cc3a2e"],
  [["wifi", "internet", "broadband"], Wifi, "#2196f3", "#1976d2"],
  [["read", "kindle", "book"], BookOpen, "#ff9900", "#cc7a00"],
];

export function getServiceIcon(name: string): ServiceIconInfo {
  const lower = name.toLowerCase();
  for (const [patterns, Icon, from, to] of SERVICE_MAP) {
    if (patterns.some((p) => lower.includes(p))) {
      return { Icon, from, to };
    }
  }
  return { Icon: Globe, from: "#6366f1", to: "#4f46e5" };
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
