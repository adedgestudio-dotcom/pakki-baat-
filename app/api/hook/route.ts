import { createHash, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { parseAdminPushEvent } from "@/lib/admin-push-event";

export const runtime = "nodejs";

function validSecret(supplied: string): boolean {
  const expected = process.env.ADMIN_HOOK_SECRET || "";
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return b.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
}

async function db(path: string, init: RequestInit = {}) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) throw new Error("Admin push database is not configured");
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init, cache: "no-store",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`Admin push database request failed: ${response.status}`);
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

export async function POST(request: Request) {
  if (!validSecret(request.headers.get("X-Hook-Secret") || ""))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const event = parseAdminPushEvent(await request.json().catch(() => null));
  if (!event) return Response.json({ error: "Invalid event" }, { status: 400 });
  try {
    const settings = await db("admin_push_settings?select=payments,trials,signups&id=eq.true");
    if (settings?.[0]?.[event.kind] === false) return Response.json({ ok: true, muted: true });
    const digest = createHash("sha256").update(event.key).digest("hex");
    const claimed = await db("rpc/claim_admin_push_event", { method: "POST", body: JSON.stringify({ p_key: digest }) });
    if (claimed !== true) return Response.json({ ok: true, duplicate: true });
    const rows = await db("admin_push_subscriptions?select=subscription");
    const publicKey = process.env.VAPID_PUBLIC_KEY || "";
    const privateKey = process.env.VAPID_PRIVATE_KEY || "";
    if (!publicKey || !privateKey || !Array.isArray(rows) || !rows.length)
      return Response.json({ ok: true, sent: 0 });
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@zorivo.in", publicKey, privateKey);
    const payload = JSON.stringify({ title: event.title, body: "", url: event.url, notificationTag: digest });
    const results = await Promise.allSettled(rows.map((row: { subscription: webpush.PushSubscription }) =>
      webpush.sendNotification(row.subscription, payload, { TTL: 300, urgency: "high" })));
    return Response.json({ ok: true, sent: results.filter(result => result.status === "fulfilled").length });
  } catch {
    // Hook delivery and push failures must never cause a database event to be retried indefinitely.
    return Response.json({ ok: true, sent: 0 });
  }
}
