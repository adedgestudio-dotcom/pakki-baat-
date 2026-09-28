import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!base || !anon) return NextResponse.json({ error: "Cloud is not configured." }, { status: 503 });

  const userResponse = await fetch(base + "/auth/v1/user", {
    headers: { apikey: anon, Authorization: auth },
    cache: "no-store",
  });
  if (!userResponse.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(
    { serverNow: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
