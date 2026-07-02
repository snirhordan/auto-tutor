// Pinecone client. One index; namespaces: syllabus / exams / notes-{studentId}.
import { Pinecone } from "@pinecone-database/pinecone";
import { PINECONE_INDEX } from "./config";

let _pc: Pinecone | null = null;

export function pinecone(): Pinecone {
  if (!_pc) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) throw new Error("PINECONE_API_KEY not set");
    _pc = new Pinecone({ apiKey });
  }
  return _pc;
}

export function index() {
  return pinecone().index({ name: PINECONE_INDEX });
}

export interface RetrievedChunk {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

export async function queryNamespace(
  namespace: string,
  vector: number[],
  topK: number,
): Promise<RetrievedChunk[]> {
  const res = await index().namespace(namespace).query({
    vector,
    topK,
    includeMetadata: true,
  });
  return (res.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score ?? 0,
    text: String(m.metadata?.text ?? ""),
    metadata: (m.metadata ?? {}) as Record<string, unknown>,
  }));
}
