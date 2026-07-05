// ReflectionAgent [Lecture 6 Reflection, scored gate]: one critique pass over the
// OUTGOING response before it ships. Scores the draft 1-10 against four checks and
// returns the verdict — it does NOT auto-apply the revision. A failing verdict is
// routed back to the SupervisorAgent (see run.ts / supervisor.ts) for a bounded
// number of fix rounds before the agent ships best-effort.
import { chatJSON } from "../../llm";
import type { Trace } from "../types";

const SYSTEM = `You are ReflectionAgent, the quality gate of an autonomous bagrut-math tutoring agent.
Score the draft response 1-10 against these checks:
1. Does it address the diagnosed root cause (not just the surface errors)?
2. Are difficulty and scope calibrated to the student's mastery and the sessions left?
3. Are all numbers consistent (forecast, lessons, dates)?
4. Is the tone right for a professional tutor-facing brief — direct, concrete, no filler?
A response that fully satisfies all four checks scores 8-10; pass iff score >= 8.
If pass, return {"score": <8-10>, "pass": true, "issues": [], "revised": null}.
If not, return {"score": <1-7>, "pass": false, "issues": ["..."], "revised": "the corrected full response"} —
change ONLY what the issues require, keep the structure.
Reply in strict JSON: {"score": <1-10>, "pass": <true iff score >= 8>, "issues": ["..."], "revised": "... or null"}.`;

export interface ReflectionVerdict {
  score: number;
  pass: boolean;
  issues: string[];
  revised: string | null;
}

export async function runReflectionAgent(
  trace: Trace,
  draft: string,
  contextSummary: string,
): Promise<ReflectionVerdict> {
  if (!trace.hasBudget(1)) {
    // budget guard: ship the draft as-is, no LLM call and no trace step
    return { score: 10, pass: true, issues: [], revised: null };
  }
  const user = `CONTEXT:\n${contextSummary}\n\nDRAFT RESPONSE:\n${draft}`;
  const { value } = await chatJSON<ReflectionVerdict>({
    module: "ReflectionAgent",
    system: SYSTEM,
    user,
    runId: trace.runId,
  });
  const verdict: ReflectionVerdict = {
    score: value.score,
    pass: value.pass,
    issues: value.issues ?? [],
    revised: value.revised ?? null,
  };
  trace.addLlm(
    "ReflectionAgent",
    { system_prompt: SYSTEM, user_prompt: truncate(user, 4000) },
    { score: verdict.score, pass: verdict.pass, issues: verdict.issues },
  );
  return verdict;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " …[truncated]" : s);
