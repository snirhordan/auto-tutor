import { NextResponse } from "next/server";
import { TEAM_INFO } from "@/lib/config";

export async function GET() {
  return NextResponse.json(TEAM_INFO);
}
