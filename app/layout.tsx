import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "Pakki Baat — Your little business assistant",
  description: "Customer conversations, clear commitments and a little less remembering.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
