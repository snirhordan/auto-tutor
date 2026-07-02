// Supabase client (service role — server-side only) + usage logging.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

export interface UsageRow {
  module: string;
  run_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
}

/** Fire-and-forget usage logging — never let telemetry break a run. */
export async function logUsage(row: UsageRow): Promise<void> {
  try {
    await supabase().from("llm_usage").insert(row);
  } catch {
    // Usage logging must never take the agent down.
  }
}
