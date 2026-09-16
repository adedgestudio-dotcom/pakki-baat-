import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return Response.json({
    enabled: Boolean(
      process.env.OPENAI_API_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
  });
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log("🔍 API Extract called");
  console.log("✅ API Key exists:", !!apiKey);
  console.log("✅ Supabase configured:", !!base && !!publicKey && !!service);

  if (!apiKey || !base || !publicKey || !service) {
    return Response.json(
      {
        error:
          "AI is not configured. You can still enter the details manually.",
      },
      { status: 503 }
    );
  }

  if (Number(req.headers.get("content-length") || 0) > 3_000_000) {
    return Response.json(
      { error: "Please use a file smaller than 2 MB." },
      { status: 413 }
    );
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Continue with Google in Settings to use AI." },
      { status: 401 }
    );
  }

  try {
    // Verify user
    const userResponse = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: publicKey, Authorization: auth },
      signal: AbortSignal.timeout(10000),
    });

    if (!userResponse.ok) {
      return Response.json(
        { error: "Your sign-in expired. Please sign in again." },
        { status: 401 }
      );
    }

    const user = await userResponse.json();
    const form = await req.formData();
    const file = form.get("file");
    const text = String(form.get("text") || "").slice(0, 6000);
    const date = String(form.get("today") || "");
    const mode = String(form.get("mode") || "extract");

    console.log("📝 Mode:", mode);
    console.log("📄 Has file:", !!file);
    console.log("💬 Has text:", !!text);

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

    if (
      file instanceof File &&
      (file.size > 2_000_000 ||
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "audio/mpeg",
          "audio/mp4",
          "audio/webm",
          "audio/ogg",
          "audio/wav",
          "audio/x-wav",
          "video/webm",
        ].includes(file.type))
    ) {
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

    // Check AI credit
    const credit = await fetch(`${base}/rest/v1/rpc/consume_ai_credit`, {
      method: "POST",
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: user.id }),
      signal: AbortSignal.timeout(10000),
    });

    if (!credit.ok) {
      throw new Error(
        "Usage limits are not configured. Ask the creator to run the database setup."
      );
    }

    if (!(await credit.json())) {
      return Response.json(
        {
          error:
            "You have used today's 30 AI captures. Manual entry still works.",
        },
        { status: 429 }
      );
    }

    let transcript = text;

    // Transcribe audio if provided
    if (file instanceof File && !file.type.startsWith("image/")) {
      console.log("🎤 Transcribing audio...");
      const audio = new FormData();
      audio.set("file", file);
      audio.set("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1");

      const trans = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: audio,
          signal: AbortSignal.timeout(25000),
        }
      );

      if (!trans.ok) {
        const error = await trans.text();
        console.error("❌ Transcription error:", error);
        throw new Error(
          "The recording could not be transcribed. Try a shorter recording or type the details."
        );
      }

      const transcriptResult = await trans.json();
      transcript = String(transcriptResult.text || "").trim();
      console.log("✅ Transcribed:", transcript.substring(0, 100));

      if (mode === "transcribe") {
        return transcript
          ? Response.json({ text: transcript.slice(0, 6000) })
          : Response.json(
              { error: "No speech was detected. Try recording again." },
              { status: 422 }
            );
      }
    }

    // Extract details using GPT
    console.log("🤖 Extracting details with GPT...");

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

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EXTRACTION_MODEL || "gpt-4-turbo-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("❌ Extraction error:", error);
      throw new Error(
        "AI could not read the message. Try again or enter the details manually."
      );
    }

    const result = await response.json();
    const output = result.choices?.[0]?.message?.content;

    if (!output) {
      throw new Error("No usable details found. Please enter them manually.");
    }

    console.log("✅ Extracted:", output.substring(0, 200));
    const draft = JSON.parse(output);
    return Response.json({ draft });
  } catch (e) {
    console.error("❌ Error:", e);
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Capture failed. Please try manual entry.",
      },
      { status: 502 }
    );
  }
}
