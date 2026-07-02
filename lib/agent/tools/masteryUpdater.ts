// MasteryUpdater [code, zero LLM]: evidence-weighted mastery update with
// time decay. The LLM only extracts evidence (TranscriptAnalyzer); the numbers
// are computed deterministically here — reproducible and defensible.
import type { EvidenceEvent, MasteryRow, Trace } from "../types";
import { upsertMastery } from "../state";

const LEARN_RATE = 0.35; // pull toward the observed outcome
const DECAY_HALF_LIFE_DAYS = 45; // mastery drifts toward 0.5 when unpracticed

const target = (o: EvidenceEvent["outcome"]): number =>
  o === "correct" ? 1 : o === "error" ? 0 : 0.5;

/** Time decay applied on read: unpracticed mastery drifts toward 0.5. */
export function decayedMastery(row: MasteryRow, now: Date): number {
  if (!row.last_evidence_at) return row.mastery;
  const days = (now.getTime() - new Date(row.last_evidence_at).getTime()) / 86_400_000;
  if (days <= 0) return row.mastery;
  const k = Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS);
  return 0.5 + (row.mastery - 0.5) * k;
}

export async function applyEvidence(
  trace: Trace,
  masteryRows: MasteryRow[],
  evidence: EvidenceEvent[],
  now: Date,
): Promise<{ concept_id: string; from: number; to: number }[]> {
  const byId = new Map(masteryRows.map((r) => [r.concept_id, r]));
  const changes: { concept_id: string; from: number; to: number }[] = [];
  const touched: MasteryRow[] = [];

  for (const ev of evidence) {
    const row = byId.get(ev.concept_id);
    if (!row) continue; // unknown concept id — TranscriptAnalyzer maps onto the catalog, so this is rare
    const from = decayedMastery(row, now);
    const t = target(ev.outcome);
    const to = clamp01(from + LEARN_RATE * (t - from));
    row.mastery = round3(to);
    row.confidence = round3(clamp01(row.confidence + 0.1));
    row.evidence_count += 1;
    row.last_evidence_at = now.toISOString();
    if (ev.error_pattern && !row.error_patterns.includes(ev.error_pattern)) {
      row.error_patterns = [...row.error_patterns, ev.error_pattern];
    }
    changes.push({ concept_id: ev.concept_id, from: round3(from), to: round3(to) });
    if (!touched.includes(row)) touched.push(row);
  }

  if (touched.length) await upsertMastery(touched);

  trace.addCode(
    "DiagnosisAgent.MasteryUpdater",
    `apply ${evidence.length} evidence events (learn-rate ${LEARN_RATE}, decay half-life ${DECAY_HALF_LIFE_DAYS}d)`,
    { changes },
  );
  return changes;
}

const clamp01 = (x: number) => Math.max(0.02, Math.min(0.98, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;
