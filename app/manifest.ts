import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pakki Baat — Your little business assistant",
    short_name: "Pakki Baat",
    description:
      "Customer conversations, clear commitments and a little less remembering.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f7fc",
    theme_color: "#8068cf",
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
