import type { NextConfig } from "next";

/** On every response. None of them limits what the pages load: a policy on
 *  scripts would need a nonce on each of the inline ones Next writes, which
 *  makes every page dynamic. These close what costs nothing to close. */
const SECURITY_HEADERS = [
  // No page is framed by another site: nothing to click-jack on /finance or the
  // split bill's edit buttons. The CSP form for browsers that know it, the old
  // header for those that do not.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
