// SupervisorAgent [Lecture 6 Supervisor, ReAct-style dispatch loop ≤6]:
// owns the standing goal, decides WHICH specialist sub-agent to dispatch next
// based on what the event revealed so far, monitors results, and decides when
// to stop. Different events → different dispatch sequences (anti-pipeline).
import { chatJSON } from "../llm";
import { MAX_SUPERVISOR_DISPATCHES, STANDING_GOAL } from "../config";
import type { ConceptRow, MasteryRow, RunArtifacts, StudentRow, Trace } from "./types";
import { runDiagnosisAgent } from "./subagents/diagnosisAgent";
import { runAssessmentAgent } from "./subagents/assessmentAgent";
import { runPlannerAgent } from "./subagents/plannerAgent";
import { runStudentQueryAgent } from "./subagents/studentQueryAgent";

const SYSTEM = `You are SupervisorAgent, the coordinator of an autonomous bagrut-math tutoring agent.
STANDING GOAL: ${STANDING_GOAL}
You receive an EVENT (session transcript) or a QUESTION — never a command. Decide which specialist
to dispatch next, based on what is known so far:
- {"dispatch": "DiagnosisAgent"} — analyze the transcript: extract evidence, update mastery, find root-cause gaps, maybe generate probes. Required before planning on a transcript event.
- {"dispatch": "AssessmentAgent"} — recompute pace vs the exam calendar and the grade forecast; if a prior forecast exists it will self-audit. Requires diagnosis on transcript events.
- {"dispatch": "PlannerAgent"} — build or revise the lesson roadmap and write the next-session brief. Requires assessment.
- {"dispatch": "StudentQueryAgent"} — answer a question from stored state (question intent only).
- {"dispatch": "finalize"} — all work needed for THIS event is done; assemble the response.
Think about what THIS event actually requires — a clean session may need no probes and only a light
plan touch; a question needs no diagnosis at all. Do not dispatch an agent twice.
Reply in strict JSON: {"thought": "...", "dispatch": "..."}`;

export interface SupervisorDeps {
  student: StudentRow;
  masteryRows: MasteryRow[];
  concepts: ConceptRow[];
  edges: { src: string; dst: string; strength: number }[];
  transcript?: string;
  question?: string;
  now: Date;
}

export async function runSupervisor(
  trace: Trace,
  intent: "transcript" | "question",
  deps: SupervisorDeps,
  artifacts: RunArtifacts,
): Promise<RunArtifacts> {
  const dispatched = new Set<string>();

  for (let i = 0; i < MAX_SUPERVISOR_DISPATCHES; i++) {
    // Budget guard: reserve calls for finalize/reflection; force finalize when tight.
    if (!trace.hasBudget(2)) break;

    const state = digest(intent, deps, artifacts, dispatched);
    const { value } = await chatJSON<{ thought: string; dispatch: string }>({
      module: "SupervisorAgent",
      system: SYSTEM,
      user: state,
      runId: trace.runId,
    });
    trace.addLlm("SupervisorAgent", { system_prompt: SYSTEM, user_prompt: state }, value);

    const d = value.dispatch;
    if (d === "finalize" || dispatched.has(d)) break;
    dispatched.add(d);

    if (d === "DiagnosisAgent" && deps.transcript) {
      const r = await runDiagnosisAgent(
        trace, deps.transcript, deps.student.id, deps.masteryRows,
        deps.concepts, deps.edges, artifacts.language, deps.now,
      );
      if ("clarification" in r) {
        artifacts.clarification = r.clarification;
        return artifacts; // Question-Refinement: ask instead of guessing
      }
      artifacts.analysis = r.analysis;
      artifacts.masteryChanges = r.masteryChanges;
      artifacts.diagnosis = r.diagnosis;
      artifacts.probes = r.probes;
    } else if (d === "AssessmentAgent") {
      const evidenceSummary =
        artifacts.analysis?.evidence
          .map((e) => `${e.concept_id}:${e.outcome}${e.error_pattern ? `[${e.error_pattern}]` : ""}`)
          .join(", ") ?? "no new session evidence";
      const r = await runAssessmentAgent(
        trace, deps.student, deps.masteryRows, deps.concepts,
        evidenceSummary, artifacts.language, deps.now,
      );
      artifacts.pace = r.pace;
      artifacts.forecast = r.forecast;
      artifacts.priorForecast = r.priorForecast;
      artifacts.audit = r.audit;
    } else if (d === "PlannerAgent") {
      if (!artifacts.pace || !artifacts.forecast) continue; // dependency guard
      const weakSummary =
        artifacts.diagnosis?.weak_concepts
          .map((w) => `${w.concept_id}@${w.mastery}`)
          .join(", ") || "none flagged this session";
      const errorPatterns = [
        ...new Set(
          (artifacts.analysis?.evidence ?? [])
            .map((e) => e.error_pattern)
            .filter((x): x is string => !!x),
        ),
      ];
      const r = await runPlannerAgent(
        trace, deps.student, deps.concepts,
        artifacts.diagnosis?.statement ?? "no acute diagnosis — routine progression",
        weakSummary, artifacts.pace, artifacts.forecast,
        artifacts.probes, errorPatterns, artifacts.language,
      );
      artifacts.roadmap = r.roadmap;
      artifacts.replanRationale = r.replanRationale ?? r.triageNote;
      artifacts.brief = r.brief;
    } else if (d === "StudentQueryAgent" && deps.question) {
      artifacts.queryAnswer = await runStudentQueryAgent(
        trace, deps.question, deps.student, deps.masteryRows,
        deps.concepts, artifacts.language, deps.now,
      );
    }
  }
  return artifacts;
}

function digest(
  intent: string,
  deps: SupervisorDeps,
  a: RunArtifacts,
  dispatched: Set<string>,
): string {
  return (
    `EVENT TYPE: ${intent}\n` +
    `STUDENT: ${deps.student.name} (${deps.student.id}), exam ${deps.student.exam_date}, target ${deps.student.target_grade}\n` +
    (deps.transcript ? `TRANSCRIPT LENGTH: ${deps.transcript.length} chars\n` : "") +
    (deps.question ? `QUESTION: ${deps.question}\n` : "") +
    `ALREADY DISPATCHED: ${[...dispatched].join(", ") || "none"}\n` +
    `ARTIFACTS SO FAR:\n` +
    `- diagnosis: ${a.diagnosis ? `done (${a.diagnosis.weak_concepts.length} weak, ${a.diagnosis.root_causes.length} root causes, probes: ${a.probes?.length ?? 0})` : "no"}\n` +
    `- mastery updates: ${a.masteryChanges ? a.masteryChanges.length : "no"}\n` +
    `- assessment: ${a.forecast ? `done (forecast ${a.forecast.predicted_grade}, on_track=${a.pace?.on_track}${a.audit ? `, self-audit verdict: ${a.audit.verdict}` : ""})` : "no"}\n` +
    `- plan: ${a.roadmap ? `done (${a.roadmap.length} lessons${a.replanRationale ? ", replanned/triaged" : ""})` : "no"}\n` +
    `- query answer: ${a.queryAnswer ? "done" : "no"}`
  );
}
