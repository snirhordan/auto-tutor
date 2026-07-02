// CurriculumPacer [code, zero LLM]: proactive calendar awareness. Computes where
// the student SHOULD be by today (given the exam date) vs. where they are —
// the agent diagnoses schedule deviation without being asked.
import type { ConceptRow, MasteryRow, PaceReport, StudentRow, Trace } from "../types";
import { decayedMastery } from "./masteryUpdater";

const SESSIONS_PER_WEEK = 2;
const STUDY_WINDOW_DAYS = 180; // assumed prep runway before a bagrut exam
const EXAM_READY_MASTERY = 0.85; // weighted mastery considered exam-ready

export function pace(
  trace: Trace,
  student: StudentRow,
  masteryRows: MasteryRow[],
  concepts: ConceptRow[],
  now: Date,
): PaceReport {
  const weightById = new Map(concepts.map((c) => [c.id, c.exam_weight]));
  const topicById = new Map(concepts.map((c) => [c.id, c.topic]));
  const m = new Map(masteryRows.map((r) => [r.concept_id, decayedMastery(r, now)]));

  let wSum = 0;
  let wMastery = 0;
  const topicAgg = new Map<string, { w: number; wm: number }>();
  for (const c of concepts) {
    const w = weightById.get(c.id) ?? 0;
    if (w <= 0) continue;
    const mast = m.get(c.id) ?? 0.5;
    wSum += w;
    wMastery += w * mast;
    const t = topicAgg.get(topicById.get(c.id)!) ?? { w: 0, wm: 0 };
    t.w += w;
    t.wm += w * mast;
    topicAgg.set(topicById.get(c.id)!, t);
  }
  const weightedMastery = wSum > 0 ? wMastery / wSum : 0.5;

  const daysToExam = Math.max(
    0,
    Math.round((new Date(student.exam_date).getTime() - now.getTime()) / 86_400_000),
  );
  const sessionsLeft = Math.floor((daysToExam / 7) * SESSIONS_PER_WEEK);
  // Expected progress: linear ramp from 0.5 baseline to exam-ready over the study window.
  const progress = Math.min(1, Math.max(0, (STUDY_WINDOW_DAYS - daysToExam) / STUDY_WINDOW_DAYS));
  const expectedByNow = 0.5 + (EXAM_READY_MASTERY - 0.5) * progress;

  const atRisk = [...topicAgg.entries()]
    .map(([topic, t]) => ({ topic, mastery: round3(t.wm / t.w), weight: round3(t.w) }))
    .filter((t) => t.mastery < expectedByNow - 0.1)
    .sort((a, b) => a.mastery - b.mastery);

  const report: PaceReport = {
    days_to_exam: daysToExam,
    sessions_left: sessionsLeft,
    weighted_mastery: round3(weightedMastery),
    expected_mastery_by_now: round3(expectedByNow),
    on_track: weightedMastery >= expectedByNow - 0.05,
    at_risk_topics: atRisk,
  };

  trace.addCode(
    "AssessmentAgent.CurriculumPacer",
    `exam ${student.exam_date}, ${daysToExam} days out, ${SESSIONS_PER_WEEK} sessions/week assumed`,
    report,
  );
  return report;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
