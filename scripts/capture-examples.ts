// Capture REAL agent runs into data/agent_info_examples.json so /api/agent_info
// serves honest prompt_examples with their full steps[] traces.
// Run AFTER seeding + ingestion: npx tsx scripts/capture-examples.ts
import "dotenv/config";
import fs from "fs";
import path from "path";
import { executeAgent } from "../lib/agent/run";

const CASES = [
  { file: "data/transcripts/1_itai_vectors.txt", label: "transcript event (Itai, vectors)" },
  { prompt: "How is Itai doing? Will he reach his target by the exam?", label: "question about a student" },
];

async function main() {
  const root = path.join(__dirname, "..");
  const examples = [];
  for (const c of CASES) {
    const prompt = "file" in c && c.file
      ? fs.readFileSync(path.join(root, c.file), "utf8").trim()
      : (c as { prompt: string }).prompt;
    console.log(`running: ${c.label} ...`);
    const t0 = Date.now();
    const { response, steps } = await executeAgent(prompt);
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${steps.length} steps`);
    examples.push({ prompt, full_response: response, steps });
  }
  const out = { captured_from_real_runs: true, prompt_examples: examples };
  fs.writeFileSync(
    path.join(root, "data/agent_info_examples.json"),
    JSON.stringify(out, null, 2),
  );
  console.log("wrote data/agent_info_examples.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
