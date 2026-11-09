"use client";

import { useEffect, useRef, useState } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function useAdminInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [installing, setInstalling] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const ios = navigator as Navigator & { standalone?: boolean };
    const syncDisplay = () => {
      const installed = display.matches || ios.standalone === true;
      setStandalone(installed);
      if (installed) setPrompt(null);
    };
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      if (!display.matches && !ios.standalone) setPrompt(event as InstallPrompt);
    };
    const installed = () => { setStandalone(true); setPrompt(null); };
    const agent = navigator.userAgent;
    setIsIosSafari(/iPhone|iPad|iPod/i.test(agent) && /Safari/i.test(agent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(agent));
    syncDisplay();
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", installed);
    display.addEventListener("change", syncDisplay);
    // Refresh an existing customer worker so its admin cache bypass takes effect.
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistration("/").then(registration => registration?.update()).catch(() => {});
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
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
      setPrompt(null);
      running.current = false;
      setInstalling(false);
    }
  }

  return { showInstallFallback: !prompt && !standalone && !isIosSafari, canInstall: !!prompt && !standalone && !isIosSafari, isIosSafari: isIosSafari && !standalone, install, installing };
}
