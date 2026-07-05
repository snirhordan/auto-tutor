// Eval suite: replays the 6 demo inputs against a RUNNING server with a seeded
// DB and asserts the autonomy behaviors the project is graded on.
//
// Run:  RUN_EVAL=1 BASE_URL=http://localhost:3000 npx vitest run tests/eval.test.ts
// Skipped entirely unless RUN_EVAL=1 (it spends real LLM budget: ~$0.15/run).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const RUN = process.env.RUN_EVAL === "1";
const BASE =
  process.env.BASE_URL && process.env.BASE_URL.startsWith("http")
    ? process.env.BASE_URL
    : "http://localhost:3000";
const d = describe.skipIf(!RUN);

interface Step {
  module: string;
  prompt: { system_prompt: string; user_prompt: string };
  response: unknown;
  llm?: boolean;
}
interface ExecuteResponse {
  status: string;
  error: string | null;
  response: string | null;
  steps: Step[];
}

const t = (f: string) =>
  fs.readFileSync(path.join(__dirname, "..", "data", "transcripts", f), "utf8").trim();

async function run(prompt: string): Promise<ExecuteResponse> {
  const res = await fetch(`${BASE}/api/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return (await res.json()) as ExecuteResponse;
}

const modules = (r: ExecuteResponse) => r.steps.map((s) => s.module);
const llmCalls = (r: ExecuteResponse) => r.steps.filter((s) => s.llm !== false).length;

function assertStepSchema(r: ExecuteResponse) {
  expect(r.status).toBe("ok");
  expect(r.error).toBeNull();
  expect(typeof r.response).toBe("string");
  for (const s of r.steps) {
    expect(typeof s.module).toBe("string");
    expect(typeof s.prompt.system_prompt).toBe("string");
    expect(typeof s.prompt.user_prompt).toBe("string");
    expect(s.response).toBeDefined();
  }
}

d("AutoTutor eval — autonomy behaviors", () => {
  // Ordered scenario: Itai #1 must run before Itai #2 (self-correction needs a stored forecast).
  let itai1: ExecuteResponse;
  let itai2: ExecuteResponse;
  let noa: ExecuteResponse;
  let dana: ExecuteResponse;

  it("1) Itai transcript: full diagnostic trace, mastery updated, budget respected", async () => {
    itai1 = await run(t("1_itai_vectors.txt"));
    assertStepSchema(itai1);
    const m = modules(itai1);
    expect(m).toContain("IntentRouter");
    expect(m).toContain("SupervisorAgent");
    expect(m).toContain("DiagnosisAgent.TranscriptAnalyzer");
    expect(m).toContain("DiagnosisAgent.MasteryUpdater");
    expect(m).toContain("AssessmentAgent.ExamForecaster");
    expect(llmCalls(itai1)).toBeLessThanOrEqual(15);
  });

  it("2) Itai probe session: the agent audits its own prior forecast (self-correction)", async () => {
    itai2 = await run(t("2_itai_probes.txt"));
    assertStepSchema(itai2);
    expect(modules(itai2)).toContain("AssessmentAgent.ForecastAuditor");
    expect(llmCalls(itai2)).toBeLessThanOrEqual(15);
  });

  it("3) Noa clean session: no weak concepts + on track → no replan, shorter trace", async () => {
    noa = await run(t("3_noa_clean.txt"));
    assertStepSchema(noa);
    expect(llmCalls(noa)).toBeLessThanOrEqual(15);
    expect(modules(noa)).not.toContain("PlannerAgent.PlannerLLM");
  });

  it("4) Dana behind schedule: pace crisis reaches the planner", async () => {
    dana = await run(t("4_dana_behind.txt"));
    assertStepSchema(dana);
    const m = modules(dana);
    expect(m).toContain("AssessmentAgent.CurriculumPacer");
    // pace report should mark her behind
    const paceStep = dana.steps.find((s) => s.module === "AssessmentAgent.CurriculumPacer");
    expect((paceStep?.response as { on_track?: boolean })?.on_track).toBe(false);
  });

  it("5) traces DIFFER across inputs (anti-pipeline evidence)", () => {
    const seqs = [itai1, itai2, noa, dana].map((r) => modules(r).join("→"));
    // At least 3 distinct dispatch shapes across 4 contrasting inputs; the
    // per-scenario tests above pin the specific behavioral differences.
    expect(new Set(seqs).size).toBeGreaterThanOrEqual(3);
  });

  it("6) incomplete transcript → clarifying question, not a fabricated analysis", async () => {
    const r = await run(t("5_incomplete.txt"));
    expect(r.status).toBe("ok");
    // A clarification request: asks for the missing material (phrasing varies).
    expect(r.response).toMatch(/\?|please (provide|paste|share)|missing|cut off|נא|חסר/i);
    expect(modules(r)).not.toContain("PlannerAgent.PlannerLLM");
  });

  it("7) out-of-scope → refusal that explains the agent's scope", async () => {
    const r = await run(t("6_out_of_scope.txt"));
    expect(r.status).toBe("ok");
    expect(r.response).toMatch(/scope|תחום/i);
    expect(llmCalls(r)).toBeLessThanOrEqual(3);
  });

  it("8) question about a student → answered from stored state", async () => {
    const r = await run("How is Itai doing? Will he reach his target by the exam?");
    assertStepSchema(r);
    expect(modules(r)).toContain("StudentQueryAgent");
    expect(modules(r)).not.toContain("DiagnosisAgent.TranscriptAnalyzer");
  });
});
