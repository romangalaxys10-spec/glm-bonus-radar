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
  themeColor: "#050505",
};

/**
 * Runs before first paint: resolves the color mode (br-mode: light|dark,
 * default dark — the xShredo design) into the .light/.dark class + native
 * color-scheme, and keeps the legacy palette key harmless.
 */
const themeBoot = `
(function(){try{
  var d=document.documentElement;
  var m=localStorage.getItem("${MODE_STORAGE_KEY}");
  if(m!=="light"&&m!=="dark")m="dark";
  d.classList.remove("light","dark");
  d.classList.add(m);
  d.style.colorScheme=m;
  var p=localStorage.getItem("${PALETTE_STORAGE_KEY}")||"brook";
  d.dataset.palette=p;
}catch(e){
  var d2=document.documentElement;
  d2.classList.add("dark");
  d2.style.colorScheme="dark";
}})();
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
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
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
