import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const file = path.join(process.cwd(), "public", "architecture.png");
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      { error: "architecture.png not generated yet (run scripts/diagram.py)" },
      { status: 404 },
    );
  }
  const png = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
}
