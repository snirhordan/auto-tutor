// ExamParser [LLM · strict JSON] — the Lecture-5 Toby "Resume Parser" pattern
// applied to bagrut exams: messy RTL-extracted text → clean structured questions.
//
// PDF math is typeset as positioned glyphs, so mechanical extraction shatters
// formulas (x²/9 + y²/b² = 1 → "b, y, 1, 2, 2, 2, +, =, 9"). This OFFLINE
// ingestion-time pass reconstructs each question as clean Hebrew with inline
// LaTeX, tags it with concept IDs from the curated catalog, and writes
// data/ministry/parsed/{exam}.json for ingest.ts to embed per-question.
//
// Usage: npx tsx scripts/parse-exams.ts [--limit N] [--force]
import "dotenv/config";
import fs from "fs";
import path from "path";
import { chatJSON } from "../lib/llm";

const ROOT = path.join(__dirname, "..");
const PARSED_DIR = path.join(ROOT, "data/ministry/parsed");

interface ParsedQuestion {
  number: number;
  text_he: string;
  concept_ids: string[];
  difficulty: "intro" | "on-level" | "hard";
  has_figure: boolean;
}

const SYSTEM = `You are an expert editor of Israeli bagrut mathematics exams (5 units, she'elonim 581/582).
You receive raw text extracted from an exam PDF. The Hebrew prose is readable, but mathematical
formulas were shattered into stray fragments (isolated digits, letters, "+", "=" on their own lines)
because the PDF positions formula glyphs individually. Your job — reconstruct the exam faithfully:

1. Rebuild each TOP-LEVEL question (1, 2, 3, ...) as clean, fluent Hebrew, merging its sub-parts
   (א, ב, ג + numbered items) into one text_he string with the sub-part labels kept inline.
2. Reassemble every formula as inline LaTeX between $...$ — e.g. the fragments "x", "2", "9", "y",
   "2", "b", "2", "+", "=", "1" near an ellipse question become $\\frac{x^2}{9}+\\frac{y^2}{b^2}=1$.
   Use the surrounding mathematics to infer structure; NEVER invent values that are not among the
   fragments or implied by the text.
3. Where the question references a drawing, add "[איור: <one-line description of what it shows>]" —
   describe only what the text implies, do not invent details.
4. Tag each question with concept_ids from the provided catalog (only ids that appear there; 1-4 per
   question, most specific first) and a difficulty band: "intro" | "on-level" | "hard" (bagrut
   questions are mostly "on-level"; "hard" for multi-concept synthesis or unusual twists).
5. has_figure: true iff the question relies on a drawing.

Reply with STRICT JSON only:
{"questions": [{"number": 1, "text_he": "...", "concept_ids": ["..."], "difficulty": "on-level", "has_figure": true}]}

Example — fragments:
"נתונה אליפסה שמשוואתה / 2 / y / x , b הוא פרמטר חיובי / 1 / b / 2 / 2 / + / = / 9 / .1
ידוע כי המוקדים של האליפסה נמצאים על ציר ה־ x ."
Reconstruction (start of text_he for question 1):
"נתונה אליפסה שמשוואתה $\\frac{x^2}{9}+\\frac{y^2}{b^2}=1$, כאשר $b$ הוא פרמטר חיובי. ידוע כי המוקדים של האליפסה נמצאים על ציר ה־$x$. ..."`;

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
  const force = process.argv.includes("--force");

  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/ministry/manifest.json"), "utf8"),
  ) as { file: string; kind: string; code?: number }[];
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, "data/concepts_5u.json"), "utf8"));
  fs.mkdirSync(PARSED_DIR, { recursive: true });

  const exams = manifest.filter((m) => m.kind === "exam").slice(0, limit);
  let done = 0;

  for (const exam of exams) {
    const outPath = path.join(PARSED_DIR, exam.file + ".json");
    if (fs.existsSync(outPath) && !force) {
      console.log(`skip ${exam.file} (already parsed)`);
      continue;
    }
    const text = fs.readFileSync(
      path.join(ROOT, "data/ministry/extracted", exam.file + ".txt"),
      "utf8",
    );

    // Catalog subset: the exam's own she'elon + foundation (for prerequisite tags).
    const sheelon = exam.code === 35581 ? "581" : "582";
    const catalog = graph.concepts
      .filter((c: { sheelon: string }) => c.sheelon === sheelon || c.sheelon === "foundation")
      .map((c: { id: string; name_he: string; name_en: string }) => `${c.id} = ${c.name_he} / ${c.name_en}`)
      .join("\n");

    const user =
      `CONCEPT CATALOG (tag only with these ids):\n${catalog}\n\n` +
      `EXAM (she'elon ${sheelon}, file ${exam.file}) — raw extracted text:\n${text}`;

    console.log(`parsing ${exam.file} ...`);
    const { value } = await chatJSON<{ questions: ParsedQuestion[] }>({
      module: "ExamParser",
      system: SYSTEM,
      user,
      runId: "parse-exams",
    });

    const valid = new Set(graph.concepts.map((c: { id: string }) => c.id));
    const questions = (value.questions ?? []).map((q) => ({
      ...q,
      concept_ids: (q.concept_ids ?? []).filter((id) => valid.has(id)),
    }));
    fs.writeFileSync(outPath, JSON.stringify({ file: exam.file, questions }, null, 2));
    console.log(`  -> ${questions.length} questions, tags: ${questions.map((q) => q.concept_ids.length).join(",")}`);
    done += 1;
  }
  console.log(`parsed ${done}/${exams.length} exams -> ${PARSED_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
