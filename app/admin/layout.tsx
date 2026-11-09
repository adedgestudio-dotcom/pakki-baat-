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
  return <>
    <script id="admin-install-capture" dangerouslySetInnerHTML={{ __html: `
      (function () {
        if (window.__pbAdminInstallCapture) return;
        window.__pbAdminInstallCapture = true;
        window.addEventListener("beforeinstallprompt", function (event) {
          if (location.pathname !== "/admin" && !location.pathname.startsWith("/admin/")) return;
          event.preventDefault();
          window.__pbAdminInstallPrompt = event;
          window.dispatchEvent(new Event("pb-admin-install-ready"));
        });
        window.addEventListener("appinstalled", function () {
          window.__pbAdminInstallPrompt = null;
        });
      })();
    ` }} />
    {children}
  </>;
}
