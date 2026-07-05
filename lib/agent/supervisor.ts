// SupervisorAgent [Lecture 6 Supervisor, ReAct-style dispatch loop ≤6]:
// owns the standing goal, decides WHICH specialist sub-agent to dispatch next
// based on what the event revealed so far, monitors results, and decides when
// to stop. Different events → different dispatch sequences (anti-pipeline).
//
// Also owns the fix-round loop: when the ReflectionAgent quality gate rejects a
// draft response, runSupervisorFixRound() re-enters dispatch (fresh redispatch
// set, capped at 2 dispatches) with the reflection issues folded into the digest
// so the Supervisor sends the right specialist(s) back to fix them.
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
plan touch; a question needs no diagnosis at all. If the diagnosis surfaced NO weak concepts AND the
pace report says on_track, do NOT dispatch PlannerAgent — the active roadmap stands; finalize and say
so. Do not dispatch an agent twice.
If you see a REFLECTION FEEDBACK section, the quality gate rejected the previous draft: dispatch
whichever specialist(s) can actually fix the listed issues, then finalize — do not just re-finalize
without addressing them.
Reply in strict JSON: {"thought": "...", "dispatch": "..."}`;

// Fix rounds get a small, separate dispatch budget — they exist to patch specific
// reflection issues, not to re-run the whole pipeline.
const MAX_FIX_DISPATCHES = 2;

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
  return dispatchLoop(trace, intent, deps, artifacts, new Set<string>(), MAX_SUPERVISOR_DISPATCHES);
}

/** Re-entry point after a failed ReflectionAgent verdict. Fresh dispatched set (redispatch is
 * allowed — a specialist may need to run again with new information), capped at 2 dispatches.
 *
 * Exception: DiagnosisAgent. Unlike AssessmentAgent/PlannerAgent (pure recomputation from
 * current artifacts), DiagnosisAgent re-extracts evidence from the same transcript and its
 * MasteryUpdater step mutates deps.masteryRows IN PLACE (mastery/confidence/evidence_count),
 * then persists them. If it already ran once this request (artifacts.analysis is set), letting
 * it run again would re-apply the same evidence on top of the already-updated rows — doubling
 * evidence_count and skewing mastery for a single real observation. So it's pre-seeded as
 * "already dispatched" whenever that happened, blocking a second invocation this request. */
export async function runSupervisorFixRound(
  trace: Trace,
  intent: "transcript" | "question",
  deps: SupervisorDeps,
  artifacts: RunArtifacts,
  reflectionIssues: string[],
): Promise<RunArtifacts> {
  const dispatched = new Set<string>();
  if (artifacts.analysis) dispatched.add("DiagnosisAgent");
  return dispatchLoop(trace, intent, deps, artifacts, dispatched, MAX_FIX_DISPATCHES, reflectionIssues);
}

async function dispatchLoop(
  trace: Trace,
  intent: "transcript" | "question",
  deps: SupervisorDeps,
  artifacts: RunArtifacts,
  dispatched: Set<string>,
  maxDispatches: number,
  reflectionIssues?: string[],
): Promise<RunArtifacts> {
  for (let i = 0; i < maxDispatches; i++) {
    // Budget guard: reserve calls for finalize/reflection; force finalize when tight.
    if (!trace.hasBudget(2)) break;

    const state = digest(intent, deps, artifacts, dispatched, reflectionIssues);
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
  reflectionIssues?: string[],
): string {
  const feedback = reflectionIssues?.length
    ? `REFLECTION FEEDBACK — the quality gate rejected the draft response for these reasons; ` +
      `dispatch the specialist(s) best placed to fix them, then finalize:\n` +
      reflectionIssues.map((iss, i) => `${i + 1}. ${iss}`).join("\n") +
      `\n\n`
    : "";
  return (
    feedback +
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
