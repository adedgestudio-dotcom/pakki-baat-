export const runtime = "nodejs";

export async function GET() {
  const checks = {
    vapidPublicKey: Boolean(process.env.VAPID_PUBLIC_KEY),
    vapidPrivateKey: Boolean(process.env.VAPID_PRIVATE_KEY),
    supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };

  const missing = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return Response.json({
    enabled: missing.length === 0,
    checks,
    missing,
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
  });
}
