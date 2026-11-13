export type AdminPushKind = "payments" | "trials" | "signups";
export type AdminPushEvent = { kind: AdminPushKind; key: string; title: string; url: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maskedEmail = /^[^@\s*][*]{3,}@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function parseAdminPushEvent(value: unknown): AdminPushEvent | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.type === "payment") {
    if (typeof input.id !== "string" || !uuid.test(input.id) ||
        !["basic", "smart", "business"].includes(String(input.plan)) ||
        !Number.isSafeInteger(input.amount) || (input.amount as number) <= 0 || (input.amount as number) > 1_000_000) return null;
    const plan = String(input.plan);
    return { kind: "payments", key: `payment:${input.id}`, title: `Payment request: ${plan[0].toUpperCase()}${plan.slice(1)} ₹${input.amount}`, url: "/admin?tab=payments" };
  }
  if (input.type === "trial") {
    if (typeof input.id !== "string" || !uuid.test(input.id) ||
        typeof input.claimed_at !== "string" || !Number.isFinite(Date.parse(input.claimed_at))) return null;
    return { kind: "trials", key: `trial:${input.id}:${input.claimed_at}`, title: "New free trial claimed", url: "/admin?tab=users" };
  }
  if (input.type === "signup") {
    if (typeof input.email_masked !== "string" ||
        (input.email_masked !== "unknown" && !maskedEmail.test(input.email_masked)) ||
        typeof input.created_at !== "string" || !Number.isFinite(Date.parse(input.created_at))) return null;
    return { kind: "signups", key: `signup:${input.email_masked}:${input.created_at}`,
      title: `New user: ${input.email_masked}`, url: "/admin?tab=users" };
  }
  return null;
}
