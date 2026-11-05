/**
 * Groq's JSON mode sometimes rejects the model's own output with
 *   400 {"error":{"code":"json_validate_failed","message":"Failed to validate JSON ..."}}
 * This is transient: the same request usually succeeds on a second try.
 */
export const ASSISTANT_HICCUP_MESSAGE = "The assistant had a hiccup. Please try again.";

export function isJsonValidationText(status: number, body: string): boolean {
  return status === 400 && /json_validate_failed|failed to validate json/i.test(body);
}

/** Runs the request; if Groq answers 400 json_validate_failed, runs it once more. */
export async function withJsonValidationRetry(
  request: () => Promise<Response>
): Promise<Response> {
  const first = await request();
  if (first.status !== 400) return first;
  let body = "";
  try {
    // Read a clone so the caller can still read the original body.
    body = await first.clone().text();
  } catch {
    return first;
  }
  if (!isJsonValidationText(first.status, body)) return first;
  console.warn("Groq returned json_validate_failed; retrying once.");
  return request();
}
