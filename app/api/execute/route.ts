import { NextResponse } from "next/server";
import { executeAgent } from "@/lib/agent/run";

// Vercel serverless limit for this project is 300s — the agent's guardrails
// (≤15 LLM calls, capped loops) keep worst-case runs well under it.
export const maxDuration = 300;
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

  try {
    const { response, steps } = await executeAgent(prompt);
    return NextResponse.json({ status: "ok", error: null, response, steps });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { status: "error", error: `Agent run failed: ${msg}`, response: null, steps: [] },
      { status: 500 },
    );
  }
}
