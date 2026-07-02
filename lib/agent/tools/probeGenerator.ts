// ProbeGenerator [LLM, ONE-SHOT]: when the agent is UNCERTAIN about a mastery
// estimate (thin/ambiguous evidence), it decides to gather information — three
// diagnostic questions the tutor opens the next session with. Acting to reduce
// its own uncertainty is the autonomy exhibit here.
import { chatJSON } from "../../llm";
import type { ConceptRow, Probe, Trace } from "../types";

const SYSTEM = `You are a veteran Israeli 5-unit bagrut math tutor writing DIAGNOSTIC probes.
Given target concepts and the suspected confusion, write exactly 3 short questions that
DISCRIMINATE between competing explanations of the student's errors (e.g., "is it the dot-product
formula, or trig quadrant signs underneath?"). Each probe must isolate ONE failure mode.
Reply in strict JSON: {"probes": [{"question": "...", "expected_answer": "...", "distinguishes": "..."}]}

Example — target: 5u.geo3d.vectors-dot (suspected sign-flip), prerequisite suspect: 5u.trig.ratios (quadrant-confusion).
Output:
{"probes": [
 {"question": "Compute u·v for u=(2,-3), v=(-1,4) — write each product term separately before summing.",
  "expected_answer": "(2)(-1) + (-3)(4) = -2 - 12 = -14",
  "distinguishes": "pure sign management in the dot product, no trig involved"},
 {"question": "What is the sign of cos(140°)? Answer without computing the value.",
  "expected_answer": "negative (second quadrant)",
  "distinguishes": "quadrant signs in trig, no vectors involved"},
 {"question": "If u·v = -5, |u|=3, |v|=5, is the angle between u and v acute or obtuse, and why?",
  "expected_answer": "obtuse, because cosθ = -5/15 < 0",
  "distinguishes": "connecting dot-product sign to the angle — the composite skill"}]}`;

export async function generateProbes(
  trace: Trace,
  targets: { concept_id: string; reason: string }[],
  concepts: ConceptRow[],
  language: "en" | "he",
): Promise<Probe[]> {
  const lines = targets.map((t) => {
    const c = concepts.find((x) => x.id === t.concept_id);
    return `${t.concept_id} (${c?.name_en ?? "?"} / ${c?.name_he ?? "?"}) — ${t.reason}`;
  });
  const user =
    `TARGETS:\n${lines.join("\n")}\n\nWrite the probes in ${language === "he" ? "Hebrew" : "English"}.`;

  const { value } = await chatJSON<{ probes: Probe[] }>({
    module: "DiagnosisAgent.ProbeGenerator",
    system: SYSTEM,
    user,
    runId: trace.runId,
  });
  trace.addLlm(
    "DiagnosisAgent.ProbeGenerator",
    { system_prompt: SYSTEM, user_prompt: user },
    value,
  );
  return value.probes ?? [];
}
