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
import { saveSession } from "../state";
import { curriculumSearch, SearchNamespace } from "../tools/curriculumSearch";
import { decayedMastery } from "../tools/masteryUpdater";

const REACT_SYSTEM = `You are DiagnosisAgent, the diagnostic specialist of an autonomous bagrut-math
tutoring agent — persona: a veteran 5-unit tutor who root-causes errors instead of treating symptoms.
You work in a ReAct loop (Thought → Action → Observation). Reason step by step (chain of thought) in
"thought", then pick ONE action:
- {"action": "diagnose_gaps", "args": {"concept_ids": ["..."]}} — traverse the prerequisite graph below the listed weak concepts to find root causes
- {"action": "search_curriculum", "args": {"namespace": "syllabus|exams", "query": "..."}} — retrieve real Ministry curriculum text (syllabus) or real past bagrut items (exams); the returned passages are quoted back to you, so ground your diagnosis in them. The corpus is in HEBREW — write the query in Hebrew (mathematical terms as a 5-unit teacher would write them), or recall will be poor
- {"action": "generate_probes", "args": {"targets": [{"concept_id": "...", "reason": "..."}]}} — ONLY when the evidence is too thin/ambiguous to tell competing explanations apart; produces opening questions for the next session
- {"action": "finish", "args": {"statement": "..."}} — one-paragraph diagnosis: WHAT is weak, WHY (root cause vs symptom), and how confident you are

Rules: never repeat an action with identical args; if evidence already pins the root cause, finish
without probes; if two explanations compete (e.g. dot-product formula vs trig signs underneath),
diagnose_gaps first, then decide whether probes are needed.
Reply in strict JSON: {"thought": "...", "action": "...", "args": {...}}`;

/** Curated fallback for when the vector corpus returns nothing: quote the curated
 *  concept catalog (the same descriptions seeded into Supabase) for the concepts this
 *  session actually touched. /api/agent_info promises "curated fallbacks"; without this
 *  the agent would simply lose all curriculum grounding on a miss. */
/** Render a retrieval result as a ReAct observation. Shared so a seeded search and one
 *  the agent chooses itself look identical in the trace. */
function retrievalObservation(
  label: string,
  outcome: { hits: { source: string; score: number; excerpt: string }[]; failed: boolean },
  curated: string,
): string {
  if (outcome.failed) {
    return (
      `${label} → RETRIEVAL ERROR: the corpus is unavailable. Do not treat this as ` +
      `evidence of absence; reason from the session evidence and the concept catalog.`
    );
  }
  if (outcome.hits.length) {
    return (
      `${label} → ${outcome.hits.length} passage(s):\n` +
      outcome.hits.map((h) => `  [${h.source} @${h.score}] ${h.excerpt}`).join("\n")
    );
  }
  return curated
    ? `${label} → no corpus match. Curated curriculum fallback:\n${curated}`
    : `${label} → no corpus match, and no curated description covers these concepts.`;
}

function curatedFallback(
  concepts: ConceptRow[],
  analysis: TranscriptAnalysis,
  result: DiagnosisResult,
): string {
  const ids = new Set<string>();
  for (const e of analysis.evidence ?? []) ids.add(e.concept_id);
  for (const w of result.diagnosis?.weak_concepts ?? []) ids.add(w.concept_id);
  for (const r of result.diagnosis?.root_causes ?? []) ids.add(r.concept_id);
  const rows = concepts.filter((c) => ids.has(c.id) && c.description).slice(0, 8);
  return rows.map((c) => `  [curated:${c.id}] ${c.name_en} — ${c.description}`).join("\n");
}

export interface DiagnosisResult {
  analysis: TranscriptAnalysis;
  masteryChanges: { concept_id: string; from: number; to: number }[];
  diagnosis?: GapDiagnosis & { statement?: string };
  probes?: Probe[];
}

/**
 * Deterministic safety net for the ReAct diagnostician.
 *
 * The model is still free to traverse other prerequisite branches later, but it
 * must not be able to finish before the concepts with non-correct evidence have
 * been checked against the numeric mastery threshold. This is zero-chat-cost
 * graph work and keeps the Supervisor's "clean session" decision grounded in
 * the mastery values that were just persisted.
 */
export function diagnoseTouchedGaps(
  trace: Trace,
  evidence: EvidenceEvent[],
  masteryRows: MasteryRow[],
  edges: { src: string; dst: string; strength: number }[],
  now: Date,
): GapDiagnosis | undefined {
  const focusConcepts = [
    ...new Set(
      evidence
        .filter((event) => event.outcome !== "correct")
        .map((event) => event.concept_id),
    ),
  ];
  return focusConcepts.length
    ? diagnoseGaps(trace, focusConcepts, masteryRows, edges, now)
    : undefined;
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
  // Persist the session BEFORE mutating mastery. applyEvidence commits durably, but the
  // rest of the run (assessment, planning, reflection) can still throw — and the route
  // then reports failure. Writing the audit trail first means a student's mastery is
  // never silently changed with no session explaining it.
  await saveSession(studentId, transcript, analysis.session_summary, analysis.evidence);
  const masteryChanges = await applyEvidence(trace, masteryRows, analysis.evidence, now);

  const result: DiagnosisResult = { analysis, masteryChanges };
  const observations: string[] = [];
  const seen = new Set<string>();

  // Establish the numeric gap baseline before asking the LLM to interpret it.
  // Previously the model could jump straight to `finish`, which created an
  // empty weak_concepts array even when a just-updated mastery was below 0.6.
  const baselineDiagnosis = diagnoseTouchedGaps(
    trace,
    analysis.evidence,
    masteryRows,
    edges,
    now,
  );
  if (baselineDiagnosis) {
    result.diagnosis = baselineDiagnosis;
    observations.push(
      `baseline diagnose_gaps → weak: ${baselineDiagnosis.weak_concepts
        .map((w) => `${w.concept_id}@${w.mastery}`)
        .join(", ") || "none"}; root causes: ${baselineDiagnosis.root_causes
        .map((r) => `${r.concept_id}(score ${r.score}, via ${r.via})`)
        .join(", ") || "none"}`,
    );
  }

  // Seed the ReAct loop with real Ministry curriculum text for whatever the student got
  // wrong. Retrieval is a single embedding call — no chat tokens, so it costs nothing
  // against MAX_LLM_CALLS_PER_RUN — and without it the loop routinely reasons its way to
  // "finish" without ever consulting the corpus, which left the Agentic RAG claim true
  // only in principle. The agent can still choose further searches of either namespace.
  const missed = (analysis.evidence ?? []).filter((e) => e.outcome !== "correct");
  if (missed.length) {
    const names = missed
      .map((e) => {
        const c = concepts.find((x) => x.id === e.concept_id);
        // Query in Hebrew — the corpus is Hebrew and cross-lingual recall is much worse
        // (measured on this index: 0.31 EN vs 0.53 HE top score on syllabus).
        return c?.name_he || c?.name_en || e.concept_id;
      })
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 6);
    const seedQuery = names.join(", ");
    observations.push(
      retrievalObservation(
        `search_curriculum(syllabus, "${seedQuery.slice(0, 60)}") [seeded from this session's errors]`,
        await curriculumSearch(trace, "syllabus", seedQuery),
        curatedFallback(concepts, analysis, result),
      ),
    );
  }

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
      trace,
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
      const ns = (String(value.args?.namespace ?? "syllabus") === "exams"
        ? "exams"
        : "syllabus") as SearchNamespace;
      const q = String(value.args?.query ?? "");
      const outcome = await curriculumSearch(trace, ns, q);
      observations.push(
        retrievalObservation(
          `search_curriculum(${ns}, "${q.slice(0, 60)}")`,
          outcome,
          curatedFallback(concepts, analysis, result),
        ),
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
