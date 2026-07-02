import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
(async () => {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const name = process.env.PINECONE_INDEX!;
  const { indexes } = await pc.listIndexes();
  if (indexes?.some((i) => i.name === name)) {
    console.log(`index "${name}" already exists`);
  } else {
    await pc.createIndex({
      name,
      dimension: 1536,
      metric: "cosine",
      spec: { serverless: { cloud: "aws", region: "us-east-1" } },
      waitUntilReady: true,
    });
    console.log(`index "${name}" created and ready`);
  }
  const desc = await pc.describeIndex(name);
  console.log("status:", desc.status?.state, "| host:", desc.host);
})();
