// ReflectionAgent [Lecture 6 Reflection, scored gate]: one critique pass over the
// OUTGOING response before it ships. Scores the draft 1-10 against four checks and
// returns the verdict — it does NOT auto-apply the revision. A failing verdict is
// routed back to the SupervisorAgent (see run.ts / supervisor.ts) for a bounded
// number of fix rounds before the agent ships best-effort.
import { chatJSON } from "../../llm";
import type { Trace } from "../types";

const CHECKS = `You are ReflectionAgent, the quality gate of an autonomous bagrut-math tutoring agent.
Score the draft response 1-10 against these checks:
1. Does it address the diagnosed root cause (not just the surface errors)?
2. Are difficulty and scope calibrated to the student's mastery and the sessions left?
3. Are all numbers consistent (forecast, lessons, dates)?
4. Is the tone right for a professional tutor-facing brief — direct, concrete, no filler?
A response that fully satisfies all four checks scores 8-10; pass iff score >= 8.
If pass, return {"score": <8-10>, "pass": true, "issues": [], "revised": null}.`;

// Earlier rounds: a failing verdict is fixed by re-dispatching a specialist and
// recomposing, so a rewrite produced here is thrown away unread. Asking for one on every
// round made this the most expensive module in the project by output tokens (~700/call
// against SupervisorAgent's ~73) — and output tokens are the slow side of a request.
const SYSTEM = `${CHECKS}
If not, return {"score": <1-7>, "pass": false, "issues": ["..."], "revised": null} — list what is
wrong, concretely enough that another module can fix it. Do NOT rewrite the response.
Reply in strict JSON: {"score": <1-10>, "pass": <true iff score >= 8>, "issues": ["..."], "revised": null}.`;

// Last attempt: no fix round remains, so the reflector's own rewrite is the only
// correction that can still ship.
const FINAL_SYSTEM = `${CHECKS}
If not, return {"score": <1-7>, "pass": false, "issues": ["..."], "revised": "the corrected full response"} —
change ONLY what the issues require, keep the structure.
Reply in strict JSON: {"score": <1-10>, "pass": <true iff score >= 8>, "issues": ["..."], "revised": "... or null"}.`;

export interface ReflectionVerdict {
  score: number;
  pass: boolean;
  issues: string[];
  revised: string | null;
  /** True when the gate never ran (budget exhausted). The draft still ships, but the
   *  trace must not present an unreviewed response as a 10/10 pass. */
  skipped?: boolean;
}

export async function runReflectionAgent(
  trace: Trace,
  draft: string,
  contextSummary: string,
  /** True on the last attempt, when there is no fix round left to act on `issues` and the
   *  reflector's own rewrite is the only correction that can still ship. */
  isFinalAttempt = false,
): Promise<ReflectionVerdict> {
  if (!trace.hasBudget(1)) {
    // Budget guard: we still have to ship something, but a gate that never ran must not
    // be indistinguishable from a perfect score. Record a real step and say so.
    trace.addCode(
      "ReflectionAgent",
      "insufficient LLM budget — quality gate skipped; shipping the draft unreviewed",
      { skipped: true, reviewed: false, reason: "per-run LLM budget exhausted" },
    );
    return {
      score: 0,
      pass: true,
      issues: ["quality gate skipped: per-run LLM budget exhausted"],
      revised: null,
      skipped: true,
    };
  }
  const user = `CONTEXT:\n${contextSummary}\n\nDRAFT RESPONSE:\n${draft}`;
  const system = isFinalAttempt ? FINAL_SYSTEM : SYSTEM;
  const { value } = await chatJSON<ReflectionVerdict>({
    module: "ReflectionAgent",
    system,
    user,
    runId: trace.runId,
    trace,
  });
  const verdict: ReflectionVerdict = {
    score: value.score,
    pass: value.pass,
    issues: value.issues ?? [],
    revised: value.revised ?? null,
  };
  trace.addLlm(
    "ReflectionAgent",
    { system_prompt: system, user_prompt: truncate(user, 4000) },
    { score: verdict.score, pass: verdict.pass, issues: verdict.issues },
  );
  return verdict;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " …[truncated]" : s);
