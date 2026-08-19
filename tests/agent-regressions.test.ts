import { describe, expect, it } from "vitest";
import {
  aggregateMasteryChanges,
  compose,
  ensureTranscriptResponseSections,
} from "../lib/agent/run";
import { diagnoseTouchedGaps } from "../lib/agent/subagents/diagnosisAgent";
import { Trace, type RunArtifacts } from "../lib/agent/types";
import { parseFirstJSONObject } from "../lib/llm";

const now = new Date("2026-08-18T00:00:00.000Z");

describe("diagnosis regression", () => {
  it("flags a touched concept below the mastery threshold before the ReAct model can finish", () => {
    const trace = new Trace("test", 20);
    const diagnosis = diagnoseTouchedGaps(
      trace,
      [
        { concept_id: "vectors-dot", outcome: "error" },
        { concept_id: "vectors-dot", outcome: "partial" },
        { concept_id: "vectors-basic", outcome: "correct" },
      ],
      [
        {
          student_id: "student",
          concept_id: "vectors-dot",
          mastery: 0.471,
          confidence: 0.5,
          evidence_count: 2,
          last_evidence_at: now.toISOString(),
          error_patterns: ["sign-flip"],
        },
      ],
      [],
      now,
    );

    expect(diagnosis?.weak_concepts).toEqual([
      { concept_id: "vectors-dot", mastery: 0.471 },
    ]);
    expect(trace.steps.at(-1)?.module).toBe("DiagnosisAgent.GapDiagnoser");
  });
});

describe("strict JSON regression", () => {
  it("uses the first valid object when a provider repeats its JSON reply", () => {
    const first = {
      thought: "Transcript events require diagnosis first.",
      dispatch: "DiagnosisAgent",
    };
    const repeated = `${JSON.stringify(first)}\n${JSON.stringify(first)}`;

    expect(parseFirstJSONObject(repeated)).toEqual(first);
  });

  it("handles braces inside strings but rejects a truncated object", () => {
    expect(parseFirstJSONObject('{"value":"use {x}","nested":{"ok":true}} trailing')).toEqual({
      value: "use {x}",
      nested: { ok: true },
    });
    expect(parseFirstJSONObject('{"dispatch":"DiagnosisAgent"')).toBeUndefined();
    expect(parseFirstJSONObject('{"outer":{"dispatch":"DiagnosisAgent"}')).toBeUndefined();
  });
});

describe("response-composer regressions", () => {
  const artifacts: RunArtifacts = {
    language: "en",
    analysis: {
      session_summary: "Vector signs remain fragile.",
      evidence: [],
      incomplete: false,
    },
    masteryChanges: [
      { concept_id: "vectors-dot", from: 0.7, to: 0.455 },
      { concept_id: "vectors-dot", from: 0.455, to: 0.471 },
      { concept_id: "vectors-basic", from: 0.775, to: 0.854 },
    ],
    diagnosis: {
      weak_concepts: [{ concept_id: "vectors-dot", mastery: 0.471 }],
      root_causes: [],
      statement: "The root cause is sign control.",
    },
    pace: {
      days_to_exam: 160,
      sessions_left: 45,
      weighted_mastery: 0.73,
      expected_mastery_by_now: 0.539,
      on_track: true,
      at_risk_topics: [],
    },
    forecast: {
      predicted_grade: 66.6,
      interval_low: 50.8,
      interval_high: 82.4,
      lessons_needed: 13,
      basis: {},
    },
  };

  it("summarizes sequential mastery evidence as one net change per concept", () => {
    expect(aggregateMasteryChanges(artifacts.masteryChanges!)).toEqual([
      { concept_id: "vectors-dot", from: 0.7, to: 0.471, observations: 2 },
      { concept_id: "vectors-basic", from: 0.775, to: 0.854, observations: 1 },
    ]);

    const response = compose(artifacts);
    expect(response.match(/`vectors-dot`/g)).toHaveLength(1);
    expect(response).toContain("0.7 → **0.471** (2 observations)");
  });

  it("restores forecast and other artifact-backed sections removed by reflection", () => {
    const shortened = "## Session summary\nVector signs remain fragile.";
    const ensured = ensureTranscriptResponseSections(shortened, artifacts);

    expect(ensured).toContain("## Mastery updates");
    expect(ensured).toContain("## Diagnosis");
    expect(ensured).toContain("## Pace & forecast");
    expect(ensured).toContain("**66.6** [50.8–82.4]");
  });
});
