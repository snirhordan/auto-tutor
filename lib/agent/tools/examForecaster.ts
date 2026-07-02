// ExamForecaster [code, zero LLM]: topic-weighted grade forecast with a
// confidence interval that narrows as evidence accumulates. Deterministic —
// when a grader asks "why 78?", every term is inspectable in basis.
import type { ConceptRow, Forecast, MasteryRow, StudentRow, Trace } from "../types";
import { decayedMastery } from "./masteryUpdater";
import { saveForecast } from "../state";

// Exam score expected from a mastery level: exams punish partial mastery
// (an 0.6-mastery student loses method marks), hence the mild convexity.
const expectedScore = (m: number) => Math.pow(m, 1.3);

const LESSONS_PER_MASTERY_POINT = 6; // sessions to raise weighted mastery by 0.1 ≈ 0.6

export async function forecast(
  trace: Trace,
  student: StudentRow,
  masteryRows: MasteryRow[],
  concepts: ConceptRow[],
  now: Date,
  persist = true,
): Promise<Forecast> {
  const m = new Map(masteryRows.map((r) => [r.concept_id, decayedMastery(r, now)]));
  const conf = new Map(masteryRows.map((r) => [r.concept_id, r.confidence]));

  let grade = 0;
  let wSum = 0;
  let confSum = 0;
  const perTopic = new Map<string, { w: number; g: number }>();
  for (const c of concepts) {
    if (c.exam_weight <= 0) continue;
    const mast = m.get(c.id) ?? 0.5;
    const g = expectedScore(mast) * 100;
    grade += c.exam_weight * g;
    wSum += c.exam_weight;
    confSum += c.exam_weight * (conf.get(c.id) ?? 0.2);
    const t = perTopic.get(c.topic) ?? { w: 0, g: 0 };
    t.w += c.exam_weight;
    t.g += c.exam_weight * g;
    perTopic.set(c.topic, t);
  }
  grade = wSum > 0 ? grade / wSum : 50;
  const avgConfidence = wSum > 0 ? confSum / wSum : 0.2;

  // Interval width shrinks with confidence: ±(6..20) points.
  const half = 6 + 14 * (1 - avgConfidence);
  const weightedMastery = wSum > 0
    ? [...m.entries()].reduce((acc, [id, v]) => {
        const c = concepts.find((x) => x.id === id);
        return acc + (c?.exam_weight ?? 0) * v;
      }, 0) / wSum
    : 0.5;
  const gapToTarget = Math.max(0, student.target_grade / 100 - weightedMastery);
  const lessonsNeeded = Math.ceil(gapToTarget * 10 * LESSONS_PER_MASTERY_POINT);

  const f: Forecast = {
    predicted_grade: round1(grade),
    interval_low: round1(Math.max(0, grade - half)),
    interval_high: round1(Math.min(100, grade + half)),
    lessons_needed: lessonsNeeded,
    basis: {
      model: "sum over exam topics of weight × expected_score(mastery); expected_score = mastery^1.3",
      avg_confidence: round3(avgConfidence),
      weighted_mastery: round3(weightedMastery),
      per_topic: Object.fromEntries(
        [...perTopic.entries()].map(([t, v]) => [t, round1(v.g / v.w)]),
      ),
      target_grade: student.target_grade,
      as_of: now.toISOString().slice(0, 10),
    },
  };

  if (persist) await saveForecast(student.id, f);

  trace.addCode(
    "AssessmentAgent.ExamForecaster",
    `topic-weighted forecast for ${student.id} (target ${student.target_grade})`,
    f,
  );
  return f;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
