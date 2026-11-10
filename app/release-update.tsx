"use client";

import { useEffect, useState } from "react";
import { version } from "@/package.json";
import { releaseCardVisible, releaseDiffers, type ReleaseIdentity } from "@/lib/release-update";

const CURRENT_RELEASE: ReleaseIdentity = {
  version,
  commit: process.env.NEXT_PUBLIC_PB_BUILD_COMMIT || null,
};
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export default function ReleaseUpdateCard({ blocked, online }: { blocked: boolean; online: boolean }) {
  const [latestRelease, setLatestRelease] = useState<ReleaseIdentity | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let disposed = false;
    async function checkForUpdate() {
      if (!navigator.onLine) return;
      try {
        const response = await fetch("/api/release-info", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;
        const data = await response.json() as Partial<ReleaseIdentity>;
        const latest = {
          version: typeof data.version === "string" ? data.version : "",
          commit: typeof data.commit === "string" && data.commit ? data.commit : null,
        };
        if (!disposed) setLatestRelease(latest);
        if (releaseDiffers(CURRENT_RELEASE, latest) && "serviceWorker" in navigator) {
          void navigator.serviceWorker.getRegistration("/").then(registration => registration?.update()).catch(() => {});
        }
      } catch {
        // Offline and transient release checks do not affect the workspace.
      }
    }
    void checkForUpdate();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, []);

  async function updateApp() {
    if (blocked || updating || !navigator.onLine) return;
    setUpdating(true);
    try {
      const registration = "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration("/")
        : undefined;
      await registration?.update();
      const waiting = registration?.waiting;
      if (waiting) {
        let reloaded = false;
        const reload = () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        };
        navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
        waiting.postMessage("SKIP_WAITING");
        window.setTimeout(reload, 3000);
        return;
      }
      window.location.reload();
    } catch {
      setUpdating(false);
    }
  }

  if (!releaseCardVisible(CURRENT_RELEASE, latestRelease, online)) return null;
  return <aside className="release-update-card" role="status" aria-live="polite">
    <span><strong>New version ready</strong>{blocked && <small>Finish or close your entry before updating.</small>}</span>
    <button type="button" onClick={() => void updateApp()} disabled={blocked || updating}>
      {updating ? "Updating..." : "Update"}
    </button>
  </aside>;
}
