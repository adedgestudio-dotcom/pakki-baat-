import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pakki Baat Admin",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PB Admin",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/admin-icon.svg",
    apple: "/admin-icon-192.png",
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
