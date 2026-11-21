import webpush from "web-push";
import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
type Kind = "payments" | "trials" | "signups";
const kinds: Kind[] = ["payments", "trials", "signups"];

async function db(path: string, init: RequestInit = {}) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) throw new Error("Admin alerts are not configured");
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init, cache: "no-store",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`Admin alerts database request failed: ${response.status}`);
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const rows = await db("admin_push_settings?select=payments,trials,signups&id=eq.true");
    return Response.json({ settings: rows?.[0] || { payments: true, trials: true, signups: true }, publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  } catch { return Response.json({ error: "Could not load alerts" }, { status: 503 }); }
}

export async function PUT(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !kinds.includes(body.kind) || typeof body.enabled !== "boolean")
    return Response.json({ error: "Invalid alert setting" }, { status: 400 });
  try {
    await db("admin_push_settings?id=eq.true", { method: "PATCH", body: JSON.stringify({ [body.kind]: body.enabled }) });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Could not save alert setting" }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (body?.test === true) {
    if (typeof body.endpoint !== "string" || body.endpoint.length > 2048 || !body.endpoint.startsWith("https://"))
      return Response.json({ error: "Invalid push endpoint" }, { status: 400 });
    try {
      const rows = await db("admin_push_subscriptions?select=subscription&endpoint=eq." + encodeURIComponent(body.endpoint));
      if (!rows?.[0]?.subscription) return Response.json({ error: "This device is not saved for alerts. Enable push again." }, { status: 404 });
      const publicKey = process.env.VAPID_PUBLIC_KEY || "", privateKey = process.env.VAPID_PRIVATE_KEY || "";
      if (!publicKey || !privateKey) return Response.json({ error: "Push is not configured on the server." }, { status: 503 });
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@zorivo.in", publicKey, privateKey);
      await webpush.sendNotification(rows[0].subscription, JSON.stringify({ title: "Pakki Baat Admin", body: "Test notification from Pakki Baat Admin - if you see this, push is working.", url: "/admin", notificationTag: "admin-push-test" }), { TTL: 300, urgency: "high" });
      return Response.json({ ok: true });
    } catch (error) {
      console.error("Admin test push failed", error);
      return Response.json({ error: "Could not send test notification. Check this device's notification settings or enable push again." }, { status: 503 });
    }
  }
  const subscription = body?.subscription;
  if (typeof subscription?.endpoint !== "string" || subscription.endpoint.length > 2048 ||
      !subscription.endpoint.startsWith("https://") ||
      typeof subscription?.keys?.auth !== "string" || !subscription.keys.auth ||
      typeof subscription?.keys?.p256dh !== "string" || !subscription.keys.p256dh)
    return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  try {
    await db("admin_push_subscriptions?on_conflict=endpoint", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ endpoint: subscription.endpoint, subscription }),
    });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Could not save push subscription" }, { status: 503 }); }
}

export async function DELETE(request: NextRequest) {
  if (!isAdmin(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.endpoint !== "string" || !body.endpoint.startsWith("https://"))
    return Response.json({ error: "Invalid endpoint" }, { status: 400 });
  try {
    await db("admin_push_subscriptions?endpoint=eq." + encodeURIComponent(body.endpoint), { method: "DELETE" });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Could not remove push subscription" }, { status: 503 }); }
}
