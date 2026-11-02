import { createEntryPhotoHandlers } from "@/lib/entry-photo-server";

export const runtime = "nodejs";
const handlers = createEntryPhotoHandlers(() => ({
  base: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
}));
export const GET = handlers.GET;
export const POST = handlers.POST;
