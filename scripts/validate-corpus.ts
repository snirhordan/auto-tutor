// Validate the ingested Ministry corpus against the hand-curated 5u concept graph:
// every curated concept must retrieve at least one syllabus chunk and (non-foundation)
// one exam chunk above a similarity floor. Gaps are reported — the agent falls back to
// curated concept descriptions for uncovered concepts, so a gap degrades, never breaks.
//
// Usage: npx tsx scripts/validate-corpus.ts
import "dotenv/config";
import fs from "fs";
import path from "path";
import { embed } from "../lib/llm";
import { queryNamespace } from "../lib/pinecone";
import { NS_EXAMS, NS_SYLLABUS } from "../lib/config";

const SCORE_FLOOR = 0.3;

interface Concept {
  id: string;
  sheelon: string;
  name_en: string;
  name_he: string;
  description: string;
}

/** Direct-tag report from ExamParser output: how many real exam questions carry
 *  each concept id — a data-driven sanity check of the curated exam-topic weights. */
function taggedQuestionReport(root: string, concepts: Concept[]): void {
  const dir = path.join(root, "data/ministry/parsed");
  if (!fs.existsSync(dir)) {
    console.log("(no parsed exams yet — run scripts/parse-exams.ts for the tag report)\n");
    return;
  }
  const counts = new Map<string, number>();
  let total = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const { questions } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const q of questions ?? []) {
      total += 1;
      for (const id of q.concept_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  console.log(`== ExamParser tag report: ${total} questions across ${fs.readdirSync(dir).length} exams ==`);
  const untagged = concepts.filter((c) => c.sheelon !== "foundation" && !counts.has(c.id));
  for (const [id, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${id.padEnd(36)} ${n} questions`);
  }
  if (untagged.length) {
    console.log(`  ZERO tagged questions (${untagged.length}): ${untagged.map((c) => c.id).join(", ")}`);
  }
  console.log("");
}

async function main() {
  const root = path.join(__dirname, "..");
  const graph = JSON.parse(fs.readFileSync(path.join(root, "data/concepts_5u.json"), "utf8"));
  const concepts: Concept[] = graph.concepts;
  taggedQuestionReport(root, concepts);

  const queries = concepts.map((c) => `${c.name_he} — ${c.name_en}. ${c.description}`);
  const vectors = await embed(queries, "validate-corpus");

  const rows: { id: string; syl: number; exam: number; ok: boolean }[] = [];
  for (let i = 0; i < concepts.length; i++) {
    const c = concepts[i];
    const syl = await queryNamespace(NS_SYLLABUS, vectors[i], 3);
    const exam = await queryNamespace(NS_EXAMS, vectors[i], 3);
    const sylTop = syl[0]?.score ?? 0;
    const examTop = exam[0]?.score ?? 0;
    const needsExam = c.sheelon !== "foundation";
    const ok = sylTop >= SCORE_FLOOR && (!needsExam || examTop >= SCORE_FLOOR);
    rows.push({ id: c.id, syl: sylTop, exam: examTop, ok });
  }

  const covered = rows.filter((r) => r.ok).length;
  console.log(`coverage: ${covered}/${rows.length} concepts above floor ${SCORE_FLOOR}`);
  console.log("\nid".padEnd(36) + "syllabus  exam   ok");
  for (const r of rows) {
    console.log(
      r.id.padEnd(36) + r.syl.toFixed(3) + "     " + r.exam.toFixed(3) + "  " + (r.ok ? "✓" : "GAP"),
    );
  }
  const gaps = rows.filter((r) => !r.ok);
  if (gaps.length) {
    console.log(`\n${gaps.length} gaps — agent will fall back to curated descriptions for these.`);
  }
  fs.writeFileSync(
    path.join(root, "data/ministry/coverage-report.json"),
    JSON.stringify(rows, null, 2),
  );
  console.log("report -> data/ministry/coverage-report.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
