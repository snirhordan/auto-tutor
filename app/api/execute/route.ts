import { NextResponse } from "next/server";
import { executeAgent } from "@/lib/agent/run";

// Vercel serverless limit for this project is 300s — the agent's guardrails
// (≤20 LLM calls, capped loops) keep worst-case runs well under it.
export const maxDuration = 300;
/** ~16k chars: comfortably longer than any real session transcript, short enough that a
 *  scripted caller cannot inflate per-call token cost without bound. */
const MAX_PROMPT_CHARS = 16_000;
export const runtime = "nodejs";

export async function POST(req: Request) {
  let prompt: unknown;
  try {
    const body = await req.json();
    prompt = body?.prompt;
  } catch {
    return NextResponse.json(
      { status: "error", error: "Request body must be JSON: {\"prompt\": \"...\"}", response: null, steps: [] },
      { status: 400 },
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json(
      { status: "error", error: "Missing 'prompt' string in request body", response: null, steps: [] },
      { status: 400 },
    );
  }
  // This endpoint is unauthenticated by design (the brief requires an open GUI), so an
  // unbounded prompt is a direct route to draining the shared course LLM budget: the raw
  // text is forwarded verbatim to several modules. A real tutoring transcript is a few KB.
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      {
        status: "error",
        error: `Prompt too long: ${prompt.length} characters (limit ${MAX_PROMPT_CHARS}). Paste a single session transcript.`,
        response: null,
        steps: [],
      },
      { status: 413 },
    );
  }

  try {
    const { response, steps } = await executeAgent(prompt);
    return NextResponse.json({ status: "ok", error: null, response, steps });
  } catch (e) {
    // Log the real cause server-side; return a generic message. The thrown text can carry
    // Postgres/PostgREST detail (constraint and column names) or upstream provider errors,
    // and this response goes to anonymous callers.
    console.error("[/api/execute] agent run failed:", e);
    return NextResponse.json(
      {
        status: "error",
        error: "Agent run failed while processing this request. Please retry; if it persists the tutor should check the server logs.",
        response: null,
        steps: [],
      },
      { status: 500 },
    );
  }
}
