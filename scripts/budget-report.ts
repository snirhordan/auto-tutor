// Sum token usage from the llm_usage table — the per-module budget breakdown.
// LLMod.ai's dashboard is the billing ground truth; this shows where tokens go.
// Usage: npx tsx scripts/budget-report.ts
import "dotenv/config";
import { supabase } from "../lib/supabase";

// gpt-5-mini-class public pricing as planning numbers ($/1M tokens).
const IN_PER_M = 0.25;
const OUT_PER_M = 2.0;
const EMB_PER_M = 0.02;

async function main() {
  const { data, error } = await supabase().from("llm_usage").select("*");
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const byModule = new Map<string, { calls: number; inTok: number; outTok: number }>();
  for (const r of rows) {
    const m = byModule.get(r.module) ?? { calls: 0, inTok: 0, outTok: 0 };
    m.calls += 1;
    m.inTok += r.prompt_tokens;
    m.outTok += r.completion_tokens;
    byModule.set(r.module, m);
  }

  let total = 0;
  console.log("module".padEnd(42) + "calls   in-tokens  out-tokens   ~cost");
  for (const [mod, m] of [...byModule.entries()].sort((a, b) => b[1].inTok - a[1].inTok)) {
    const isEmb = mod === "Embedding";
    const cost = isEmb
      ? (m.inTok / 1e6) * EMB_PER_M
      : (m.inTok / 1e6) * IN_PER_M + (m.outTok / 1e6) * OUT_PER_M;
    total += cost;
    console.log(
      mod.padEnd(42) +
        String(m.calls).padStart(5) +
        String(m.inTok).padStart(12) +
        String(m.outTok).padStart(12) +
        `   $${cost.toFixed(4)}`,
    );
  }
  console.log("\nestimated total: $" + total.toFixed(4) + "  (budget: $13 — verify on LLMod.ai)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
