// Seed Supabase with the curated concept graph + demo students + baseline mastery.
// Usage: npx tsx scripts/seed.ts            (requires .env)
//        npx tsx scripts/seed.ts --reset    (also clears sessions/forecasts/plans/usage/students,
//                                             including any onboarded during test runs)
import "dotenv/config";
import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabase";

interface ConceptGraph {
  concepts: {
    id: string; sheelon: string; topic: string;
    name_en: string; name_he: string; description: string;
  }[];
  edges: { src: string; dst: string; strength: number }[];
  exam_topics: { topic: string; sheelon: string; weight: number; concepts: string[] }[];
}

interface StudentSpec {
  id: string; name: string; track: string; exam_date: string; target_grade: number;
  mastery_default: number;
  overrides: Record<string, { mastery: number; error_patterns?: string[] }>;
}

async function main() {
  const reset = process.argv.includes("--reset");
  const db = supabase();
  const root = path.join(__dirname, "..");
  const graph: ConceptGraph = JSON.parse(
    fs.readFileSync(path.join(root, "data/concepts_5u.json"), "utf8"),
  );
  const { students }: { students: StudentSpec[] } = JSON.parse(
    fs.readFileSync(path.join(root, "data/students/students.json"), "utf8"),
  );

  if (reset) {
    for (const t of ["llm_usage", "plans", "forecasts", "sessions", "mastery"]) {
      const { error } = await db.from(t).delete().neq(t === "llm_usage" ? "id" : "student_id", t === "llm_usage" ? -1 : "");
      if (error) throw new Error(`reset ${t}: ${error.message}`);
      console.log(`cleared ${t}`);
    }
    // Every mastery/sessions/forecasts/plans row referencing a student is already gone above
    // (FK order), so students itself can now be wiped clean — this also removes any students
    // the StudentOnboarder created during test runs.
    {
      const { error } = await db.from("students").delete().neq("id", "");
      if (error) throw new Error(`reset students: ${error.message}`);
      console.log("cleared students");
    }
  }

  // Per-concept exam weight = topic weight / #concepts in topic.
  const weight = new Map<string, number>();
  for (const t of graph.exam_topics) {
    for (const c of t.concepts) weight.set(c, t.weight / t.concepts.length);
  }

  const conceptRows = graph.concepts.map((c) => ({
    id: c.id, sheelon: c.sheelon, topic: c.topic,
    name_en: c.name_en, name_he: c.name_he, description: c.description,
    exam_weight: weight.get(c.id) ?? 0,
  }));
  {
    const { error } = await db.from("concepts").upsert(conceptRows);
    if (error) throw new Error(`concepts: ${error.message}`);
    console.log(`upserted ${conceptRows.length} concepts`);
  }
  {
    const { error } = await db.from("concept_edges").upsert(graph.edges);
    if (error) throw new Error(`concept_edges: ${error.message}`);
    console.log(`upserted ${graph.edges.length} edges`);
  }

  const studentRows = students.map((s) => ({
    id: s.id, name: s.name, track: s.track,
    exam_date: s.exam_date, target_grade: s.target_grade,
  }));
  {
    const { error } = await db.from("students").upsert(studentRows);
    if (error) throw new Error(`students: ${error.message}`);
    console.log(`upserted ${studentRows.length} students`);
  }

  const masteryRows = students.flatMap((s) =>
    graph.concepts.map((c) => {
      const o = s.overrides[c.id];
      return {
        student_id: s.id,
        concept_id: c.id,
        mastery: o?.mastery ?? s.mastery_default,
        confidence: o ? 0.5 : 0.25, // overrides represent observed history
        evidence_count: o ? 3 : 1,
        error_patterns: o?.error_patterns ?? [],
      };
    }),
  );
  {
    const { error } = await db.from("mastery").upsert(masteryRows);
    if (error) throw new Error(`mastery: ${error.message}`);
    console.log(`upserted ${masteryRows.length} mastery rows`);
  }

  console.log("seed complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
