type RpcResult = Record<string, unknown> | null;

function config() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !service) return null;
  return { base, headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" } };
}

async function rpc(name: string, payload: Record<string, unknown>): Promise<RpcResult> {
  const current = config();
  if (!current) return null;
  const response = await fetch(current.base + "/rest/v1/rpc/" + name, { method: "POST", headers: current.headers, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error("Reminder delivery ledger request failed.");
  return await response.json() as RpcResult;
}

export async function claimV5Runner(scheduleId: string, generation: number, runnerId: string) {
  "use step";
  const result = await rpc("claim_v5_reminder_runner", { p_schedule_id: scheduleId, p_generation: generation, p_runner_id: runnerId });
  return result?.claimed === true;
}

export async function beginV5Delivery(scheduleId: string, generation: number, occurrenceAt: string, runnerId: string) {
  const result = await rpc("begin_v5_reminder_delivery", { p_schedule_id: scheduleId, p_generation: generation, p_occurrence_at: occurrenceAt, p_runner_id: runnerId });
  return result?.claimed === true;
}

export async function finishV5Delivery(scheduleId: string, generation: number, occurrenceAt: string) {
  await rpc("finish_v5_reminder_delivery", { p_schedule_id: scheduleId, p_generation: generation, p_occurrence_at: occurrenceAt });
}

export async function releaseV5Delivery(scheduleId: string, generation: number, occurrenceAt: string) {
  await rpc("release_v5_reminder_delivery", { p_schedule_id: scheduleId, p_generation: generation, p_occurrence_at: occurrenceAt });
}
