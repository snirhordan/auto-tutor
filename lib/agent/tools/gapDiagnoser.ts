// GapDiagnoser [code + prerequisite graph, zero LLM]: recursive traversal of the
// is-prerequisite-of graph to find the ROOT CAUSE behind weak concepts — is the
// problem vectors, or the 10th-grade trig underneath? The ReAct loop interprets
// the returned candidates.
import type { GapDiagnosis, MasteryRow, Trace } from "../types";
import { decayedMastery } from "./masteryUpdater";

const WEAK_THRESHOLD = 0.6;

export function diagnoseGaps(
  trace: Trace,
  focusConcepts: string[],
  masteryRows: MasteryRow[],
  edges: { src: string; dst: string; strength: number }[],
  now: Date,
): GapDiagnosis {
  const mastery = new Map(masteryRows.map((r) => [r.concept_id, decayedMastery(r, now)]));
  const prereqs = new Map<string, { dst: string; strength: number }[]>();
  for (const e of edges) {
    if (!prereqs.has(e.src)) prereqs.set(e.src, []);
    prereqs.get(e.src)!.push({ dst: e.dst, strength: e.strength });
  }

  const weak = focusConcepts
    .map((id) => ({ concept_id: id, mastery: mastery.get(id) ?? 0.5 }))
    .filter((c) => c.mastery < WEAK_THRESHOLD);

  // Walk down the prerequisite chains; a root cause scores by
  // (path strength) × (how weak the prerequisite itself is).
  const rootCauses = new Map<string, { via: string; score: number }>();
  const walk = (id: string, via: string, pathStrength: number, depth: number) => {
    if (depth > 4) return;
    for (const p of prereqs.get(id) ?? []) {
      const m = mastery.get(p.dst) ?? 0.5;
      const strength = pathStrength * p.strength;
      const score = strength * (1 - m);
      if (m < WEAK_THRESHOLD) {
        const prev = rootCauses.get(p.dst);
        if (!prev || prev.score < score) rootCauses.set(p.dst, { via, score });
      }
      walk(p.dst, via, strength, depth + 1);
    }
  };
  for (const w of weak) walk(w.concept_id, w.concept_id, 1, 0);

  // A weak prerequisite outranks the surface concept it explains.
  const result: GapDiagnosis = {
    weak_concepts: weak.map((w) => ({ ...w, mastery: round3(w.mastery) })),
    root_causes: [...rootCauses.entries()]
      .map(([concept_id, v]) => ({ concept_id, via: v.via, score: round3(v.score) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  };

  trace.addCode(
    "DiagnosisAgent.GapDiagnoser",
    `prerequisite-graph traversal from [${focusConcepts.join(", ")}]`,
    result,
  );
  return result;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
