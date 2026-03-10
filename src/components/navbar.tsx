"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun, Home } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Home className="h-5 w-5" />
            <span className="hidden sm:inline">Playground</span>
          </Link>
          {pathname !== "/" && (
            <nav className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">
                {pathname.startsWith("/split-bill") && "Split Bill / 分账"}
                {pathname.startsWith("/machines") && "SRE Machines"}
              </span>
            </nav>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </div>
    </header>
  );
}
