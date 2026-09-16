import { createClient, type Session } from "@supabase/supabase-js";

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const cloudConfigured = Boolean(base && key);
const client = base && key ? createClient(base, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

function configuredClient() {
  if (!client) throw new Error("Cloud connection is not configured yet.");
  return client;
}

export async function signInWithGoogle() {
  const { error } = await configuredClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/" },
  });
  if (error) throw error;
}

export async function currentSession() {
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function watchSession(onChange: (session: Session | null) => void) {
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => onChange(session));
  return () => data.subscription.unsubscribe();
}

export async function cloudToken() {
  const session = await currentSession();
  if (!session) throw new Error("Continue with Google in Settings to use AI.");
  return session.access_token;
}

async function request(path: string, body?: unknown, token?: string) {
  if (!base || !key) throw new Error("Cloud connection is not configured yet.");
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

export async function signOut() {
  const { error } = await configuredClient().auth.signOut();
  if (error) throw error;
}
