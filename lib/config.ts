// Central configuration for AutoTutor.
// Team info + model names + agent guardrails live here so they are one-line changes.

export const TEAM_INFO = {
  // Batch 3, group 6 — presenting 20.7.2026.
  group_batch_order_number: "3_6",
  team_name: "The Autonomous",
  students: [
    { name: "Snir Hordan", email: "snirhordan@campus.technion.ac.il" },
    { name: "Omer Yom Tov", email: "omer.yomtov@campus.technion.ac.il" },
    { name: "Oz Diamond", email: "oz.diamond@campus.technion.ac.il" },
  ],
};

export const CHAT_MODEL = process.env.CHAT_MODEL ?? "MB5R2CF-azure/gpt-5.4-mini";
export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "MB5R2CF-azure/text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

export const PINECONE_INDEX = process.env.PINECONE_INDEX ?? "auto-tutor";
// Pinecone namespaces (Agentic RAG: the agent chooses which to query)
export const NS_SYLLABUS = "syllabus";
export const NS_EXAMS = "exams";
export const nsNotes = (studentId: string) => `notes-${studentId}`;

// ---- Efficiency guardrails (Project Requirement 1) ----
// Hard cap on LLM calls per /api/execute run.
export const MAX_LLM_CALLS_PER_RUN = 20;
// SupervisorAgent: max sub-agent dispatches per run.
export const MAX_SUPERVISOR_DISPATCHES = 6;
// DiagnosisAgent: max ReAct iterations.
export const MAX_DIAGNOSIS_ITERATIONS = 5;
// ReflectionAgent: max critique rounds (skip-if-pass).
export const MAX_REFLECTION_ROUNDS = 1;
// ReflectionAgent → SupervisorAgent routing loop: max fix rounds if the quality gate fails.
export const MAX_REFLECTION_FIX_ROUNDS = 2;

// The standing goal — the agent owns this; users report events, not commands.
export const STANDING_GOAL =
  "Bring every student to their target grade by their bagrut exam date, " +
  "by maintaining an accurate model of what they know, planning their remaining " +
  "lessons, and correcting your own past assessments as new evidence arrives.";

// ---- Student onboarding (unknown student on a transcript event) ----
// Default target grade assumed for an onboarded student until the tutor corrects it.
export const DEFAULT_TARGET_GRADE = 85;
// Upcoming bagrut sitting dates (5-unit track) — kept in sync with the seeded demo cohort's
// calendar. Used to pick a plausible exam date for a student the agent has never seen before.
export const UPCOMING_EXAM_DATES = ["2026-07-22", "2027-01-26", "2027-07-21", "2028-01-24"];
// Don't onboard a student into a sitting that's already too close to prep for.
export const MIN_ONBOARD_RUNWAY_DAYS = 21;

/** First upcoming exam date at least MIN_ONBOARD_RUNWAY_DAYS out from `now`; falls back to the
 * last known sitting if every listed date is already within the runway window. */
export function nextExamDate(now: Date): string {
  const threshold = new Date(now.getTime() + MIN_ONBOARD_RUNWAY_DAYS * 24 * 60 * 60 * 1000);
  for (const date of UPCOMING_EXAM_DATES) {
    if (new Date(date) >= threshold) return date;
  }
  return UPCOMING_EXAM_DATES[UPCOMING_EXAM_DATES.length - 1];
}
