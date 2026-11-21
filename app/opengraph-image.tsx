import { ImageResponse } from "next/og";

export const alt = "Pakki Baat — Your little business assistant";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", background: "linear-gradient(135deg, #1d554b, #2d7667, #348878)", color: "#fffdf8" }}>
      <div style={{ fontSize: 100, fontWeight: 700, letterSpacing: -3 }}>Pakki Baat</div>
      <div style={{ fontSize: 38, marginTop: 18, color: "#d8eee7" }}>Your little business assistant</div>
    </div>,
    size,
  );
}
