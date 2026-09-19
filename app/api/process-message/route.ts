import { NextRequest, NextResponse } from "next/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY || "";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const DEPRECATED_GROQ_MODELS = new Set(["llama-3.1-8b-instant","llama-3.3-70b-versatile"]);
function groqModel(){const configured=process.env.GROQ_EXTRACTION_MODEL?.trim();return configured&&!DEPRECATED_GROQ_MODELS.has(configured)?configured:DEFAULT_GROQ_MODEL;}
const MODEL = groqModel();

type PendingCommitment = {
  customer?: string;
  work?: string;
  total?: number;
  paid?: number;
  balance?: number;
  date?: string;
  time?: string;
  confirmed?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    if (!GROQ_API_KEY) {
      return NextResponse.json(
        { error: "Groq API key not configured" },
        { status: 503 }
      );
    }

    const { message, pending, today, customerContext } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const currentCommitment = (pending || {}) as PendingCommitment;

    // Build context about what we already know
    const knownFields = [];
    if (currentCommitment.customer)
      knownFields.push(`customer: ${currentCommitment.customer}`);
    if (currentCommitment.work)
      knownFields.push(`work: ${currentCommitment.work}`);
    if (currentCommitment.total !== undefined)
      knownFields.push(`total: ₹${currentCommitment.total}`);
    if (currentCommitment.paid !== undefined)
      knownFields.push(`paid: ₹${currentCommitment.paid}`);
    if (currentCommitment.balance !== undefined)
      knownFields.push(`balance: ₹${currentCommitment.balance}`);
    if (currentCommitment.date)
      knownFields.push(`date: ${currentCommitment.date}`);
    if (currentCommitment.time)
      knownFields.push(`time: ${currentCommitment.time}`);
    if (currentCommitment.confirmed !== undefined)
      knownFields.push(`confirmed: ${currentCommitment.confirmed}`);

    const contextText =
      knownFields.length > 0
        ? `\n\nWhat we already know:\n${knownFields.join("\n")}`
        : "";

    const systemPrompt = `You are Pakki Baat's friendly small-business assistant. Today is ${
      today || new Date().toISOString().slice(0, 10)
    }. Help users who may be more comfortable with WhatsApp and a handwritten hisaab book.\n\nIf customerContext is provided, the user is already inside that customer's book. Use that customer automatically and never ask their name again.

First detect whether the message is mainly:
- a REMINDER request (for example: remind me tomorrow to call Sakina; every Friday remind me to check baki) - a PAYMENT UPDATE (for example: "paid 500", "gave another 1000", "received 300")
- a CUSTOMER NOTE (for example: "note that she wants less sugar")
- or a new COMMITMENT/order/work message.

For a PAYMENT UPDATE when customerContext is present, return ONLY JSON:
{"intent":"payment","payment":{"amount":500,"date":"YYYY-MM-DD","note":"optional short note"},"nextQuestion":null}
If the amount is missing, nextQuestion should ask only for the amount.

For a CUSTOMER NOTE when customerContext is present, return ONLY JSON:
{"intent":"note","note":{"text":"the note"},"nextQuestion":null}

For a reminder, return ONLY JSON: {"intent":"reminder","reminder":{"text":"what to remember","date":"YYYY-MM-DD","time":"HH:MM or empty","customer":"optional name","repeat":"none|daily|weekly|monthly"},"nextQuestion":"only if date is missing, otherwise null"}. Resolve relative dates using today. If user says morning use 09:00, afternoon 15:00, evening 19:00.\n\nFor a commitment, set intent to commitment and follow these rules.\n\nExtract commitment details from natural conversation.

Extract information from the user's message and update the commitment. Return ONLY a JSON object.

Rules:
1. Extract whatever information is present in THIS message
2. IMPORTANT: "advance" or "received" or "paid" means the PAID amount, not total
3. IMPORTANT: "balance" means the remaining amount owed (total - paid)
4. If user says "2000 rs advance" → paid: 2000
5. If user says "2000 balance" → balance: 2000
6. If user says "total 5000" → total: 5000
7. Work/item description should go in "work" field, NOT in amounts
8. Extract dates in YYYY-MM-DD format when possible
9. Extract time in HH:MM format when possible
10. If user confirms (says "yes", "confirmed", "okay"), set confirmed: true

Return format:
{
  "extracted": {
    "customer": "name" or undefined,
    "work": "description" or undefined,
    "total": number or undefined,
    "paid": number or undefined,
    "balance": number or undefined,
    "date": "YYYY-MM-DD" or undefined,
    "time": "HH:MM" or undefined,
    "confirmed": boolean or undefined
  },
  "nextQuestion": "question to ask" or null
}

The nextQuestion should ask for the MOST IMPORTANT missing field:
- If no customer: ask for customer name
- If no work: ask what the work/order is
- If we have balance but not total/paid: ask for total
- If we have paid but not total: ask for total
- If we have total but not paid: ask how much was received
- If no date: ask when it's due
- If everything is known but not confirmed: ask for confirmation
- If confirmed: return null (we're done)`;

    const userPrompt = `Customer context: ${customerContext || "none"}\nUser message: "${message}"${contextText}

Extract information and determine the next question.`;

    console.log("🤖 Calling Groq for message:", message);
    console.log("📋 Current commitment:", currentCommitment);

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!response.ok) {
      const upstream = await response.text();
      console.error("❌ Groq API error:", response.status, upstream);
      let message = `Groq API error: ${response.status}`;
      try {
        const parsed = JSON.parse(upstream);
        message = parsed?.error?.message || parsed?.error || message;
      } catch {}
      return NextResponse.json(
        { error: message, upstreamStatus: response.status },
        { status: response.status === 429 ? 429 : 502 }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No response from Groq");
    }

    const parsed = JSON.parse(content);
    console.log("✅ Groq raw response:", parsed);

    if (parsed.intent === "reminder") {
      return NextResponse.json({
        intent: "reminder",
        reminder: parsed.reminder || null,
        nextQuestion: parsed.nextQuestion || null,
        isComplete: Boolean(parsed.reminder?.date && !parsed.nextQuestion),
      });
    }

    if (parsed.intent === "payment") {
      return NextResponse.json({
        intent: "payment",
        payment: parsed.payment || null,
        nextQuestion: parsed.nextQuestion || null,
      });
    }

    if (parsed.intent === "note") {
      return NextResponse.json({
        intent: "note",
        note: parsed.note || null,
        nextQuestion: parsed.nextQuestion || null,
      });
    }

    // Default to commitment intent if not specified
    if (!parsed.intent || parsed.intent === "commitment") {
      console.log("Processing as commitment");

      // Merge extracted data with current commitment
      const updated: PendingCommitment = { ...currentCommitment };

      if (parsed.extracted) {
        const ext = parsed.extracted;

        if (ext.customer !== undefined) updated.customer = ext.customer;
        if (ext.work !== undefined) updated.work = ext.work;
        if (ext.total !== undefined) updated.total = Number(ext.total);
        if (ext.paid !== undefined) updated.paid = Number(ext.paid);
        if (ext.balance !== undefined) updated.balance = Number(ext.balance);
        if (ext.date !== undefined) updated.date = ext.date;
        if (ext.time !== undefined) updated.time = ext.time;
        if (ext.confirmed !== undefined) updated.confirmed = ext.confirmed;

        // Calculate missing values if possible
        if (
          updated.total !== undefined &&
          updated.paid !== undefined &&
          updated.balance === undefined
        ) {
          updated.balance = updated.total - updated.paid;
        }
        if (
          updated.total !== undefined &&
          updated.balance !== undefined &&
          updated.paid === undefined
        ) {
          updated.paid = updated.total - updated.balance;
        }
        if (
          updated.paid !== undefined &&
          updated.balance !== undefined &&
          updated.total === undefined
        ) {
          updated.total = updated.paid + updated.balance;
        }
      }

      return NextResponse.json({
        updated,
        nextQuestion: parsed.nextQuestion,
        isComplete: !parsed.nextQuestion && updated.confirmed,
      });
    }

    // Unknown intent
    return NextResponse.json(
      { error: `Unknown intent: ${parsed.intent}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("❌ Error processing message:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error("Error details:", {
      message: errorMessage,
      stack: errorStack,
      rawError: error,
    });

    return NextResponse.json(
      {
        error: errorMessage || "Failed to process message",
        ...(process.env.NODE_ENV !== "production" ? { details: errorStack } : {}),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    enabled: Boolean(GROQ_API_KEY),
    model: MODEL,
  });
}
