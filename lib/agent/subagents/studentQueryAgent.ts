// StudentQueryAgent [LLM]: answers tutor questions ("How is Itai doing? Will he
// pass?") from the agent's OWN stored state — mastery, forecasts, plans. The
// agent is queryable about its beliefs, and says what it is uncertain about.
import { chatJSON } from "../../llm";
import type { ConceptRow, MasteryRow, StudentRow, Trace } from "../types";
import { activePlan, latestForecast } from "../state";
import { decayedMastery } from "../tools/masteryUpdater";

const SYSTEM = `You are StudentQueryAgent of an autonomous bagrut-math tutoring agent — persona: a
veteran 5-unit tutor answering a colleague's question about a student, strictly from the agent's
stored state (mastery, forecast, plan). Quantify: cite mastery values, the forecast interval and
what drives it. State uncertainty honestly (low-confidence estimates, thin evidence). If the
question asks for something outside the stored state, say what you'd need to know it.
Reply in strict JSON: {"answer": "markdown string"}`;

export async function runStudentQueryAgent(
  trace: Trace,
  question: string,
  student: StudentRow,
  masteryRows: MasteryRow[],
  concepts: ConceptRow[],
  language: "en" | "he",
  now: Date,
): Promise<string> {
  const fc = await latestForecast(student.id);
  const plan = await activePlan(student.id);

  const weakest = masteryRows
    .map((r) => ({ id: r.concept_id, m: decayedMastery(r, now), conf: r.confidence, err: r.error_patterns }))
    .sort((a, b) => a.m - b.m)
    .slice(0, 8)
    .map((r) => {
      const c = concepts.find((x) => x.id === r.id);
      return `${r.id} (${c?.name_en}): mastery ${r.m.toFixed(2)}, confidence ${r.conf}, errors [${r.err.join(",")}]`;
    });

  const user =
    `QUESTION: ${question}\n\nSTUDENT: ${student.name}, exam ${student.exam_date}, target ${student.target_grade}\n` +
    `WEAKEST CONCEPTS:\n${weakest.join("\n")}\n` +
    `LATEST FORECAST: ${fc ? `${fc.predicted_grade} [${fc.interval_low}–${fc.interval_high}], lessons_needed ${fc.lessons_needed} (as of ${fc.created_at})` : "none stored yet"}\n` +
    `ACTIVE PLAN: ${plan ? plan.roadmap.map((r) => `L${r.lesson}: ${r.goal}`).join("; ") : "none"}\n\n` +
    `Answer in ${language === "he" ? "Hebrew" : "English"}.`;

  const { value } = await chatJSON<{ answer: string }>({
    module: "StudentQueryAgent",
    system: SYSTEM,
    user,
    runId: trace.runId,
  });
  trace.addLlm("StudentQueryAgent", { system_prompt: SYSTEM, user_prompt: user }, value);
  return value.answer;
}
