const MAX_SCHEDULE_REQUEST_BYTES = 16 * 1024;
const MAX_REMINDER_ID_LENGTH = 160;
const MAX_PUSH_ENDPOINT_LENGTH = 2048;
const MAX_PUSH_AUTH_LENGTH = 256;
const MAX_PUSH_KEY_LENGTH = 512;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_SCHEDULES_PER_WINDOW = 100;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

type ReminderBody = {
  id: string;
  date: string;
  time?: string;
};

export type ReminderPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

export type ValidatedScheduleRequest = {
  reminder: ReminderBody;
  subscription: ReminderPushSubscription;
  due: Date;
};

type ScheduleWindow = {
  timestamps: number[];
  reservations: Map<string, number>;
};

const scheduleWindows = new Map<string, ScheduleWindow>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isBase64Url(value: unknown, maximum: number): value is string {
  return isBoundedString(value, maximum) && /^[A-Za-z0-9_-]+$/.test(value);
}

function validPushEndpoint(value: unknown): value is string {
  if (!isBoundedString(value, MAX_PUSH_ENDPOINT_LENGTH)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function readBoundedJson(request: Request): Promise<unknown | null> {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SCHEDULE_REQUEST_BYTES) return null;

  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SCHEDULE_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function validateScheduleRequest(value: unknown): ValidatedScheduleRequest | null {
  if (!isPlainObject(value) || !isPlainObject(value.reminder) || !isPlainObject(value.subscription)) return null;

  const reminder = value.reminder;
  const subscription = value.subscription;
  const keys = isPlainObject(subscription.keys) ? subscription.keys : null;
  const reminderId = reminder.id;
  const date = reminder.date;
  const time = reminder.time;
  const remindAt = value.remindAt;

  if (
    !isBoundedString(reminderId, MAX_REMINDER_ID_LENGTH) ||
    !isBoundedString(date, 10) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    (time !== undefined && (!isBoundedString(time, 5) || !/^\d{2}:\d{2}$/.test(time))) ||
    !isBoundedString(remindAt, 64) ||
    !validPushEndpoint(subscription.endpoint) ||
    !keys ||
    !isBase64Url(keys.auth, MAX_PUSH_AUTH_LENGTH) ||
    !isBase64Url(keys.p256dh, MAX_PUSH_KEY_LENGTH) ||
    (subscription.expirationTime !== undefined && subscription.expirationTime !== null && typeof subscription.expirationTime !== "number")
  ) {
    return null;
  }

  const due = new Date(remindAt);
  if (!Number.isFinite(due.getTime())) return null;

  return {
    reminder: { id: reminderId, date, ...(time ? { time } : {}) },
    subscription: {
      endpoint: subscription.endpoint,
      ...(subscription.expirationTime === undefined ? {} : { expirationTime: subscription.expirationTime as number | null }),
      keys: { auth: keys.auth, p256dh: keys.p256dh },
    },
    due,
  };
}

function prune(window: ScheduleWindow, now: number) {
  window.timestamps = window.timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  for (const [key, timestamp] of window.reservations) {
    if (now - timestamp >= DUPLICATE_WINDOW_MS) window.reservations.delete(key);
  }
}

export function reserveSchedule(userId: string, key: string, now = Date.now()):
  | { ok: true; release: () => void }
  | { ok: false; reason: "duplicate" | "rate_limited"; retryAfterSeconds?: number } {
  const window = scheduleWindows.get(userId) || { timestamps: [], reservations: new Map<string, number>() };
  scheduleWindows.set(userId, window);
  prune(window, now);

  if (window.reservations.has(key)) return { ok: false, reason: "duplicate" };
  if (window.timestamps.length >= MAX_SCHEDULES_PER_WINDOW) {
    const oldest = window.timestamps[0] || now;
    return { ok: false, reason: "rate_limited", retryAfterSeconds: Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000)) };
  }

  window.timestamps.push(now);
  window.reservations.set(key, now);
  return {
    ok: true,
    release: () => {
      const current = scheduleWindows.get(userId);
      if (!current) return;
      current.reservations.delete(key);
      const index = current.timestamps.indexOf(now);
      if (index >= 0) current.timestamps.splice(index, 1);
    },
  };
}

export function scheduleReservationKey(userId: string, request: ValidatedScheduleRequest) {
  return [userId, request.reminder.id, request.reminder.date, request.reminder.time || "09:00", request.subscription.endpoint].join("\u0000");
}

export function resetScheduleRateLimitsForTests() {
  scheduleWindows.clear();
}
