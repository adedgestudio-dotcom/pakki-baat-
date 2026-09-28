import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !service) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  try {
    const headers = { apikey: service, Authorization: "Bearer " + service };

    const [usersRes, claimsRes, subsRes] = await Promise.all([
      fetch(base + "/auth/v1/admin/users?per_page=1000", { headers, cache: "no-store" }),
      fetch(base + "/rest/v1/trial_owner_claims?select=owner_id,claimed_at", { headers, cache: "no-store" }),
      fetch(base + "/rest/v1/subscriptions?select=owner_id,plan,period_start", { headers, cache: "no-store" }),
    ]);

    if (!usersRes.ok || !claimsRes.ok || !subsRes.ok) throw new Error("Could not load existing trial accounts.");

    const users = (await usersRes.json()).users || [];
    const claims = await claimsRes.json();
    const subs = await subsRes.json();

    const used = new Map<string,string>();
    for (const row of claims || []) used.set(row.owner_id, row.claimed_at);
    for (const row of subs || []) {
      if (row.plan === "trial" && !used.has(row.owner_id)) used.set(row.owner_id, row.period_start);
    }

    const rows = users.flatMap((user:any) => {
      const email = String(user.email || "").trim().toLowerCase();
      const claimedAt = used.get(user.id);
      if (!email || !claimedAt) return [];
      const emailHash = createHash("sha256").update("pakki-baat-trial-email-v1:" + email).digest("hex");
      return [{ email_hash: emailHash, claimed_at: claimedAt }];
    });

    if (rows.length) {
      const insert = await fetch(base + "/rest/v1/trial_email_claims?on_conflict=email_hash", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!insert.ok) throw new Error((await insert.text()) || "Could not save trial email history.");
    }

    return NextResponse.json({ ok: true, protectedAccounts: rows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Backfill failed." }, { status: 500 });
  }
}
