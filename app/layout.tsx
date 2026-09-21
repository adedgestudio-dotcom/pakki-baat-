import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pakki Baat — Your little business assistant",
  description:
    "Customer conversations, clear commitments and a little less remembering. For bakers, tutors, boutique owners and other small businesses.",
  themeColor: "#8068cf",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pakki Baat",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
