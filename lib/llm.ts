// OpenAI-compatible client against the LLMod.ai course endpoint,
// with per-call token-usage logging (Supabase llm_usage) and strict-JSON helpers.
import OpenAI from "openai";
import { CHAT_MODEL, EMBEDDING_MODEL } from "./config";
import { logUsage } from "./supabase";
import type { Trace } from "./agent/types";

export const openai = new OpenAI({
  apiKey: process.env.LLMOD_API_KEY,
  baseURL: process.env.LLMOD_BASE_URL,
  // LLMod occasionally returns transient 429/5xx on long agent runs; the SDK
  // retries those with exponential backoff — default of 2 is not enough.
  maxRetries: 5,
  timeout: 120_000,
});

export interface ChatArgs {
  module: string; // architecture-diagram module name, e.g. "DiagnosisAgent.TranscriptAnalyzer"
  system: string;
  user: string;
  runId?: string;
  /** Ask the provider to constrain the reply to a JSON object. Set by chatJSON. */
  json?: boolean;
  /** Passing the trace lets chatJSON record billed JSON-repair retries, which would
   *  otherwise be invisible to both steps[] and the per-run budget guard. */
  trace?: Trace;
  /** Reasoning budget. Left unset everywhere on purpose: measured on this deployment with
   *  the real SupervisorAgent prompt (n=5), the default already spends ~0 reasoning tokens
   *  on these structured tasks, and forcing "low" was no faster (1.63s vs 1.60s) while
   *  emitting 76% more completion tokens. Kept as a knob, not used. */
  effort?: "low" | "medium" | "high";
  /** Upper bound on completion tokens (reasoning tokens count toward it, so keep headroom
   *  — a truncated reply costs a full repair retry, which is worse than a long one). */
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/** One chat completion. Every call is usage-logged under its module name. */
export async function chat({ module, system, user, runId, json, effort, maxTokens }: ChatArgs): Promise<ChatResult> {
  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // Provider-enforced JSON removes almost all parse failures at the source, which is
    // cheaper than paying for a full-prompt repair retry (verified supported on the
    // course's Azure deployment).
    ...(json ? { response_format: { type: "json_object" as const } } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
  });
  const usage = res.usage;
  await logUsage({
    module,
    run_id: runId ?? null,
    prompt_tokens: usage?.prompt_tokens ?? 0,
    completion_tokens: usage?.completion_tokens ?? 0,
  });
  return {
    text: res.choices[0]?.message?.content ?? "",
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  };
}

/** Chat call whose answer must be a JSON object. Up to 3 attempts on parse failure. */
export async function chatJSON<T>(args: ChatArgs): Promise<{ value: T; raw: ChatResult }> {
  const sys = args.system + "\nReturn ONLY a valid JSON object. No prose, no markdown fences.";
  let raw = await chat({ ...args, system: sys, json: true });
  let parsed = parseFirstJSONObject<T>(raw.text);
  for (let attempt = 0; parsed === undefined && attempt < 2; attempt++) {
    // The unusable reply was still billed. Record it so steps[] describes every LLM
    // call (as the spec requires) and the budget guard sees the real spend.
    args.trace?.addFailedAttempt(args.module, attempt + 1, raw.text);
    raw = await chat({
      ...args,
      system: sys,
      json: true,
      user: args.user + "\n\nYour previous reply was not valid JSON. Reply with the JSON object only.",
    });
    parsed = parseFirstJSONObject<T>(raw.text);
  }
  if (parsed === undefined) {
    throw new Error(`Module ${args.module} did not return valid JSON`);
  }
  return { value: parsed, raw };
}

/**
 * Parse the first complete JSON object in a model reply.
 *
 * Besides fences/leading prose, some compatible providers occasionally repeat
 * the same valid object twice. Taking text from the first `{` to the last `}`
 * turns that otherwise usable response into invalid JSON and needlessly bills a
 * repair call. A small string-aware brace scanner accepts the first complete
 * object while still rejecting truncated JSON.
 */
export function parseFirstJSONObject<T>(text: string): T | undefined {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf("{", searchFrom);
    if (start === -1) return undefined;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closedAt = -1;

    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          closedAt = i;
          try {
            return JSON.parse(text.slice(start, i + 1)) as T;
          } catch {
            break;
          }
        }
      }
    }
    // If the outer object never closed, do not accidentally accept one of its
    // nested objects as the whole reply. A repair call is the safe outcome.
    if (closedAt === -1) return undefined;
    searchFrom = closedAt + 1;
  }
  return undefined;
}

/** Batched embeddings (L4: batch to amortize cost/latency). */
export async function embed(texts: string[], runId?: string): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96);
    const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
    await logUsage({
      module: "Embedding",
      run_id: runId ?? null,
      prompt_tokens: res.usage?.total_tokens ?? 0,
      completion_tokens: 0,
    });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
}
