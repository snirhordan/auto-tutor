// ForecastAuditor [LLM, REFLECTION over the agent's OWN past output]: compares the
// previously STORED forecast with today's evidence and recomputed forecast, and
// critiques its own prior reasoning — the Lecture-6 Reflection pattern turned on
// the agent itself. This is the persistent self-correction loop.
import { chatJSON } from "../../llm";
import type { Forecast, ForecastAudit, Trace } from "../types";

const SYSTEM = `You are the self-audit module of an autonomous tutoring agent, reflecting on the
agent's OWN previous grade forecast for this student (Reflection pattern: critique your past output).
Compare the prior forecast with the new evidence and the recomputed forecast. Decide:
- "held": prior forecast is consistent with what the new session revealed
- "optimistic": the agent overestimated the student (say which assumption broke)
- "pessimistic": the agent underestimated the student
Be concrete and quantitative in the critique; reference specific concepts. Then state the operational
adjustment the agent should carry forward (e.g., "weight probe results over homework fluency for
this student", "recalibrate vectors-topic pace estimate by −30%").
Reply in strict JSON: {"verdict": "held|optimistic|pessimistic", "critique": "...", "adjustment": "..."}`;

export async function auditForecast(
  trace: Trace,
  prior: Forecast & { created_at?: string },
  fresh: Forecast,
  newEvidenceSummary: string,
  language: "en" | "he",
): Promise<ForecastAudit> {
  const user =
    `PRIOR FORECAST (stored ${prior.created_at ?? "earlier"}): grade ${prior.predicted_grade} ` +
    `[${prior.interval_low}–${prior.interval_high}], lessons_needed ${prior.lessons_needed}, ` +
    `basis: ${JSON.stringify(prior.basis)}\n\n` +
    `NEW SESSION EVIDENCE: ${newEvidenceSummary}\n\n` +
    `RECOMPUTED FORECAST: grade ${fresh.predicted_grade} [${fresh.interval_low}–${fresh.interval_high}], ` +
    `lessons_needed ${fresh.lessons_needed}\n\n` +
    `Write critique and adjustment in ${language === "he" ? "Hebrew" : "English"}.`;

  const { value } = await chatJSON<ForecastAudit>({
    module: "AssessmentAgent.ForecastAuditor",
    system: SYSTEM,
    user,
    runId: trace.runId,
  });
  trace.addLlm(
    "AssessmentAgent.ForecastAuditor",
    { system_prompt: SYSTEM, user_prompt: user },
    value,
  );
  return value;
}
