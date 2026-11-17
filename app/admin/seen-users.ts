const key = "pb_admin_seen_users";
const limit = 500;

export function readSeenUsers(storage: Pick<Storage, "getItem">): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(-limit) : [];
  } catch { return []; }
}

export function dismissNewUser(storage: Pick<Storage, "setItem">, seen: readonly string[], id: string): string[] {
  const next = [...seen.filter(item => item !== id), id].slice(-limit);
  try { storage.setItem(key, JSON.stringify(next)); } catch { /* Keep the dismissal for this session. */ }
  return next;
}
