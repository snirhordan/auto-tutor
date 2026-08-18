// AssessmentAgent [code + reflection]: CurriculumPacer + ExamForecaster are
// deterministic; if the agent has a PRIOR stored forecast, ForecastAuditor
// (LLM reflection) critiques the agent's own past prediction against the new
// evidence — the persistent self-correction loop.
import type {
  ConceptRow,
  Forecast,
  ForecastAudit,
  MasteryRow,
  PaceReport,
  StudentRow,
  Trace,
} from "../types";
import { pace } from "../tools/curriculumPacer";
import { forecast } from "../tools/examForecaster";
import { auditForecast } from "../tools/forecastAuditor";
import { latestForecast } from "../state";

export interface AssessmentResult {
  pace: PaceReport;
  forecast: Forecast;
  priorForecast: (Forecast & { created_at: string }) | null;
  audit?: ForecastAudit;
}

export async function runAssessmentAgent(
  trace: Trace,
  student: StudentRow,
  masteryRows: MasteryRow[],
  concepts: ConceptRow[],
  newEvidenceSummary: string,
  /** True when this run recorded mastery changes. The agent owes its prior
   *  forecast an audit whenever it has actually learned something new — not
   *  only when the new number happens to move a lot. */
  evidenceRecorded: boolean,
  language: "en" | "he",
  now: Date,
): Promise<AssessmentResult> {
  // Prior forecast BEFORE persisting the new one — that's the self-audit target.
  const prior = await latestForecast(student.id);
  const p = pace(trace, student, masteryRows, concepts, now);
  const f = await forecast(trace, student, masteryRows, concepts, now);

  const result: AssessmentResult = { pace: p, forecast: f, priorForecast: prior };

  // Reflect only when there is a prior prediction to be accountable to, and
  // something actually changed: new session evidence, a materially different
  // forecast, or a student who is off track (skip-if-pass discipline).
  // Note: a small drift is NOT evidence the prior call was right — an on-track
  // student whose probes just confirmed a suspected gap still deserves the audit.
  if (prior && trace.hasBudget(3)) {
    const drift = Math.abs(prior.predicted_grade - f.predicted_grade);
    if (evidenceRecorded || drift >= 1.5 || !p.on_track) {
      result.audit = await auditForecast(trace, prior, f, newEvidenceSummary, language);
    }
  }
  return result;
}
