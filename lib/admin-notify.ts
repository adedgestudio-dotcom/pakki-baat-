/**
 * Owner alerts for new payment requests and new free-trial claims.
 *
 * - Email through Resend to ADMIN_NOTIFY_EMAIL (RESEND_API_KEY, TRIAL_EMAIL_FROM,
 *   the same settings app/api/cron/trial-expiry uses).
 * - Also Telegram when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
 * - Each channel has a 3-second timeout, is skipped when its settings are
 *   missing, and never throws. Callers run it inside after() so the user's
 *   response is never delayed.
 * - Never sends a PIN, a token, a payment-proof URL or an image: such lines are
 *   dropped and any configured secret value is redacted.
 */

export type AdminAlert = { title: string; lines: string[] };
export type ChannelResult = "sent" | "skipped" | "failed";
export type AdminAlertResult = { email: ChannelResult; telegram: ChannelResult };

export const ADMIN_ALERT_TIMEOUT_MS = 3000;
const DEFAULT_FROM = "Pakki Baat <onboarding@resend.dev>";

// A line that labels a secret ("PIN: 1234", "token=…", "Bearer …"), points at a
// payment proof or carries an inline image is dropped entirely. Plain words in
// an email address such as pin.sharma@… are not affected.
const BLOCKED_LINE =
  /\b(pin|passcode|otp|password|token|authorization|secret|api[ _-]?key|service[ _-]?role(?: key)?)\s*[:=]|\bbearer\s+\S|payment-proofs|\/storage\/v1\/|data:image\/|;base64,/i;

type Secrets = { keys: string[]; pins: string[] };

function secretValues(): Secrets {
  const env = process.env;
  const present = (values: (string | undefined)[], min: number) =>
    values.filter((value): value is string => typeof value === "string" && value.trim().length >= min);
  return {
    // Long secrets are redacted wherever they appear.
    keys: present(
      [
        env.RESEND_API_KEY,
        env.TELEGRAM_BOT_TOKEN,
        env.SUPABASE_SERVICE_ROLE_KEY,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        env.CRON_SECRET,
        env.ADMIN_SESSION_SECRET,
        env.GROQ_API_KEY,
        env.GROQ_KEY,
        env.VAPID_PRIVATE_KEY,
      ],
      8
    ),
    // PINs can be short, so they are redacted only as a whole word.
    pins: present([env.ADMIN_PIN, env.QA_ADMIN_PIN], 4),
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function clean(text: string, secrets: Secrets): string {
  let out = String(text).replace(/[\r\n\t]+/g, " ").trim().slice(0, 300);
  for (const key of secrets.keys) out = out.split(key).join("[redacted]");
  for (const pin of secrets.pins) {
    out = out.replace(new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(pin.trim())}(?![A-Za-z0-9])`, "g"), "$1[redacted]");
  }
  return out;
}

/** Title and lines exactly as they will be sent, after the safety filter. */
export function safeAlert(alert: AdminAlert): AdminAlert {
  const secrets = secretValues();
  const title = BLOCKED_LINE.test(alert.title) ? "Pakki Baat alert" : clean(alert.title, secrets);
  const lines = (alert.lines || [])
    .map((line) => clean(line, secrets))
    .filter((line) => line && !BLOCKED_LINE.test(line));
  return { title, lines };
}

/** "6 Nov 2026, 3:04 pm IST" */
export function formatIst(date: Date = new Date()): string {
  return (
    date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " IST"
  );
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function post(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
}

async function sendEmail(alert: AdminAlert, timeoutMs: number): Promise<ChannelResult> {
  const key = process.env.RESEND_API_KEY || "";
  const to = (process.env.ADMIN_NOTIFY_EMAIL || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (!key || !to.length) return "skipped";
  const from = process.env.TRIAL_EMAIL_FROM || DEFAULT_FROM;
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:560px;color:#17352c"><h2 style="font-size:18px">' +
    escapeHtml(alert.title) +
    "</h2><p>" +
    alert.lines.map(escapeHtml).join("<br>") +
    "</p></div>";
  await post(
    "https://api.resend.com/emails",
    { from, to, subject: alert.title, text: [alert.title, "", ...alert.lines].join("\n"), html },
    { Authorization: "Bearer " + key },
    timeoutMs
  );
  return "sent";
}

async function sendTelegram(alert: AdminAlert, timeoutMs: number): Promise<ChannelResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = process.env.TELEGRAM_CHAT_ID || "";
  if (!token || !chatId) return "skipped";
  await post(
    "https://api.telegram.org/bot" + token + "/sendMessage",
    { chat_id: chatId, text: [alert.title, "", ...alert.lines].join("\n"), disable_web_page_preview: true },
    {},
    timeoutMs
  );
  return "sent";
}

async function attempt(channel: string, send: () => Promise<ChannelResult>): Promise<ChannelResult> {
  try {
    return await send();
  } catch (error) {
    // Only the channel and a short reason; never the request or its secrets.
    const reason = error instanceof Error ? error.name + ": " + error.message.slice(0, 80) : "unknown";
    console.warn(`Admin alert via ${channel} failed (${reason}).`);
    return "failed";
  }
}

/** Sends the alert on every configured channel. Never throws. */
export async function sendAdminAlert(
  alert: AdminAlert,
  options: { timeoutMs?: number } = {}
): Promise<AdminAlertResult> {
  try {
    const timeoutMs = options.timeoutMs ?? ADMIN_ALERT_TIMEOUT_MS;
    const safe = safeAlert(alert);
    const [email, telegram] = await Promise.all([
      attempt("email", () => sendEmail(safe, timeoutMs)),
      attempt("Telegram", () => sendTelegram(safe, timeoutMs)),
    ]);
    return { email, telegram };
  } catch {
    return { email: "failed", telegram: "failed" };
  }
}

/** The fields every owner alert carries, in a fixed order. */
export function ownerAlertLines(details: {
  type: string;
  plan: string;
  amount: number;
  reference: string;
  email: string;
  at?: Date;
  adminUrl: string;
}): string[] {
  return [
    "Type: " + details.type,
    "Plan: " + details.plan,
    "Amount: ₹" + details.amount.toLocaleString("en-IN"),
    "Payment reference: " + details.reference,
    "User: " + (details.email || "(no email)"),
    "Time: " + formatIst(details.at),
    "Admin: " + details.adminUrl,
  ];
}

/** Absolute /admin link from NEXT_PUBLIC_APP_URL, else the request's own origin. */
export function adminLink(requestUrl: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").trim() || new URL(requestUrl).origin;
  return base.replace(/\/+$/, "") + "/admin";
}
