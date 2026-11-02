import lock from "@/package-lock.json";

export const runtime = "nodejs";
export function GET() {
  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    environment: process.env.VERCEL_ENV || "local",
    supabaseProject: process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/)?.[1] || null,
    dependencies: {
      next: lock.packages["node_modules/next"].version,
      workflow: lock.packages["node_modules/workflow"].version,
      react: lock.packages["node_modules/react"].version,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
