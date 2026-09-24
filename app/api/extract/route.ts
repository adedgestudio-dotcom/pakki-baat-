import { NextRequest } from "next/server";
import { consumeAiUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const DEPRECATED_GROQ_MODELS = new Set([
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
]);
function groqModel() {
  const configured = process.env.GROQ_EXTRACTION_MODEL?.trim();
  return configured && !DEPRECATED_GROQ_MODELS.has(configured)
    ? configured
    : DEFAULT_GROQ_MODEL;
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /aborted due to timeout/i.test(error.message))
  );
}

export async function GET() {
  return Response.json({
    enabled: Boolean(
      process.env.GROQ_API_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
  });
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (Number(req.headers.get("content-length") || 0) > 3_000_000) {
    return Response.json(
      { error: "Please use a file smaller than 2 MB." },
      { status: 413 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    const text = String(form.get("text") || "").slice(0, 6000);
    const date = String(form.get("today") || "");
    const mode = String(form.get("mode") || "extract");
    const duration = Math.max(0, Math.min(600, Math.ceil(Number(form.get("duration") || 0))));

    if (!apiKey) {
      return Response.json(
        { error: "Voice AI is not configured yet." },
        { status: 503 }
      );
    }

    if (mode !== "extract" && mode !== "transcribe") {
      return Response.json({ error: "Invalid capture mode." }, { status: 400 });
    }

    if (
      mode === "transcribe" &&
      (!(file instanceof File) || !file.type.startsWith("audio/"))
    ) {
      return Response.json(
        { error: "Choose a voice note to transcribe." },
        { status: 400 }
      );
    }

    const supportedFile =
      file instanceof File
        ? file.type.startsWith("image/")
          ? ["image/png", "image/jpeg", "image/webp"].includes(file.type)
          : [
              "audio/mpeg",
              "audio/mp4",
              "audio/webm",
              "audio/ogg",
              "audio/wav",
              "audio/x-wav",
              "video/webm",
              "application/octet-stream",
              "",
            ].includes(file.type) ||
            /\.(mp3|m4a|mp4|wav|webm|ogg)$/i.test(file.name)
        : true;

    if (file instanceof File && (file.size > 2_000_000 || !supportedFile)) {
      return Response.json(
        {
          error:
            "Use a PNG, JPG, WebP screenshot or MP3, M4A, WAV, WebM recording under 2 MB.",
        },
        { status: 400 }
      );
    }

    if (!(file instanceof File) && !text.trim()) {
      return Response.json({ error: "Add a message first." }, { status: 400 });
    }

    // AI access is tied to the signed-in user's subscription.
    const missingConfig = [
      !base && "NEXT_PUBLIC_SUPABASE_URL",
      !publicKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      !service && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    if (missingConfig.length) {
      return Response.json({ error: "AI account rights are not configured on the server." }, { status: 503 });
    }
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return Response.json({ error: "Continue with Google in Settings to use voice and AI." }, { status: 401 });
    }
    const userResponse = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: publicKey as string, Authorization: auth },
      signal: AbortSignal.timeout(10000),
    });
    if (!userResponse.ok) {
      return Response.json({ error: "Your sign-in expired. Please sign in again." }, { status: 401 });
    }
    const user = await userResponse.json();

    if (mode === "transcribe") {
      const usageResult = await consumeAiUsage({
        baseUrl: base as string,
        serviceRoleKey: service as string,
        userId: user.id,
        voiceSeconds: Math.max(1, duration),
        aiCalls: 0,
        source: "extract:transcribe",
      });
      if (!usageResult.ok) {
        return Response.json(
          { error: "AI account check is temporarily unavailable. Your Hisaab is safe â€” please try again." },
          { status: 503 }
        );
      }
      const usage = usageResult.usage;
      if (!usage?.allowed) {
        const error = usage?.reason === "voice_limit"
          ? "You have used this plan's voice minutes. You can still type entries."
          : "Your Pakki Baat subscription is not active.";
        return Response.json({ error, usage }, { status: 403 });
      }
    }

    if (mode !== "transcribe") {
      const usageResult = await consumeAiUsage({
        baseUrl: base as string,
        serviceRoleKey: service as string,
        userId: user.id,
        voiceSeconds: 0,
        aiCalls: 1,
        source: "extract:ai",
      });
      if (!usageResult.ok) {
        return Response.json(
          { error: "AI account check is temporarily unavailable. Your Hisaab is safe â€” please try again." },
          { status: 503 }
        );
      }
      const usage = usageResult.usage;
      if (!usage?.allowed) {
        return Response.json({ error: "Your Pakki Baat subscription is not active." }, { status: 403 });
      }
    }

    let transcript = text;

    // Transcribe audio if provided
    if (file instanceof File && !file.type.startsWith("image/")) {
      console.log("ðŸŽ¤ Transcribing audio...");
      const audio = new FormData();
      audio.set("file", file);
      audio.set(
        "model",
        process.env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo"
      );

      const trans = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: audio,
          signal: AbortSignal.timeout(60000),
        }
      );

      if (!trans.ok) {
        const error = await trans.text();
        console.error("âŒ Transcription error:", error);
        throw new Error(
          "The recording could not be transcribed. Try a shorter recording or type the details."
        );
      }

      const transcriptResult = await trans.json();
      transcript = String(transcriptResult.text || "").trim();
      console.log("âœ… Transcribed:", transcript.substring(0, 100));

      if (mode === "transcribe") {
        return transcript
          ? Response.json({ text: transcript.slice(0, 6000) })
          : Response.json(
              { error: "No speech was detected. Try recording again." },
              { status: 422 }
            );
      }
    }

    // Extract details using AI
    console.log("ðŸ¤– Extracting details with AI...");

    const systemPrompt = `You are extracting business commitment details. Return ONLY valid JSON with these fields:
{
  "customer": "string (customer name)",
  "work": "string (what needs to be done)",
  "total": number or null (total amount in rupees),
  "paid": number or null (amount already paid),
  "date": "string (YYYY-MM-DD format or empty)",
  "time": "string (HH:mm format or empty)",
  "source": "string (original message)"
}

Rules:
- Extract only factual information, don't invent anything
- Missing values should be empty string or null
- Total and paid are numbers (no currency symbols)
- Keep work under 500 characters
- Date format: YYYY-MM-DD
- Time format: HH:mm (24-hour)`;

    const userPrompt = `Reference date: ${
      /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "unknown"
    }\n\nCustomer message: ${transcript || "Read the attached screenshot."}`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: groqModel(),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 1000,
        }),
        signal: AbortSignal.timeout(35000),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("âŒ Extraction error:", error);
      throw new Error(
        "AI could not read the message. Try again or enter the details manually."
      );
    }

    const result = await response.json();
    const output = result.choices?.[0]?.message?.content;

    if (!output) {
      throw new Error("No usable details found. Please enter them manually.");
    }

    console.log("âœ… Extracted:", output.substring(0, 200));
    const draft = JSON.parse(output);
    return Response.json({ draft });
  } catch (e) {
    console.error("âŒ Error:", e);
    return Response.json(
      {
        error: isTimeoutError(e)
          ? "Transcription took too long. Tap Retry transcription to try again, or record a shorter voice note."
          : e instanceof Error
          ? e.message
          : "Capture failed. Please try manual entry.",
      },
      { status: 502 }
    );
  }
}

