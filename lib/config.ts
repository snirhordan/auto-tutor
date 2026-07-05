// Central configuration for AutoTutor.
// Team info + model names + agent guardrails live here so they are one-line changes.

export const TEAM_INFO = {
  // Batch 3, group 8 — presenting 20.7.2026.
  group_batch_order_number: "3_8",
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
export const MAX_LLM_CALLS_PER_RUN = 15;
// SupervisorAgent: max sub-agent dispatches per run.
export const MAX_SUPERVISOR_DISPATCHES = 6;
// DiagnosisAgent: max ReAct iterations.
export const MAX_DIAGNOSIS_ITERATIONS = 5;
// ReflectionAgent: max critique rounds (skip-if-pass).
export const MAX_REFLECTION_ROUNDS = 1;

// The standing goal — the agent owns this; users report events, not commands.
export const STANDING_GOAL =
  "Bring every student to their target grade by their bagrut exam date, " +
  "by maintaining an accurate model of what they know, planning their remaining " +
  "lessons, and correcting your own past assessments as new evidence arrives.";
