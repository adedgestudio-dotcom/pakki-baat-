"use client";

import { useEffect, useRef, useState } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type AdminInstallWindow = Window & { __pbAdminInstallPrompt?: InstallPrompt | null };

export function useAdminInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [installing, setInstalling] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    const installWindow = window as AdminInstallWindow;
    const display = window.matchMedia("(display-mode: standalone)");
    const ios = navigator as Navigator & { standalone?: boolean };
    const syncDisplay = () => {
      const installed = display.matches || ios.standalone === true;
      setStandalone(installed);
      if (installed) { setPrompt(null); installWindow.__pbAdminInstallPrompt = null; }
    };
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      if (!display.matches && !ios.standalone) {
        installWindow.__pbAdminInstallPrompt = event as InstallPrompt;
        setPrompt(event as InstallPrompt);
      }
    };
    const readStoredPrompt = () => {
      if (installWindow.__pbAdminInstallPrompt) capturePrompt(installWindow.__pbAdminInstallPrompt);
    };
    const installed = () => { setStandalone(true); setPrompt(null); installWindow.__pbAdminInstallPrompt = null; };
    const agent = navigator.userAgent;
    setIsIosSafari(/iPhone|iPad|iPod/i.test(agent) && /Safari/i.test(agent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(agent));
    syncDisplay();
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("pb-admin-install-ready", readStoredPrompt);
    readStoredPrompt();
    window.addEventListener("appinstalled", installed);
    display.addEventListener("change", syncDisplay);
    // Refresh an existing customer worker so its admin cache bypass takes effect.
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistration("/").then(registration => registration?.update()).catch(() => {});
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("pb-admin-install-ready", readStoredPrompt);
      window.removeEventListener("appinstalled", installed);
      display.removeEventListener("change", syncDisplay);
    };
  }, []);

  async function install() {
    if (!prompt || standalone || running.current) return;
    running.current = true;
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setStandalone(true);
    } catch {
      // The browser may cancel or invalidate a deferred prompt.
    } finally {
      const installWindow = window as AdminInstallWindow;
      if (installWindow.__pbAdminInstallPrompt === prompt) installWindow.__pbAdminInstallPrompt = null;
      setPrompt(null);
      running.current = false;
      setInstalling(false);
    }
  }

  return { showInstallFallback: !prompt && !standalone && !isIosSafari, canInstall: !!prompt && !standalone && !isIosSafari, isIosSafari: isIosSafari && !standalone, install, installing };
}
