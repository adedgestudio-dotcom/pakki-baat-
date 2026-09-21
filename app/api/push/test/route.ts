import webpush from "web-push";

export const runtime = "nodejs";

async function isAuthenticated(request: Request) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const auth = request.headers.get("authorization") || "";
  if (!base || !publicKey || !auth.startsWith("Bearer ")) return false;

  const response = await fetch(base + "/auth/v1/user", {
    headers: { apikey: publicKey, Authorization: auth },
  });
  return response.ok;
}

export async function POST(request: Request) {
  if (!(await isAuthenticated(request))) {
    return Response.json({ error: "Sign in to test push notifications." }, { status: 401 });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:support@zorivo.in";

  if (!publicKey || !privateKey) {
    return Response.json({ error: "Push notifications are not configured yet." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const subscription = body?.subscription;

  if (!subscription?.endpoint || !subscription?.keys?.auth || !subscription?.keys?.p256dh) {
    return Response.json({ error: "No valid push subscription." }, { status: 400 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  await webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: "Pakki Baat reminder",
      body: "Closed-app notifications are working ✓",
      url: "/",
      reminderId: "test",
    }),
    { TTL: 60, urgency: "high" }
  );

  return Response.json({ ok: true });
}
