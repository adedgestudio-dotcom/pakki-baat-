import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !anon || !service) return NextResponse.json({ error: "Cloud is not configured." }, { status: 503 });

  const userResponse = await fetch(base + "/auth/v1/user", {
    headers: { apikey: anon, Authorization: auth },
    cache: "no-store",
  });
  if (!userResponse.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await userResponse.json();

  const month = new Date().toISOString().slice(0, 7) + "-01";
  const usageResponse = await fetch(
    base + "/rest/v1/ai_monthly_usage?select=voice_seconds&period_month=eq." + month + "&owner_id=eq." + encodeURIComponent(user.id),
    {
      headers: { apikey: service, Authorization: "Bearer " + service },
      cache: "no-store",
    }
  );
  if (!usageResponse.ok) return NextResponse.json({ error: "Could not load voice usage." }, { status: 503 });
  const rows = await usageResponse.json();

  return NextResponse.json(
    { voice_seconds: Math.max(0, Number(rows?.[0]?.voice_seconds || 0)) },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
