// Supabase state accessors — the Toby-style knowledge bases feeding decisions.
import { supabase } from "../supabase";
import type {
  ConceptRow,
  Forecast,
  MasteryRow,
  RoadmapItem,
  StudentRow,
} from "./types";

export async function findStudent(ref: string): Promise<StudentRow | null> {
  const db = supabase();
  const byId = await db.from("students").select("*").eq("id", ref).maybeSingle();
  if (byId.data) return byId.data as StudentRow;
  const byName = await db.from("students").select("*").ilike("name", ref).limit(2);
  if (byName.data?.length === 1) return byName.data[0] as StudentRow;
  return null;
}

export async function listStudents(): Promise<StudentRow[]> {
  const { data } = await supabase().from("students").select("*").order("id");
  return (data ?? []) as StudentRow[];
}

export async function loadConcepts(): Promise<ConceptRow[]> {
  const { data, error } = await supabase().from("concepts").select("*");
  if (error) throw new Error(`concepts: ${error.message}`);
  return (data ?? []) as ConceptRow[];
}

export async function loadEdges(): Promise<{ src: string; dst: string; strength: number }[]> {
  const { data } = await supabase().from("concept_edges").select("*");
  return data ?? [];
}

export async function loadMastery(studentId: string): Promise<MasteryRow[]> {
  const { data, error } = await supabase().from("mastery").select("*").eq("student_id", studentId);
  if (error) throw new Error(`mastery: ${error.message}`);
  return (data ?? []) as MasteryRow[];
}

export async function upsertMastery(rows: MasteryRow[]): Promise<void> {
  const { error } = await supabase().from("mastery").upsert(rows);
  if (error) throw new Error(`mastery upsert: ${error.message}`);
}

export async function latestForecast(studentId: string): Promise<(Forecast & { created_at: string }) | null> {
  const { data } = await supabase()
    .from("forecasts")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as (Forecast & { created_at: string }) | null) ?? null;
}

export async function saveForecast(studentId: string, f: Forecast): Promise<void> {
  const { error } = await supabase().from("forecasts").insert({ student_id: studentId, ...f });
  if (error) throw new Error(`forecast insert: ${error.message}`);
}

export async function activePlan(
  studentId: string,
): Promise<{ id: string; roadmap: RoadmapItem[]; brief: string | null } | null> {
  const { data } = await supabase()
    .from("plans")
    .select("*")
    .eq("student_id", studentId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function savePlan(
  studentId: string,
  roadmap: RoadmapItem[],
  brief: string,
): Promise<void> {
  const db = supabase();
  await db.from("plans").update({ status: "superseded" }).eq("student_id", studentId).eq("status", "active");
  const { error } = await db.from("plans").insert({ student_id: studentId, roadmap, brief });
  if (error) throw new Error(`plan insert: ${error.message}`);
}

export async function saveSession(
  studentId: string,
  transcript: string,
  summary: string,
  evidence: unknown,
): Promise<void> {
  const { error } = await supabase()
    .from("sessions")
    .insert({ student_id: studentId, transcript, summary, evidence });
  if (error) throw new Error(`session insert: ${error.message}`);
}
