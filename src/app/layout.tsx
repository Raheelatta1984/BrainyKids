import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrainyKids | Challenge Mode",
  description: "A place for curious minds to learn, explore, and grow.",
  applicationName: "BrainyKids",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3b5bdb",
};

// The CSP in `src/middleware.ts` carries a per-request nonce, and Next.js only
// tags its inline hydration scripts with that nonce when the page is rendered for
// the request (static pages are prerendered at build time, when no nonce exists).
// Rendering the shell per request is what makes the nonce-based policy enforceable.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
