// ReflectionAgent [Lecture 6 Reflection, N=1, skip-if-pass]: one critique pass
// over the OUTGOING response before it ships. A single call both critiques and
// (only if needed) revises — bounded cost, per L6's "can over-reflect" warning.
import { chatJSON } from "../../llm";
import type { Trace } from "../types";

const SYSTEM = `You are ReflectionAgent, the quality gate of an autonomous bagrut-math tutoring agent.
Critique the draft response against these checks:
1. Does it address the diagnosed root cause (not just the surface errors)?
2. Are difficulty and scope calibrated to the student's mastery and the sessions left?
3. Are all numbers consistent (forecast, lessons, dates)?
4. Is the tone right for a professional tutor-facing brief — direct, concrete, no filler?
If ALL checks pass, return {"pass": true, "issues": [], "revised": null}.
If not, return {"pass": false, "issues": ["..."], "revised": "the corrected full response"} —
change ONLY what the issues require, keep the structure.
Reply in strict JSON.`;

export async function runReflectionAgent(
  trace: Trace,
  draft: string,
  contextSummary: string,
): Promise<string> {
  if (!trace.hasBudget(1)) return draft; // budget guard: ship the draft as-is
  const user = `CONTEXT:\n${contextSummary}\n\nDRAFT RESPONSE:\n${draft}`;
  const { value } = await chatJSON<{ pass: boolean; issues: string[]; revised: string | null }>({
    module: "ReflectionAgent",
    system: SYSTEM,
    user,
    runId: trace.runId,
  });
  trace.addLlm(
    "ReflectionAgent",
    { system_prompt: SYSTEM, user_prompt: truncate(user, 4000) },
    { pass: value.pass, issues: value.issues },
  );
  return !value.pass && value.revised ? value.revised : draft;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " …[truncated]" : s);
