import { NextRequest, NextResponse } from "next/server";
import { consumeAiUsage } from "@/lib/ai-usage";

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

  // Use the same database RPC/bucket as transcription itself. Passing zero
  // seconds is a read-only usage snapshot, so reopen/reload can never disagree
  // with the counter that meters recordings.
  const usageResult = await consumeAiUsage({
    baseUrl: base,
    serviceRoleKey: service,
    userId: user.id,
    voiceSeconds: 0,
    aiCalls: 0,
    source: "voice-usage:read",
  });
  if (!usageResult.ok) return NextResponse.json({ error: "Could not load voice usage." }, { status: 503 });

  const usage = usageResult.usage;
  if (!usage.allowed && usage.reason === "subscription_inactive") {
    return NextResponse.json({ error: "Your Pakki Baat subscription is not active." }, { status: 403 });
  }

  return NextResponse.json(
    {
      voice_seconds: Math.max(0, Number(usage.voice_seconds || 0)),
      voice_limit: Math.max(0, Number(usage.voice_limit || 0)),
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
