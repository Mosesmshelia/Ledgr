import type { MetadataRoute } from "next";

// Lets people "Add to Home Screen" and open Ledgr like an app: its own icon, full screen, no browser bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ledgr",
    short_name: "Ledgr",
    description: "Sales, profit, cash and stock in one calm place.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f7",
    theme_color: "#0071e3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
