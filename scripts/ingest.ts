// Chunk → embed → upsert the extracted Ministry corpus into Pinecone.
// Chunking per Lecture 3 structured-docs guidance: ≈512-token chunks, ≈15% overlap
// (approximated as 1600 chars / 240-char overlap for Hebrew, ~3 chars/token).
//
// Usage: npx tsx scripts/ingest.ts --limit 5     (subset first — L3/RAG-assignment discipline)
//        npx tsx scripts/ingest.ts               (full corpus)
import "dotenv/config";
import fs from "fs";
import path from "path";
import { embed } from "../lib/llm";
import { index } from "../lib/pinecone";
import { NS_EXAMS, NS_SYLLABUS } from "../lib/config";

const CHUNK_CHARS = 1600;
const OVERLAP_CHARS = 240;

interface ManifestEntry {
  file: string;
  kind: "exam" | "syllabus";
  year?: number;
  season?: number;
  code?: number;
}

function chunk(text: string): string[] {
  const out: string[] = [];
  const stride = CHUNK_CHARS - OVERLAP_CHARS;
  for (let i = 0; i < text.length; i += stride) {
    const piece = text.slice(i, i + CHUNK_CHARS).trim();
    if (piece.length > 200) out.push(piece);
    if (i + CHUNK_CHARS >= text.length) break;
  }
  return out;
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const root = path.join(__dirname, "..");
  const manifest: ManifestEntry[] = JSON.parse(
    fs.readFileSync(path.join(root, "data/ministry/manifest.json"), "utf8"),
  );
  const docs = manifest.slice(0, limit);
  let total = 0;

  for (const doc of docs) {
    const txtPath = path.join(root, "data/ministry/extracted", doc.file + ".txt");
    if (!fs.existsSync(txtPath)) {
      console.log(`skip ${doc.file} (no extracted text)`);
      continue;
    }
    const text = fs.readFileSync(txtPath, "utf8");
    const chunks = chunk(text);
    if (!chunks.length) continue;

    const vectors = await embed(chunks, "ingest");
    const ns = doc.kind === "exam" ? NS_EXAMS : NS_SYLLABUS;
    const records = chunks.map((c, i) => ({
      id: `${doc.file}-${i}`,
      values: vectors[i],
      metadata: {
        text: c,
        source: doc.file,
        kind: doc.kind,
        ...(doc.year ? { year: doc.year } : {}),
        ...(doc.season ? { season: doc.season } : {}),
        ...(doc.code ? { code: doc.code } : {}),
      },
    }));
    for (let i = 0; i < records.length; i += 100) {
      await index().namespace(ns).upsert({ records: records.slice(i, i + 100) });
    }
    total += records.length;
    console.log(`${doc.file} -> ${records.length} chunks (${ns})`);
  }
  console.log(`ingest complete: ${total} chunks upserted`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
