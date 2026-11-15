"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { version } from "@/package.json";
import { readLedgerDirty } from "@/lib/cloud";
import { releaseCardVisible, releaseDiffers, shouldAutoUpdate, type ReleaseIdentity } from "@/lib/release-update";

const CURRENT_RELEASE: ReleaseIdentity = {
  version,
  commit: process.env.NEXT_PUBLIC_PB_BUILD_COMMIT || null,
};
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export default function ReleaseUpdateCard({ blocked, online, ownerId, busy, cloudBusy }: {
  blocked: boolean; online: boolean; ownerId: string | null; busy: boolean; cloudBusy: () => boolean;
}) {
  const [latestRelease, setLatestRelease] = useState<ReleaseIdentity | null>(null);
  const [updating, setUpdating] = useState(false);
  const [nudge, setNudge] = useState(false);
  const updatingRef = useRef(false);
  const lastActivityRef = useRef(0);
  const visible = releaseCardVisible(CURRENT_RELEASE, latestRelease, online);

  const updateApp = useCallback(async () => {
    if (blocked || updatingRef.current || !navigator.onLine) return;
    updatingRef.current = true;
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
      updatingRef.current = false;
      setUpdating(false);
    }
  }, [blocked]);

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
    window.addEventListener("focus", checkForUpdate);
    window.addEventListener("online", checkForUpdate);
    const interval = window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", checkForUpdate);
      window.removeEventListener("online", checkForUpdate);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const active = visible || updating;
    document.body.classList.toggle("has-release-bar", active);
    if (!active) return;
    return () => document.body.classList.remove("has-release-bar");
  }, [visible, updating]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setNudge(true), 10 * 60 * 1000);
    return () => { window.clearTimeout(timer); setNudge(false); };
  }, [visible]);

  useEffect(() => {
    const onActivity = () => { lastActivityRef.current = Date.now(); };
    onActivity();
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);

  useEffect(() => {
    if (!visible || updating) return;
    const checkIdle = () => {
      if (!window.matchMedia("(min-width: 801px)").matches || document.visibilityState !== "visible" || !ownerId || updatingRef.current) return;
      if (shouldAutoUpdate({
        idleMs: Date.now() - lastActivityRef.current,
        blocked,
        dirty: readLedgerDirty(ownerId) !== null,
        online: online && navigator.onLine,
        busy: busy || cloudBusy(),
      })) void updateApp();
    };
    const interval = window.setInterval(checkIdle, 5000);
    checkIdle();
    return () => window.clearInterval(interval);
  }, [visible, updating, blocked, online, ownerId, busy, cloudBusy, updateApp]);

  if (!visible && !updating) return null;
  return <aside className="release-update-card" role="status" aria-live="polite">
    <span><strong>A new version of Pakki Baat is ready.</strong>{blocked && <small>Finish or close your entry before updating.</small>}</span>
    <button type="button" className={nudge ? "release-update-nudge" : undefined} onClick={() => void updateApp()} disabled={blocked || updating}>
      {updating ? "Updating…" : "Update now"}
    </button>
  </aside>;
}
