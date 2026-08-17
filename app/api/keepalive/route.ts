import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Supabase pauses free-tier projects after 7 days of inactivity, and a paused
// project takes the whole agent down: /api/execute cannot read or write student
// state, so every transcript run fails. A daily cron (vercel.json + a backup
// GitHub Action) hits this route so the project always has recent activity.
//
// Deliberately cheap: one indexed read, no LLM calls, no writes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase().from("concepts").select("id").limit(1);
    if (error) throw new Error(error.message);
    return NextResponse.json({
      status: "ok",
      supabase: data && data.length > 0 ? "reachable" : "reachable (empty)",
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { status: "error", error: `Supabase unreachable: ${msg}`, checked_at: new Date().toISOString() },
      { status: 500 },
    );
  }
}
