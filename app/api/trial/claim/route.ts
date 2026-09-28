import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const token = auth.slice(7);
    const body = await request.json();
    const deviceId = String(body?.deviceId || "").trim();
    if (deviceId.length < 20 || deviceId.length > 200) return NextResponse.json({ error: "Invalid device" }, { status: 400 });

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!base || !anon || !service) return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });

    const userResponse = await fetch(base + "/auth/v1/user", { headers: { apikey: anon, Authorization: "Bearer " + token }, cache: "no-store" });
    if (!userResponse.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await userResponse.json();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const deviceHash = createHash("sha256").update("pakki-baat-trial-v1:" + deviceId).digest("hex");
    const rpc = await fetch(base + "/rest/v1/rpc/claim_trial", {
      method: "POST",
      headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id, supplied_device_hash: deviceHash }),
      cache: "no-store",
    });
    const raw = await rpc.text();
    if (!rpc.ok) return NextResponse.json({ error: "Could not check free trial" }, { status: 500 });
    const result = raw ? JSON.parse(raw) : null;
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not check free trial" }, { status: 500 });
  }
}
