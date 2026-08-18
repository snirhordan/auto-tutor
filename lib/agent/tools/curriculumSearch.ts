// CurriculumSearch [Agentic RAG]: retrieval over the REAL Ministry corpus.
// The calling agent CHOOSES the namespace per query — syllabus text or past bagrut
// items — the Lecture-3 multi-vector-DB scenario. One embedding call, no chat tokens.
//
// The retrieved PASSAGE TEXT is returned to the caller and threaded into the ReAct
// loop's observations, so the corpus actually grounds what the agent says. Returning
// only source ids would make this step decorative.
import { embed } from "../../llm";
import { queryNamespace } from "../../pinecone";
import { NS_EXAMS, NS_SYLLABUS } from "../../config";
import type { Trace } from "../types";

export type SearchNamespace = "syllabus" | "exams";

const TOP_K = 4; // L3: general text 3–5
const MAX_EXCERPT_CHARS = 400;
const MIN_EXCERPT_CHARS = 40;
// Ministry PDFs are typeset as positioned glyphs, so some chunks (the formula sheet
// especially) extract as runs of bare digits and punctuation. Feeding those to an LLM
// is worse than feeding nothing, so a chunk must be mostly real letters to qualify.
const MIN_LETTER_RATIO = 0.45;
// The corpus is Hebrew, so a Hebrew query scores ~0.5 on a real match while an unrelated
// chunk sits near 0.25. Below this floor the curated concept descriptions are better
// grounding than the passage, so don't forward noise into the prompt.
const MIN_SCORE = 0.3;

export interface SearchHit {
  source: string;
  score: number;
  excerpt: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** true = retrieval infrastructure failed. Distinct from "the corpus has no match",
   *  which the agent must be allowed to reason about differently. */
  failed: boolean;
}

/** Normalized excerpt, or null when the chunk carries too little readable text. */
export function readableExcerpt(text: string): string | null {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length < MIN_EXCERPT_CHARS) return null;
  const letters = (flat.match(/[A-Za-z֐-׿]/g) ?? []).length;
  if (letters / flat.length < MIN_LETTER_RATIO) return null;
  return flat.slice(0, MAX_EXCERPT_CHARS);
}

export async function curriculumSearch(
  trace: Trace,
  namespace: SearchNamespace,
  query: string,
): Promise<SearchOutcome> {
  const ns = namespace === "exams" ? NS_EXAMS : NS_SYLLABUS;
  let hits: SearchHit[] = [];
  let failed = false;
  let dropped = 0;

  try {
    const [vector] = await embed([query], trace.runId);
    const chunks = await queryNamespace(ns, vector, TOP_K);
    for (const c of chunks) {
      if (c.score < MIN_SCORE) {
        dropped += 1; // too weak to be about this query at all
        continue;
      }
      const excerpt = readableExcerpt(c.text);
      if (!excerpt) {
        dropped += 1; // unreadable glyph soup — never forward it to a prompt
        continue;
      }
      hits.push({
        source: String(c.metadata.source ?? c.id),
        score: Math.round(c.score * 1000) / 1000,
        excerpt,
      });
    }
  } catch {
    // Do NOT coerce an outage into "no results" — the caller must tell them apart.
    failed = true;
    hits = [];
  }

  trace.addCode(
    "DiagnosisAgent.CurriculumSearch",
    `Agentic RAG: namespace=${namespace}, query="${query.slice(0, 120)}"`,
    failed
      ? { retrieval_error: true, hits: [] }
      : { hits: hits.map((h) => ({ source: h.source, score: h.score, excerpt: h.excerpt })), chunks_dropped_low_score_or_unreadable: dropped },
    "(retrieval module — 1 embedding call, no chat completion)",
  );
  return { hits, failed };
}
