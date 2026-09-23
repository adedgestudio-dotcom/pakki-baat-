import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
let client: SupabaseClient | null = base && key ? createClient(base, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
let configPromise: Promise<SupabaseClient | null> | null = null;

export const cloudConfigured = true;

function makeClient() {
  if (!base || !key) return null;
  client ||= createClient(base, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

async function loadRuntimeConfig() {
  if (client) return client;
  if (typeof window === "undefined") return makeClient();
  configPromise ||= fetch("/api/public-config", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      const config = await response.json();
      base = String(config.supabaseUrl || base || "");
      key = String(config.supabaseAnonKey || key || "");
      return makeClient();
    })
    .catch(() => null);
  return configPromise;
}

async function configuredClient() {
  const ready = await loadRuntimeConfig();
  if (!ready) throw new Error("Cloud connection is not configured yet.");
  return ready;
}

export async function signInWithGoogle() {
  const { error } = await (await configuredClient()).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/" },
  });
  if (error) throw error;
}

export async function currentSession() {
  const ready = await loadRuntimeConfig();
  if (!ready) return null;
  const { data, error } = await ready.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function watchSession(onChange: (session: Session | null) => void) {
  let unsubscribe = () => {};
  void loadRuntimeConfig().then((ready) => {
    if (!ready) return;
    const { data } = ready.auth.onAuthStateChange((_event, session) => onChange(session));
    unsubscribe = () => data.subscription.unsubscribe();
  });
  return () => unsubscribe();
}

export async function cloudToken() {
  const session = await currentSession();
  if (!session) throw new Error("Continue with Google in Settings to use AI.");
  return session.access_token;
}

async function request(path: string, body?: unknown, token?: string) {
  await configuredClient();
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  const result = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(result?.message || result?.error_description || result?.msg || "Cloud request failed.");
  return result;
}

export async function saveCloud(snapshot: unknown) {
  await request("/rest/v1/rpc/save_workspace", { payload: snapshot }, await cloudToken());
}

export async function loadCloud() {
  const rows = await request("/rest/v1/workspaces?select=payload", undefined, await cloudToken());
  return rows[0]?.payload || null;
}


export async function claimFreeTrial() {
  if (typeof window === "undefined") return { allowed: true, reason: "server" };
  const storageKey = "pakki-baat-device-id-v1";
  let deviceId = localStorage.getItem(storageKey);
  if (!deviceId) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    deviceId = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(storageKey, deviceId);
  }
  const token = await cloudToken();
  const response = await fetch("/api/trial/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ deviceId }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "Could not check free trial.");
  return result as { allowed: boolean; reason: string };
}

export async function signOut() {
  const { error } = await (await configuredClient()).auth.signOut();
  if (error) throw error;
}
