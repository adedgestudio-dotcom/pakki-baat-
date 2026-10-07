import webpush from "web-push";

export const runtime = "nodejs";

async function authenticatedUserId(request: Request) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const auth = request.headers.get("authorization") || "";
  if (!base || !publicKey || !auth.startsWith("Bearer ")) return null;
  const response = await fetch(base + "/auth/v1/user", {
    headers: { apikey: publicKey, Authorization: auth },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return typeof user?.id === "string" ? user.id : null;
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId(request);
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });

  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:support@zorivo.in";
  if (!publicKey || !privateKey) return Response.json({ error: "Push is not configured." }, { status: 503 });

  const body = await request.json().catch(() => null);
  const subscription = body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.auth || !subscription?.keys?.p256dh) {
    return Response.json({ error: "No valid push subscription." }, { status: 400 });
  }

  // Re-check server backup age. The client cannot force a warning for a healthy account.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !serviceKey) return Response.json({ error: "Backup check is not configured." }, { status: 503 });

  const backupResponse = await fetch(
    base + "/rest/v1/workspace_backups?owner_id=eq." + encodeURIComponent(userId) + "&select=created_at&order=created_at.desc&limit=1",
    { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } }
  );
  if (!backupResponse.ok) return Response.json({ error: "Could not verify backup status." }, { status: 503 });
  const rows = await backupResponse.json().catch(() => []);
  const latest = rows?.[0]?.created_at ? new Date(rows[0].created_at).getTime() : NaN;
  if (!Number.isFinite(latest) || Date.now() - latest < 3 * 24 * 60 * 60 * 1000) {
    return Response.json({ ok: true, notified: false });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  await webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: "Pakki Baat backup needs attention",
      body: "Your data hasn’t backed up for 3 days. Tap to check Backup.",
      url: "/?open=backup",
      notificationTag: "pakki-baat-backup-warning",
    }),
    { TTL: 60 * 60 * 24, urgency: "normal" }
  );
  return Response.json({ ok: true, notified: true });
}
