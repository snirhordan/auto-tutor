// OpenAI-compatible client against the LLMod.ai course endpoint,
// with per-call token-usage logging (Supabase llm_usage) and strict-JSON helpers.
import OpenAI from "openai";
import { CHAT_MODEL, EMBEDDING_MODEL } from "./config";
import { logUsage } from "./supabase";

export const openai = new OpenAI({
  apiKey: process.env.LLMOD_API_KEY,
  baseURL: process.env.LLMOD_BASE_URL,
});

export interface ChatArgs {
  module: string; // architecture-diagram module name, e.g. "DiagnosisAgent.TranscriptAnalyzer"
  system: string;
  user: string;
  runId?: string;
}

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/** One chat completion. Every call is usage-logged under its module name. */
export async function chat({ module, system, user, runId }: ChatArgs): Promise<ChatResult> {
  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
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

/** Chat call whose answer must be a JSON object. Retries once on parse failure. */
export async function chatJSON<T>(args: ChatArgs): Promise<{ value: T; raw: ChatResult }> {
  const sys = args.system + "\nReturn ONLY a valid JSON object. No prose, no markdown fences.";
  let raw = await chat({ ...args, system: sys });
  let parsed = tryParse<T>(raw.text);
  if (parsed === undefined) {
    raw = await chat({
      ...args,
      system: sys,
      user: args.user + "\n\nYour previous reply was not valid JSON. Reply with the JSON object only.",
    });
    parsed = tryParse<T>(raw.text);
  }
  if (parsed === undefined) {
    throw new Error(`Module ${args.module} did not return valid JSON`);
  }
  return { value: parsed, raw };
}

function tryParse<T>(text: string): T | undefined {
  // Tolerate accidental code fences or leading prose around the JSON object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
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
