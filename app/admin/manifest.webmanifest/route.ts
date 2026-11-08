export function GET() {
  return Response.json({
    name: "Pakki Baat Admin",
    short_name: "PB Admin",
    id: "/admin",
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    background_color: "#141a18",
    theme_color: "#2d7667",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
