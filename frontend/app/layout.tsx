import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import SiteNav from "./site-nav";
import TokenCapture from "./token-capture";

export const metadata: Metadata = {
  title: "Qryvox",
  description: "Investment product diligence copilot",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// Every screen answers where am I and where can I go from the same place: a translucent header the page
// scrolls under, the product's name as the way home, and the two places a review starts from.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TokenCapture />
        <header className="header">
          <div className="header-inner">
            <Link href="/" className="wordmark">
              Qryvox
            </Link>
            <SiteNav />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
