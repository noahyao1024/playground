import {
  Play, Music, Tv, Cloud, Code,
  FileText, Globe, Shield, Mail, Database, Cpu, Wifi,
  Search, Rocket, BookOpen, Video, Headphones,
  type LucideIcon,
} from "lucide-react";
import React from "react";

// ─── Custom SVG brand icons ─────────────────────────────────────────
// Simplified, recognizable brand marks for popular AI/tech services

function ChatGPTIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4.709 15.955l4.397-10.985c.245-.618.658-.97 1.21-.97.544 0 .957.352 1.202.97l4.396 10.985c.163.408.245.734.245.97 0 .782-.56 1.348-1.348 1.348-.625 0-1.07-.326-1.299-.97L12.82 15.2H8.504l-.693 2.103c-.229.644-.674.97-1.299.97-.789 0-1.348-.566-1.348-1.348 0-.236.082-.562.245-.97zm7.438-3.063l-1.512-4.582h-.082l-1.511 4.582zm5.07-.244c0-2.89 1.862-4.68 4.29-4.68 1.445 0 2.56.667 3.217 1.79.163.27.245.545.245.815 0 .674-.505 1.184-1.175 1.184-.42 0-.748-.163-1.062-.62-.433-.644-.797-.896-1.282-.896-.871 0-1.461.78-1.461 2.407s.59 2.407 1.461 2.407c.485 0 .849-.252 1.282-.897.314-.456.643-.619 1.062-.619.67 0 1.175.51 1.175 1.184 0 .27-.082.545-.245.815-.657 1.123-1.772 1.79-3.217 1.79-2.428 0-4.29-1.79-4.29-4.68z" />
    </svg>
  );
}

function GeminiIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 24A14.304 14.304 0 0 0 0 12 14.304 14.304 0 0 0 12 0a14.305 14.305 0 0 0 12 12 14.305 14.305 0 0 0-12 12" />
    </svg>
  );
}

function CursorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M5.625 3.75L2.25 20.25L9.75 14.25L18.75 16.5L5.625 3.75Z" />
      <path d="M12 15L14.25 21.75L16.5 15.75L12 15Z" opacity="0.6" />
    </svg>
  );
}

function PerplexityIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 1L4 5v6.5L12 16l8-4.5V5L12 1zm0 2.2l5.6 3.15v4.3L12 13.8l-5.6-3.15v-4.3L12 3.2zM4 13.5V19l8 4 8-4v-5.5l-8 4.5-8-4.5z" />
    </svg>
  );
}

function CopilotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 15.93A7.006 7.006 0 0 1 5 12c0-1.05.234-2.05.652-2.947L9 12.586V16a1 1 0 0 0 1 1v.93zm6.616-2.556A.993.993 0 0 0 17 15h-1v-3a1 1 0 0 0-1-1H9v-2h2a1 1 0 0 0 1-1V6h2a2 2 0 0 0 2-2v-.422A7.008 7.008 0 0 1 19 12a6.96 6.96 0 0 1-1.384 3.374z" />
    </svg>
  );
}

// ─── Types ──────────────────────────────────────────────────────────

type IconComponent = LucideIcon | React.FC<{ className?: string }>;

interface ServiceIconInfo {
  Icon: IconComponent;
  bg: string;      // background color
  color?: string;  // icon color override (default: white)
}

// ─── Service map ────────────────────────────────────────────────────

const SERVICE_MAP: [string[], IconComponent, string, string?][] = [
  // AI Services — with custom SVG brand icons
  [["chatgpt", "openai", "gpt"], ChatGPTIcon, "#10a37f"],
  [["claude", "anthropic"], ClaudeIcon, "#da7756"],
  [["gemini", "google ai", "bard"], GeminiIcon, "#4285f4"],
  [["copilot", "github copilot"], CopilotIcon, "#6e40c9"],
  [["cursor"], CursorIcon, "#000"],
  [["midjourney", "mj"], GeminiIcon, "#1a1a2e"],
  [["perplexity"], PerplexityIcon, "#20b2aa"],
  [["poe"], ChatGPTIcon, "#6366f1"],

  // Streaming & Media
  [["youtube", "youtube premium"], Play, "#ff0000"],
  [["spotify"], Music, "#1db954"],
  [["netflix"], Tv, "#e50914"],
  [["apple music"], Headphones, "#fc3c44"],
  [["apple", "icloud", "apple one"], Globe, "#555"],
  [["bilibili"], Video, "#00a1d6"],

  // Dev & Cloud
  [["github"], Code, "#24292e"],
  [["notion"], FileText, "#000"],
  [["supabase"], Database, "#3ecf8e"],
  [["vercel"], Cpu, "#000"],
  [["aws", "amazon"], Cloud, "#ff9900"],
  [["google", "gcp", "workspace"], Search, "#4285f4"],
  [["microsoft", "azure", "office", "365"], Rocket, "#00a4ef"],

  // Productivity
  [["vpn", "nord", "express", "surf"], Shield, "#4687ff"],
  [["mail", "email", "outlook", "gmail"], Mail, "#ea4335"],
  [["wifi", "internet", "broadband"], Wifi, "#2196f3"],
  [["read", "kindle", "book"], BookOpen, "#ff9900"],
];

export function getServiceIcon(name: string): ServiceIconInfo {
  const lower = name.toLowerCase();
  for (const [patterns, Icon, bg, color] of SERVICE_MAP) {
    if (patterns.some((p) => lower.includes(p))) {
      return { Icon, bg, color };
    }
  }
  return { Icon: Globe, bg: "#6366f1" };
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
