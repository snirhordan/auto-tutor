// PlannerAgent [Plan-and-Execute, Lecture 6]:
//   PlannerLLM  → the lesson-sequence roadmap (the study plan)
//   ExecutorLLM → next-session brief + tutor guidelines
//   ReplanLLM   → revises a PRIOR roadmap when new evidence contradicts it
// Replanning IS the pedagogy: every session's evidence updates the plan.
import { chatJSON } from "../../llm";
import type {
  ConceptRow,
  Forecast,
  PaceReport,
  Probe,
  RoadmapItem,
  StudentRow,
  Trace,
} from "../types";
import { activePlan, savePlan } from "../state";

const PLANNER_SYSTEM = `You are PlannerAgent.PlannerLLM of an autonomous bagrut-math tutoring agent —
persona: a veteran 5-unit tutor building a lesson roadmap. Think step by step about: exam weight of
each weak topic, prerequisite order (fix foundations before surface skills), sessions actually left,
and the student's target. If sessions_left cannot cover everything, TRIAGE: drop or thin the
lowest-weight weak topics and say so explicitly — that trade-off is your decision to own.
focus_concepts must contain ONLY concept ids from the CONCEPT IDS list you are given.
Reply in strict JSON:
{"roadmap": [{"lesson": 1, "focus_concepts": ["..."], "goal": "..."}], "triage_note": "... or null"}`;

const EXECUTOR_SYSTEM = `You are PlannerAgent.ExecutorLLM of an autonomous bagrut-math tutoring agent —
persona: a veteran 5-unit tutor writing the NEXT-SESSION brief for a colleague. Produce a tight,
actionable brief in markdown with sections:
1. "Opening probes" (if probes are provided — else a 3-minute warm-up tied to last session's errors)
2. "Main work" — the lesson-1 focus with 2–3 concrete exercise types (reference real bagrut-style items)
3. "Watch for" — the student's known error patterns and what to do when they appear
4. "Exit check" — one question that verifies the session goal was met
Keep it under 350 words, direct, no fluff.
Reply in strict JSON: {"brief": "markdown string"}`;

const REPLAN_SYSTEM = `You are PlannerAgent.ReplanLLM of an autonomous bagrut-math tutoring agent.
The agent had an ACTIVE roadmap; new session evidence and a fresh assessment may contradict it.
Decide: keep (minor drift), or restructure (evidence broke an assumption — e.g. a prerequisite gap
surfaced, or pace collapsed). If restructuring, output the revised roadmap and a one-paragraph
rationale naming exactly what changed and why. focus_concepts must contain ONLY concept ids from
the CONCEPT IDS list you are given. Reply in strict JSON:
{"decision": "keep|restructure", "rationale": "...", "roadmap": [{"lesson": 1, "focus_concepts": ["..."], "goal": "..."}]}`;

export interface PlanResult {
  roadmap: RoadmapItem[];
  triageNote?: string;
  replanRationale?: string;
  brief: string;
}

/** Keep only focus_concepts that exist in the real catalog. The prompts ask the model to
 *  stay in-catalog, but a prompt is not an enforcement boundary: transcript text can carry
 *  injected instructions, and an unchecked id would be persisted by savePlan and replayed
 *  into every later session. Mirrors the filter transcriptAnalyzer applies to evidence. */
export function sanitizeRoadmap(roadmap: RoadmapItem[], concepts: ConceptRow[]): RoadmapItem[] {
  const valid = new Set(concepts.map((c) => c.id));
  return (roadmap ?? [])
    .map((item) => ({
      ...item,
      focus_concepts: (item.focus_concepts ?? []).filter((id) => valid.has(id)),
    }))
    .filter((item) => item.focus_concepts.length > 0 || (item.goal ?? "").trim().length > 0);
}

export async function runPlannerAgent(
  trace: Trace,
  student: StudentRow,
  concepts: ConceptRow[],
  diagnosisStatement: string,
  weakSummary: string,
  paceReport: PaceReport,
  fc: Forecast,
  probes: Probe[] | undefined,
  errorPatterns: string[],
  language: "en" | "he",
): Promise<PlanResult> {
  const prior = await activePlan(student.id);
  // PlannerAgent costs 2 chat calls (planner/replan + executor). Every other specialist
  // reserves headroom before spending; without the same guard a dispatch at the edge of
  // the budget consumes the reserve that ReflectionAgent's quality gate needs.
  if (!trace.hasBudget(2)) {
    const kept = prior?.roadmap ?? [];
    trace.addCode(
      "PlannerAgent",
      "insufficient LLM budget for planning — reusing the active roadmap instead of replanning",
      { budget_exhausted: true, reused_active_plan: kept.length > 0, lessons: kept.length },
    );
    return {
      roadmap: kept,
      brief: prior?.brief ?? "",
      replanRationale: undefined,
      triageNote: undefined,
    };
  }
  const langNote = `Write all prose in ${language === "he" ? "Hebrew" : "English"}.`;
  const conceptIds = `CONCEPT IDS you may use in focus_concepts:\n${concepts.map((c) => c.id).join(", ")}\n`;

  const situation =
    conceptIds +
    `STUDENT: ${student.name} (${student.track}), exam ${student.exam_date}, target ${student.target_grade}\n` +
    `PACE: ${paceReport.days_to_exam} days / ~${paceReport.sessions_left} sessions left; weighted mastery ` +
    `${paceReport.weighted_mastery} vs expected ${paceReport.expected_mastery_by_now} (${paceReport.on_track ? "on track" : "BEHIND"})\n` +
    `AT-RISK TOPICS: ${paceReport.at_risk_topics.map((t) => `${t.topic}@${t.mastery} (weight ${t.weight})`).join(", ") || "none"}\n` +
    `FORECAST: ${fc.predicted_grade} [${fc.interval_low}–${fc.interval_high}], lessons_needed ${fc.lessons_needed}\n` +
    `DIAGNOSIS: ${diagnosisStatement}\nWEAK CONCEPTS: ${weakSummary}\n`;

  let roadmap: RoadmapItem[];
  let triageNote: string | undefined;
  let replanRationale: string | undefined;

  if (prior && prior.roadmap?.length) {
    // Replan path: the agent revises its own prior plan.
    const user =
      situation +
      `\nACTIVE ROADMAP:\n${prior.roadmap.map((r) => `lesson ${r.lesson}: [${r.focus_concepts.join(", ")}] — ${r.goal}`).join("\n")}\n\n${langNote}`;
    const { value } = await chatJSON<{
      decision: "keep" | "restructure";
      rationale: string;
      roadmap: RoadmapItem[];
    }>({ module: "PlannerAgent.ReplanLLM", system: REPLAN_SYSTEM, user, runId: trace.runId, trace });
    trace.addLlm("PlannerAgent.ReplanLLM", { system_prompt: REPLAN_SYSTEM, user_prompt: user }, value);
    replanRationale = value.rationale;
    roadmap =
      value.decision === "restructure" && value.roadmap?.length
        ? sanitizeRoadmap(value.roadmap, concepts)
        : prior.roadmap;
  } else {
    // Fresh plan path.
    const user = situation + `\nPlan at most ${Math.max(1, Math.min(paceReport.sessions_left, 8))} lessons.\n${langNote}`;
    const { value } = await chatJSON<{ roadmap: RoadmapItem[]; triage_note: string | null }>({
      module: "PlannerAgent.PlannerLLM",
      system: PLANNER_SYSTEM,
      user,
      runId: trace.runId,
      trace,
    });
    trace.addLlm("PlannerAgent.PlannerLLM", { system_prompt: PLANNER_SYSTEM, user_prompt: user }, value);
    roadmap = sanitizeRoadmap(value.roadmap ?? [], concepts);
    triageNote = value.triage_note ?? undefined;
  }

  // Executor: write the next-session brief.
  const lesson1 = roadmap[0];
  const focusNames = (lesson1?.focus_concepts ?? []).map((id) => {
    const c = concepts.find((x) => x.id === id);
    return c ? `${id} (${c.name_en} / ${c.name_he})` : id;
  });
  const execUser =
    `LESSON GOAL: ${lesson1?.goal ?? "consolidate weak concepts"}\nFOCUS: ${focusNames.join(", ")}\n` +
    `KNOWN ERROR PATTERNS: ${errorPatterns.join(", ") || "none recorded"}\n` +
    `OPENING PROBES:\n${probes?.length ? probes.map((p) => `- ${p.question} (expect: ${p.expected_answer})`).join("\n") : "(none — write a warm-up)"}\n\n${langNote}`;
  const { value: exec } = await chatJSON<{ brief: string }>({
    module: "PlannerAgent.ExecutorLLM",
    system: EXECUTOR_SYSTEM,
    user: execUser,
    runId: trace.runId,
    trace,
  });
  trace.addLlm("PlannerAgent.ExecutorLLM", { system_prompt: EXECUTOR_SYSTEM, user_prompt: execUser }, exec);

  await savePlan(student.id, roadmap, exec.brief);
  return { roadmap, triageNote, replanRationale, brief: exec.brief };
}
