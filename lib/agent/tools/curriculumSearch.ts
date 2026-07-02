// CurriculumSearch [Agentic RAG]: retrieval over the REAL Ministry corpus.
// The calling agent CHOOSES the namespace per query — syllabus, past exams, or a
// student's private notes — the Lecture-3 multi-vector-DB scenario. Embedding
// call only; no chat tokens.
import { embed } from "../../llm";
import { queryNamespace } from "../../pinecone";
import { NS_EXAMS, NS_SYLLABUS, nsNotes } from "../../config";
import type { Trace } from "../types";

export type SearchNamespace = "syllabus" | "exams" | "notes";
const TOP_K = 4; // L3: general text 3–5

export async function curriculumSearch(
  trace: Trace,
  namespace: SearchNamespace,
  query: string,
  studentId?: string,
): Promise<{ source: string; score: number; excerpt: string }[]> {
  const ns =
    namespace === "syllabus" ? NS_SYLLABUS : namespace === "exams" ? NS_EXAMS : nsNotes(studentId ?? "");
  let results: { source: string; score: number; excerpt: string }[] = [];
  try {
    const [vector] = await embed([query], trace.runId);
    const chunks = await queryNamespace(ns, vector, TOP_K);
    results = chunks.map((c) => ({
      source: String(c.metadata.source ?? c.id),
      score: Math.round(c.score * 1000) / 1000,
      excerpt: c.text.slice(0, 400),
    }));
  } catch {
    results = []; // corpus not ingested yet → agent falls back to curated descriptions
  }
  trace.addCode(
    "DiagnosisAgent.CurriculumSearch",
    `Agentic RAG: namespace=${namespace}, query="${query.slice(0, 120)}"`,
    { results: results.map((r) => ({ source: r.source, score: r.score })) },
  );
  return results;
}
