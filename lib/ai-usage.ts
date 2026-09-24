type AiUsageResult = {
  allowed: boolean;
  reason?: string;
  plan?: string;
  voice_seconds?: number;
  voice_limit?: number;
  ai_calls?: number;
};

type ConsumeAiUsageResult =
  | { ok: true; usage: AiUsageResult }
  | { ok: false };

type PostgrestError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function consumeAiUsage({
  baseUrl,
  serviceRoleKey,
  userId,
  voiceSeconds,
  aiCalls,
  source,
}: {
  baseUrl: string;
  serviceRoleKey: string;
  userId: string;
  voiceSeconds: number;
  aiCalls: number;
  source: string;
}): Promise<ConsumeAiUsageResult> {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/rest/v1/rpc/consume_ai_usage`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        voice_seconds_to_add: Math.max(0, Math.ceil(voiceSeconds)),
        ai_calls_to_add: Math.max(0, Math.ceil(aiCalls)),
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error("[ai-usage] Supabase entitlement request failed", {
      source,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }

  const raw = await response.text();
  const parsed = parseJson(raw);

  if (!response.ok) {
    const databaseError = (parsed || {}) as PostgrestError;
    console.error("[ai-usage] Supabase entitlement RPC failed", {
      source,
      status: response.status,
      code: databaseError.code,
      message: databaseError.message,
      details: databaseError.details,
      hint: databaseError.hint,
      requestId:
        response.headers.get("sb-request-id") ||
        response.headers.get("x-request-id") ||
        undefined,
    });
    return { ok: false };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as AiUsageResult).allowed !== "boolean"
  ) {
    console.error("[ai-usage] Supabase entitlement RPC returned an invalid payload", {
      source,
      status: response.status,
      payloadType: Array.isArray(parsed) ? "array" : typeof parsed,
    });
    return { ok: false };
  }

  return { ok: true, usage: parsed as AiUsageResult };
}
