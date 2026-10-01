import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { InstallPrompt } from "@/components/portal/install-prompt";
import { MODE_STORAGE_KEY, PALETTE_STORAGE_KEY } from "@/lib/theme";

export const metadata: Metadata = {
  title: "GLM Bonus Radar — Peak Rates, Bonus Windows & Token Discounts",
  description:
    "Live tracker for z.ai bonus inference windows: peak-hour multipliers, GLM-5.3-Flash usage campaign, limited-time API discounts, coding plan tiers — plus a 10% off invite code for the GLM Coding Plan.",
  keywords: [
    "z.ai",
    "GLM",
    "GLM-5.3",
    "GLM-5.3-Flash",
    "GLM Coding Plan",
    "peak hours",
    "off-peak",
    "bonus inference",
    "token discount",
    "Prometheus metrics",
  ],
  authors: [{ name: "GLM Bonus Radar" }],
  icons: {
    icon: "/logo.svg",
    apple: "/icon-192.png",
  },
  manifest: "/manifest.webmanifest",
  alternates: {
    types: {
      "application/atom+xml": "/api/announcements",
      "application/rss+xml": "/api/announcements?format=rss",
    },
  },
  openGraph: {
    title: "GLM Bonus Radar — Peak Rates, Bonus Windows & Token Discounts",
    description:
      "Live countdowns for z.ai peak hours, the GLM-5.3-Flash usage campaign and limited-time API discounts. Includes a 10% off invite code for the GLM Coding Plan.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2ec" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1510" },
  ],
};

/**
 * Runs before first paint: restores palette + color mode from localStorage
 * (same rc-* keys the original tracker used, namespaced to br-*), sets
 * data-palette and the .dark class on <html>.
 */
const themeBoot = `
(function(){try{
  var d=document.documentElement;
  var p=localStorage.getItem("${PALETTE_STORAGE_KEY}")||"brook";
  var m=localStorage.getItem("${MODE_STORAGE_KEY}")||"system";
  var dark=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
  d.dataset.palette=p;
  d.classList.toggle("dark",dark);
  d.style.colorScheme=dark?"dark":"light";
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router: these load once for the whole app; the lint rule below targets Pages Router only. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,600&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Bonus Radar" />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <InstallPrompt />
        <Toaster />
      </body>
    </html>
  );
}
