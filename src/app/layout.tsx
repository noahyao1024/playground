import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { SessionProvider } from "@/components/session-provider";
import { Navbar } from "@/components/navbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Playground | Noah's Tools",
  description:
    "Playground is a web app with Split Bill for subscription cost sharing and SRE Machines for server delivery tracking.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} antialiased`}>
        <SessionProvider>
          <ThemeProvider>
            <TooltipProvider>
              <div className="flex min-h-screen flex-col">
                <Navbar />
                <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
                  {children}
                </main>
                <footer className="border-t border-border/60">
                  <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <p>Playground by Noah Yao</p>
                    <div className="flex items-center gap-4">
                      <Link
                        href="/privacy"
                        className="transition-opacity hover:opacity-70"
                      >
                        Privacy
                      </Link>
                      <Link
                        href="/terms"
                        className="transition-opacity hover:opacity-70"
                      >
                        Terms
                      </Link>
                    </div>
                  </div>
                </footer>
                <Toaster richColors position="bottom-right" />
              </div>
            </TooltipProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
