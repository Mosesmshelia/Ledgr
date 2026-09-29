import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ledgr", template: "%s · Ledgr" },
  description: "Your business, clearly. Sales, profit, cash and stock in one calm place.",
  applicationName: "Ledgr",
  // iPhone "Add to Home Screen": opens full screen with a translucent status bar, named "Ledgr".
  appleWebApp: { capable: true, title: "Ledgr", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body>{children}</body>
    </html>
  );
}
