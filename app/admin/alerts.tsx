"use client";
import { useEffect, useState } from "react";

type Kind = "payments" | "trials" | "signups";
type Settings = Record<Kind, boolean>;
const labels: Record<Kind, string> = { payments: "Payment requests", trials: "Free trial claims", signups: "New signups" };
const kinds: Kind[] = ["payments", "trials", "signups"];

function vapidBytes(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function waitForActive(registration: ServiceWorkerRegistration) {
  if (registration.active) return;
  const worker = registration.installing || registration.waiting;
  if (!worker) throw new Error("Admin push worker is unavailable.");
  await new Promise<void>((resolve, reject) => {
    const changed = () => {
      if (worker.state === "activated") { worker.removeEventListener("statechange", changed); resolve(); }
      if (worker.state === "redundant") { worker.removeEventListener("statechange", changed); reject(new Error("Admin push worker could not start.")); }
    };
    worker.addEventListener("statechange", changed);
    changed();
  });
}

export default function AdminAlerts() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [enabledHere, setEnabledHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/alerts", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load alert settings.");
        const data = await response.json();
        if (cancelled) return;
        setSettings(data.settings);
        setPublicKey(data.publicKey);
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration("/admin");
          if (!cancelled && registration?.active?.scriptURL.endsWith("/admin-sw.js"))
            setEnabledHere(Boolean(await registration.pushManager.getSubscription()));
        }
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load alerts."); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function toggle(kind: Kind) {
    if (!settings || busy) return;
    const next = !settings[kind];
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/alerts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, enabled: next }) });
      if (!response.ok) throw new Error("Could not save alert setting.");
      setSettings({ ...settings, [kind]: next });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save alert setting."); }
    finally { setBusy(false); }
  }

  async function enable() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push is unavailable on this device.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Allow notifications in your browser settings first.");
      const registration = await navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" });
      await waitForActive(registration);
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: vapidBytes(publicKey),
      });
      const response = await fetch("/api/admin/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
      if (!response.ok) throw new Error("Could not save this device for alerts.");
      setEnabledHere(true); setMessage("Push alerts enabled on this device.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not enable push alerts."); }
    finally { setBusy(false); }
  }

  async function disable() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/admin");
      const subscription = registration?.active?.scriptURL.endsWith("/admin-sw.js")
        ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        const response = await fetch("/api/admin/alerts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
        if (!response.ok) throw new Error("Could not remove this device.");
        await subscription.unsubscribe();
      }
      setEnabledHere(false); setMessage("Push alerts disabled on this device.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not disable push alerts."); }
    finally { setBusy(false); }
  }

  return <section className="admin-card admin-wide admin-alerts">
    <div className="admin-card-head"><div><span>ALERTS</span><h2>Push notifications</h2><p className="admin-help">Choose which admin events send a push. These settings apply to every admin device.</p></div></div>
    <div className="admin-alerts-device"><strong>This device</strong><button type="button" disabled={busy || !settings} onClick={() => void (enabledHere ? disable() : enable())}>{enabledHere ? "Disable push" : "Enable push"}</button></div>
    <div className="admin-alerts-list">{kinds.map(kind => <label key={kind}><span>{labels[kind]}</span><input type="checkbox" checked={settings?.[kind] ?? true} disabled={!settings || busy} onChange={() => void toggle(kind)} /></label>)}</div>
    {message && <p role="status" className="admin-help">{message}</p>}
  </section>;
}
