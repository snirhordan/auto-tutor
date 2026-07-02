// IntentRouter [LLM, FEW-SHOT classifier]: the agent receives EVENTS, not
// commands. Classifies the free-form prompt: a session transcript to process,
// a question about a student's state, or out-of-scope (polite refusal).
import { chatJSON } from "../llm";
import type { Trace } from "./types";

export interface RoutedIntent {
  intent: "transcript" | "question" | "out_of_scope";
  student_ref: string | null;
  reason: string;
}

const SYSTEM = `You are IntentRouter of an autonomous bagrut-math tutoring agent.
Classify the user's input:
- "transcript": a tutoring-session transcript (dialogue/notes of a real session) to be processed
- "question": a question about a student's progress, forecast, plan, or what to do next with them
- "out_of_scope": anything else (solve-my-homework requests, non-tutoring topics, other subjects)
Also extract student_ref: the student's name or id if one is mentioned (from a "Student:" header,
the dialogue, or the question), else null.

Examples:
Input: "Student: Itai\\nTutor: let's compute u·v... Itai: 3+0+8=11..." → {"intent": "transcript", "student_ref": "Itai", "reason": "session dialogue with math work"}
Input: "How is Noa doing? Will she hit her target?" → {"intent": "question", "student_ref": "Noa", "reason": "asks about stored student state"}
Input: "מה שלום דנה? כמה שיעורים נשארו לה?" → {"intent": "question", "student_ref": "דנה", "reason": "Hebrew question about a student's plan"}
Input: "Solve x^2-5x+6=0 for me" → {"intent": "out_of_scope", "student_ref": null, "reason": "homework solving, not tutoring telemetry"}
Input: "What's the best pizza in Haifa?" → {"intent": "out_of_scope", "student_ref": null, "reason": "unrelated to tutoring"}

Reply in strict JSON: {"intent": "...", "student_ref": "... or null", "reason": "..."}`;

export async function routeIntent(trace: Trace, prompt: string): Promise<RoutedIntent> {
  const user = `INPUT:\n${prompt}`;
  const { value } = await chatJSON<RoutedIntent>({
    module: "IntentRouter",
    system: SYSTEM,
    user,
    runId: trace.runId,
  });
  trace.addLlm(
    "IntentRouter",
    { system_prompt: SYSTEM, user_prompt: truncate(user, 3000) },
    value,
  );
  return value;
}

/** Hebrew detection — bilingual support is code-level, not an LLM guess. */
export function detectLanguage(prompt: string): "en" | "he" {
  const hebrew = (prompt.match(/[֐-׿]/g) ?? []).length;
  return hebrew > prompt.length * 0.15 ? "he" : "en";
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " …[truncated]" : s);
