// DiagnosisAgent [ReAct: Thought → Action → Observation, ≤5 iterations].
// After transcript analysis + deterministic mastery update, the agent DECIDES
// what to do next per what it observes: traverse the prerequisite graph, search
// the Ministry corpus, generate diagnostic probes, or finish. Different
// transcripts → different loop shapes — visible anti-pipeline evidence.
import { chatJSON } from "../../llm";
import { MAX_DIAGNOSIS_ITERATIONS } from "../../config";
import type {
  ConceptRow,
  EvidenceEvent,
  GapDiagnosis,
  MasteryRow,
  Probe,
  Trace,
  TranscriptAnalysis,
} from "../types";
import { analyzeTranscript } from "../tools/transcriptAnalyzer";
import { applyEvidence } from "../tools/masteryUpdater";
import { diagnoseGaps } from "../tools/gapDiagnoser";
import { generateProbes } from "../tools/probeGenerator";
import { curriculumSearch, SearchNamespace } from "../tools/curriculumSearch";
import { decayedMastery } from "../tools/masteryUpdater";

const REACT_SYSTEM = `You are DiagnosisAgent, the diagnostic specialist of an autonomous bagrut-math
tutoring agent — persona: a veteran 5-unit tutor who root-causes errors instead of treating symptoms.
You work in a ReAct loop (Thought → Action → Observation). Reason step by step (chain of thought) in
"thought", then pick ONE action:
- {"action": "diagnose_gaps", "args": {"concept_ids": ["..."]}} — traverse the prerequisite graph below the listed weak concepts to find root causes
- {"action": "search_curriculum", "args": {"namespace": "syllabus|exams|notes", "query": "..."}} — retrieve from the real Ministry corpus (syllabus text, past bagrut items) or this student's session notes
- {"action": "generate_probes", "args": {"targets": [{"concept_id": "...", "reason": "..."}]}} — ONLY when the evidence is too thin/ambiguous to tell competing explanations apart; produces opening questions for the next session
- {"action": "finish", "args": {"statement": "..."}} — one-paragraph diagnosis: WHAT is weak, WHY (root cause vs symptom), and how confident you are

Rules: never repeat an action with identical args; if evidence already pins the root cause, finish
without probes; if two explanations compete (e.g. dot-product formula vs trig signs underneath),
diagnose_gaps first, then decide whether probes are needed.
Reply in strict JSON: {"thought": "...", "action": "...", "args": {...}}`;

export interface DiagnosisResult {
  analysis: TranscriptAnalysis;
  masteryChanges: { concept_id: string; from: number; to: number }[];
  diagnosis?: GapDiagnosis & { statement?: string };
  probes?: Probe[];
}

export async function runDiagnosisAgent(
  trace: Trace,
  transcript: string,
  studentId: string,
  masteryRows: MasteryRow[],
  concepts: ConceptRow[],
  edges: { src: string; dst: string; strength: number }[],
  language: "en" | "he",
  now: Date,
): Promise<DiagnosisResult | { clarification: string }> {
  // Step 1 (always): extract evidence [LLM, few-shot], then deterministic mastery update.
  const analysis = await analyzeTranscript(trace, transcript, concepts, language);
  if (analysis.incomplete && analysis.clarification_needed) {
    return { clarification: analysis.clarification_needed };
  }
  const masteryChanges = await applyEvidence(trace, masteryRows, analysis.evidence, now);

  const result: DiagnosisResult = { analysis, masteryChanges };
  const observations: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < MAX_DIAGNOSIS_ITERATIONS && trace.hasBudget(5); i++) {
    const state = buildState(analysis.evidence, masteryRows, concepts, result, observations, now);
    const { value } = await chatJSON<{
      thought: string;
      action: string;
      args: Record<string, unknown>;
    }>({
      module: "DiagnosisAgent",
      system: REACT_SYSTEM,
      user: state,
      runId: trace.runId,
    });
    trace.addLlm("DiagnosisAgent", { system_prompt: REACT_SYSTEM, user_prompt: state }, value);

    const key = value.action + JSON.stringify(value.args ?? {});
    if (seen.has(key)) break; // loop guard (L6: ReAct can enter inefficient loops)
    seen.add(key);

    if (value.action === "finish") {
      if (result.diagnosis) result.diagnosis.statement = String(value.args?.statement ?? "");
      else result.diagnosis = { weak_concepts: [], root_causes: [], statement: String(value.args?.statement ?? "") };
      break;
    } else if (value.action === "diagnose_gaps") {
      const ids = (value.args?.concept_ids as string[]) ?? [];
      const d = diagnoseGaps(trace, ids, masteryRows, edges, now);
      result.diagnosis = { ...d, statement: result.diagnosis?.statement };
      observations.push(
        `diagnose_gaps(${ids.join(",")}) → weak: ${d.weak_concepts.map((w) => `${w.concept_id}@${w.mastery}`).join(", ") || "none"}; root causes: ${d.root_causes.map((r) => `${r.concept_id}(score ${r.score}, via ${r.via})`).join(", ") || "none"}`,
      );
    } else if (value.action === "search_curriculum") {
      const ns = String(value.args?.namespace ?? "syllabus") as SearchNamespace;
      const q = String(value.args?.query ?? "");
      const hits = await curriculumSearch(trace, ns, q, studentId);
      observations.push(
        `search_curriculum(${ns}, "${q.slice(0, 60)}") → ${hits.length ? hits.map((h) => `${h.source}@${h.score}`).join(", ") : "no hits (corpus fallback: curated descriptions)"}`,
      );
    } else if (value.action === "generate_probes") {
      const targets = (value.args?.targets as { concept_id: string; reason: string }[]) ?? [];
      result.probes = await generateProbes(trace, targets, concepts, language);
      observations.push(`generate_probes → ${result.probes.length} probes ready for next session`);
    } else {
      observations.push(`unknown action "${value.action}" ignored`);
    }
  }
  return result;
}

function buildState(
  evidence: EvidenceEvent[],
  masteryRows: MasteryRow[],
  concepts: ConceptRow[],
  result: DiagnosisResult,
  observations: string[],
  now: Date,
): string {
  const touched = [...new Set(evidence.map((e) => e.concept_id))];
  const related = masteryRows
    .filter((r) => touched.includes(r.concept_id) || decayedMastery(r, now) < 0.6)
    .slice(0, 20)
    .map((r) => {
      const c = concepts.find((x) => x.id === r.concept_id);
      return `${r.concept_id} (${c?.name_en}) mastery=${decayedMastery(r, now).toFixed(2)} conf=${r.confidence} errors=[${r.error_patterns.join(",")}]`;
    });
  return (
    `EVIDENCE THIS SESSION:\n${evidence.map((e) => `- ${e.concept_id}: ${e.outcome}${e.error_pattern ? ` [${e.error_pattern}]` : ""} "${e.quote ?? ""}"`).join("\n")}\n\n` +
    `STUDENT MASTERY (touched + weak):\n${related.join("\n")}\n\n` +
    `OBSERVATIONS SO FAR:\n${observations.length ? observations.map((o, i) => `${i + 1}. ${o}`).join("\n") : "(none yet)"}\n\n` +
    `PROBES GENERATED: ${result.probes?.length ?? 0}\nDIAGNOSIS DONE: ${result.diagnosis ? "graph traversal done" : "no"}`
  );
}
