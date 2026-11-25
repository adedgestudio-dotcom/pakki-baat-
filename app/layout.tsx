import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Pakki Baat — Your little business assistant";
const description = "Customer conversations, clear commitments and a little less remembering. For bakers, tutors, boutique owners and other small businesses.";

export const metadata: Metadata = {
  metadataBase: new URL("https://pakki-baat.in"),
  verification: { google: "4BmVrJoKS2HerPEw_cz7dPo1qZWQ3J1abMyRA4sEoFg" },
  title,
  description,
  keywords: ["hisaab app", "customer ledger app", "small business udhaar tracker", "baki hisaab app", "business bookkeeping India"],
  alternates: { canonical: "https://pakki-baat.in" },
  openGraph: { title, description, url: "https://pakki-baat.in", siteName: "Pakki Baat", images: ["/opengraph-image"], locale: "en_IN", type: "website" },
  twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pakki Baat",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#2d7667",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: "Pakki Baat", url: "https://pakki-baat.in", description }).replace(/</g, "\\u003c") }} />
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
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('pakki-baat-theme');document.documentElement.dataset.theme=t==='dark'?'dark':'light';document.documentElement.style.colorScheme=t==='dark'?'dark':'light'}catch(e){}",
          }}
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
