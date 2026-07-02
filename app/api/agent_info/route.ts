import { NextResponse } from "next/server";
import examples from "@/data/agent_info_examples.json";

const DESCRIPTION = `AutoTutor is an autonomous session-to-plan agent for Israeli 5-unit (bagrut) math tutors. The tutor never issues commands — they report EVENTS: paste the raw transcript of a tutoring session (or ask a question about a student), and the agent decides on its own what the event requires. From a transcript it: extracts evidence of what the student can and cannot do (few-shot TranscriptAnalyzer), updates a per-concept mastery model deterministically (MasteryUpdater), root-causes errors through a prerequisite graph over the real Ministry of Education 5u curriculum (GapDiagnoser + Agentic-RAG CurriculumSearch over syllabus/past-exam corpora), generates diagnostic probe questions when its own uncertainty is too high (ProbeGenerator), recomputes schedule pace against the actual exam date (CurriculumPacer) and the predicted bagrut grade with a confidence interval (ExamForecaster), audits its OWN previous forecast against the new evidence and recalibrates (ForecastAuditor — Reflection), and builds or restructures the remaining lesson roadmap plus a next-session brief for the tutor (PlannerAgent — Plan-and-Execute), with a final Reflection quality gate on the outgoing response.

What it CAN do: process session transcripts (Hebrew or English); maintain persistent per-student state across sessions (mastery, forecasts, plans in Supabase); answer questions about a student's progress, forecast, and plan; ask a clarifying question when a transcript is too fragmentary (Question-Refinement); triage the roadmap when the calendar makes full coverage impossible, and say what it dropped and why.

What it CANNOT do (constraints): it does not solve homework or exam problems for students; it does not chat about topics outside bagrut-math tutoring; it only reasons about students that exist in its database (it will ask which student you mean otherwise); it never fabricates curriculum facts — retrieval comes from the ingested Ministry corpus, with curated fallbacks. Out-of-scope requests get a short refusal with a pointer to what the agent is for.`;

const PURPOSE =
  "Eliminate the 30–45 minutes of per-session prep and diagnosis a freelance bagrut tutor spends per student, by autonomously turning each session's transcript into: an updated student model, a root-cause diagnosis, a recalibrated grade forecast, and a ready-to-teach next-session brief — while correcting its own past assessments as evidence accumulates.";

const PROMPT_TEMPLATE = {
  template:
    "EITHER paste a session transcript:\nStudent: <name>\n<verbatim session dialogue / notes, including the actual math work>\n\nOR ask about a student:\n<question about progress / forecast / plan, mentioning the student's name>",
  example:
    "Student: Itai\nTutor: Let's compute the angle between u=(1,-2,2) and v=(3,0,-4).\nItai: u·v = 3 + 0 + 8 = 11...\n\n— or —\n\nHow is Itai doing? Will he reach 92 by the exam?",
};

export async function GET() {
  return NextResponse.json({
    description: DESCRIPTION,
    purpose: PURPOSE,
    prompt_template: PROMPT_TEMPLATE,
    prompt_examples: examples.prompt_examples,
  });
}
