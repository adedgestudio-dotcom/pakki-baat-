import { notFound } from "next/navigation";
import QaLoginForm from "./qa-login-form";
export const dynamic = "force-dynamic";

export default function QaLoginPage() {
  const staging = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") === "https://jplxtqiryjnsdruqxgbh.supabase.co";
  if (process.env.VERCEL_ENV !== "preview" || !staging) notFound();
  return <QaLoginForm />;
}
