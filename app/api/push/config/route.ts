export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    enabled: Boolean(
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
  });
}
