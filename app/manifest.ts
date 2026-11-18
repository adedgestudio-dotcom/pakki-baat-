import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pakki Baat — Your little business assistant",
    short_name: "Pakki Baat",
    description:
      "Customer conversations, clear commitments and a little less remembering.",
    start_url: "/",
    id: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f2e8",
    theme_color: "#2d7667",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
