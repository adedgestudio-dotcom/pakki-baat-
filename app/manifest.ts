import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pakki Baat — Your little business assistant",
    short_name: "Pakki Baat",
    description:
      "Customer conversations, clear commitments and a little less remembering.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#2d7667",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
