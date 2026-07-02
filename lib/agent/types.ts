// Core types for the AutoTutor agent. Module names in Step.module must match
// the architecture diagram (scripts/diagram.py) exactly — the spec requires it.

export interface StepPrompt {
  system_prompt: string;
  user_prompt: string;
}

export interface Step {
  module: string;
  prompt: StepPrompt;
  response: unknown;
  /** true = an actual LLM chat call; false = deterministic module (shown for trace completeness) */
  llm: boolean;
}

/** Collects the steps[] trace and enforces the per-run LLM-call budget. */
export class Trace {
  steps: Step[] = [];
  llmCalls = 0;
  constructor(public runId: string, private maxLlmCalls: number) {}

  addLlm(module: string, prompt: StepPrompt, response: unknown): void {
    this.llmCalls += 1;
    this.steps.push({ module, prompt, response, llm: true });
  }

  addCode(module: string, inputSummary: string, response: unknown): void {
    this.steps.push({
      module,
      prompt: {
        system_prompt: "(deterministic module — no LLM call)",
        user_prompt: inputSummary,
      },
      response,
      llm: false,
    });
  }

  /** True while we still have LLM budget beyond a reserve. */
  hasBudget(reserve = 0): boolean {
    return this.llmCalls < this.maxLlmCalls - reserve;
  }
}

// ---------- domain ----------

export interface StudentRow {
  id: string;
  name: string;
  track: string;
  exam_date: string;
  target_grade: number;
}

export interface ConceptRow {
  id: string;
  sheelon: string;
  topic: string;
  name_en: string;
  name_he: string;
  description: string;
  exam_weight: number;
}

export interface MasteryRow {
  student_id: string;
  concept_id: string;
  mastery: number;
  confidence: number;
  evidence_count: number;
  last_evidence_at: string | null;
  error_patterns: string[];
}

export interface EvidenceEvent {
  concept_id: string;
  outcome: "correct" | "error" | "partial";
  error_pattern?: string;
  quote?: string;
}

export interface TranscriptAnalysis {
  session_summary: string;
  evidence: EvidenceEvent[];
  incomplete: boolean;
  clarification_needed?: string;
}

export interface GapDiagnosis {
  weak_concepts: { concept_id: string; mastery: number }[];
  root_causes: { concept_id: string; via: string; score: number }[];
}

export interface Probe {
  question: string;
  expected_answer: string;
  distinguishes: string;
}

export interface PaceReport {
  days_to_exam: number;
  sessions_left: number;
  weighted_mastery: number;
  expected_mastery_by_now: number;
  on_track: boolean;
  at_risk_topics: { topic: string; mastery: number; weight: number }[];
}

export interface Forecast {
  predicted_grade: number;
  interval_low: number;
  interval_high: number;
  lessons_needed: number;
  basis: Record<string, unknown>;
}

export interface ForecastAudit {
  verdict: "held" | "optimistic" | "pessimistic";
  critique: string;
  adjustment: string;
}

export interface RoadmapItem {
  lesson: number;
  focus_concepts: string[];
  goal: string;
}

export interface RunArtifacts {
  student?: StudentRow;
  analysis?: TranscriptAnalysis;
  masteryChanges?: { concept_id: string; from: number; to: number }[];
  diagnosis?: GapDiagnosis & { statement?: string };
  probes?: Probe[];
  pace?: PaceReport;
  forecast?: Forecast;
  priorForecast?: Forecast | null;
  audit?: ForecastAudit;
  roadmap?: RoadmapItem[];
  replanRationale?: string;
  brief?: string;
  queryAnswer?: string;
  clarification?: string;
  language: "en" | "he";
}
