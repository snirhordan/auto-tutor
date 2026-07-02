// TranscriptAnalyzer [LLM, FEW-SHOT]: extracts structured evidence events from a
// raw tutoring-session transcript. Persona + few-shot examples (L8) pin the strict
// JSON format; the mastery MATH happens in MasteryUpdater (code), not here.
import { chatJSON } from "../../llm";
import type { ConceptRow, Trace, TranscriptAnalysis } from "../types";

const SYSTEM = `You are a veteran Israeli 5-unit bagrut math tutor reviewing a raw session transcript.
Extract EVIDENCE EVENTS: moments where the student demonstrably succeeded, failed, or partially
handled a specific concept. Map every event onto the closest concept_id from the provided catalog —
never invent ids. Tag recurring mistake types as short kebab-case error_pattern tags
(e.g. "sign-flip", "quadrant-confusion", "formula-recall").
If the transcript is too fragmentary to extract meaningful evidence (a few lines, cut off,
missing the actual math work), set incomplete=true and write ONE precise clarification question
in clarification_needed asking the tutor for what is missing.
Reply in strict JSON:
{"session_summary": "...", "evidence": [{"concept_id": "...", "outcome": "correct|error|partial",
"error_pattern": "...", "quote": "..."}], "incomplete": false, "clarification_needed": null}

Example 1 — input:
"Tutor: find the angle between u=(1,-2,2) and v=(3,0,-4). Itai: u·v = 3+0+8 = 11. Tutor: check the last term.
Itai: oh, 2·(-4) is -8... so 3-8=-5. Then cos = -5/15, angle ≈ 109°. Tutor: good. Now derive |u|. Itai: 3, instantly."
Output:
{"session_summary": "Vectors session: dot-product sign error self-corrected with prompting; magnitudes fluent.",
"evidence": [
 {"concept_id": "5u.geo3d.vectors-dot", "outcome": "error", "error_pattern": "sign-flip", "quote": "u·v = 3+0+8 = 11"},
 {"concept_id": "5u.geo3d.vectors-dot", "outcome": "partial", "error_pattern": null, "quote": "cos = -5/15, angle ≈ 109°"},
 {"concept_id": "5u.geo3d.vectors-basic", "outcome": "correct", "error_pattern": null, "quote": "|u| = 3, instantly"}],
"incomplete": false, "clarification_needed": null}

Example 2 — input:
"Tutor: let's review the homework. Noa: I did questions 1-4."
Output:
{"session_summary": "Fragment only — no mathematical work shown.", "evidence": [],
"incomplete": true, "clarification_needed": "The transcript ends before any math work appears — please paste the part of the session where the student actually solves problems (or state which concepts were worked on and how the student did)."}`;

export async function analyzeTranscript(
  trace: Trace,
  transcript: string,
  concepts: ConceptRow[],
  language: "en" | "he",
): Promise<TranscriptAnalysis> {
  const catalog = concepts
    .map((c) => `${c.id} = ${c.name_en} / ${c.name_he}`)
    .join("\n");
  const user =
    `CONCEPT CATALOG:\n${catalog}\n\nTRANSCRIPT:\n${transcript}\n\n` +
    `Write session_summary in ${language === "he" ? "Hebrew" : "English"}.`;

  const { value } = await chatJSON<TranscriptAnalysis>({
    module: "DiagnosisAgent.TranscriptAnalyzer",
    system: SYSTEM,
    user,
    runId: trace.runId,
  });
  // Defensive normalization
  value.evidence = (value.evidence ?? []).filter((e) =>
    concepts.some((c) => c.id === e.concept_id),
  );
  trace.addLlm(
    "DiagnosisAgent.TranscriptAnalyzer",
    { system_prompt: SYSTEM, user_prompt: truncate(user, 4000) },
    value,
  );
  return value;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " …[truncated]" : s);
