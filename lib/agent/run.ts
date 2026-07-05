// AutoTutor entry point: prompt in → {response, steps[]} out.
// Flow: IntentRouter → SupervisorAgent (dispatches specialists) → code assembly
// → ReflectionAgent quality gate. Every LLM call and deterministic module is traced.
import { randomUUID } from "crypto";
import {
  DEFAULT_TARGET_GRADE,
  MAX_LLM_CALLS_PER_RUN,
  MAX_REFLECTION_FIX_ROUNDS,
  MIN_ONBOARD_RUNWAY_DAYS,
  nextExamDate,
} from "../config";
import type { RunArtifacts, Step } from "./types";
import { Trace } from "./types";
import { detectLanguage, routeIntent } from "./intentRouter";
import { runSupervisor, runSupervisorFixRound } from "./supervisor";
import type { SupervisorDeps } from "./supervisor";
import { runReflectionAgent } from "./subagents/reflectionAgent";
import {
  createStudent,
  findStudent,
  listStudents,
  loadConcepts,
  loadEdges,
  loadMastery,
  saveSession,
} from "./state";

export interface ExecuteResult {
  response: string;
  steps: Step[];
}

export async function executeAgent(prompt: string): Promise<ExecuteResult> {
  const trace = new Trace(randomUUID(), MAX_LLM_CALLS_PER_RUN);
  const now = new Date();
  const language = detectLanguage(prompt);
  const artifacts: RunArtifacts = { language };

  // 1) Route the event.
  const routed = await routeIntent(trace, prompt);

  if (routed.intent === "out_of_scope") {
    const refusal =
      language === "he"
        ? `זה מחוץ לתחום שלי. אני סוכן אוטונומי למורים פרטיים למתמטיקה (5 יח"ל): הדביקו תמליל שיעור ואטפל בכל השאר — אבחון, עדכון שליטה, תחזית ותכנון השיעור הבא; או שאלו אותי על תלמיד קיים. (${routed.reason})`
        : `That's outside my scope. I'm an autonomous agent for bagrut math tutors: paste a session transcript and I'll handle everything else — diagnosis, mastery updates, forecast, and next-lesson planning; or ask me about an existing student. (Classified as out of scope: ${routed.reason})`;
    trace.addCode("ResponseComposer", "assemble refusal", { refused: true });
    return { response: refusal, steps: trace.steps };
  }

  // 2) Resolve the student (code, not LLM).
  let student = routed.student_ref ? await findStudent(routed.student_ref) : null;

  // StudentOnboarder: an unknown student named in a TRANSCRIPT is a real event we should
  // handle, not a dead end — create a profile with stated assumptions and keep going.
  // (Questions about an unknown student, and transcripts with no student_ref at all, still
  // fall through to the clarification below — we only onboard off telemetry, never a guess.)
  if (!student && routed.intent === "transcript" && routed.student_ref) {
    const examDate = nextExamDate(now);
    const created = await createStudent(routed.student_ref, examDate, DEFAULT_TARGET_GRADE);
    trace.addCode(
      "StudentOnboarder",
      `unknown student "${routed.student_ref}" named in a transcript — no matching profile. ` +
        `Assuming exam date ${examDate} (next sitting at least ${MIN_ONBOARD_RUNWAY_DAYS} days out) and target grade ` +
        `${DEFAULT_TARGET_GRADE} (course default) since the tutor stated neither; seeding every ` +
        `concept at 0.5 mastery / 0.2 confidence / 0 evidence (no prior sessions).`,
      {
        student_id: created.id,
        exam_date: created.exam_date,
        target_grade: created.target_grade,
        priors: "all concepts 0.5 mastery / 0.2 confidence",
      },
    );
    artifacts.onboarded = {
      name: created.name,
      exam_date: created.exam_date,
      target_grade: created.target_grade,
    };
    student = created;
  }

  if (!student) {
    const known = (await listStudents()).map((s) => `${s.name} (${s.id})`).join(", ");
    const ask =
      routed.intent === "transcript"
        ? `I couldn't match this transcript to a student${routed.student_ref ? ` ("${routed.student_ref}")` : ""}. Whose session is this? Known students: ${known}. Add "Student: <name>" at the top of the transcript.`
        : `Which student do you mean${routed.student_ref ? ` by "${routed.student_ref}"` : ""}? Known students: ${known}.`;
    trace.addCode("ResponseComposer", "assemble clarification (unknown student)", {
      clarification: true,
    });
    return { response: ask, steps: trace.steps };
  }

  // 3) Load state and hand the event to the Supervisor.
  const [masteryRows, concepts, edges] = await Promise.all([
    loadMastery(student.id),
    loadConcepts(),
    loadEdges(),
  ]);
  artifacts.student = student;

  const deps: SupervisorDeps = {
    student,
    masteryRows,
    concepts,
    edges,
    transcript: routed.intent === "transcript" ? prompt : undefined,
    question: routed.intent === "question" ? prompt : undefined,
    now,
  };
  await runSupervisor(trace, routed.intent, deps, artifacts);

  // Question-Refinement path: the agent asks instead of guessing.
  if (artifacts.clarification) {
    trace.addCode("ResponseComposer", "assemble clarification (incomplete transcript)", {
      clarification: true,
    });
    return { response: artifacts.clarification, steps: trace.steps };
  }

  // 4) Persist the session (transcript events).
  if (routed.intent === "transcript" && artifacts.analysis) {
    await saveSession(student.id, prompt, artifacts.analysis.session_summary, artifacts.analysis.evidence);
  }

  // 5) Assemble the response (code), then run the Reflection quality gate (LLM). A failing
  // verdict routes back to the Supervisor for a bounded number of fix rounds before we ship
  // best-effort — see MAX_REFLECTION_FIX_ROUNDS.
  let draft = compose(artifacts);
  trace.addCode("ResponseComposer", "assemble final response from artifacts", {
    sections: Object.keys(artifacts).filter((k) => artifacts[k as keyof RunArtifacts] != null),
  });

  let final: string;
  for (let round = 0; ; round++) {
    const verdict = await runReflectionAgent(trace, draft, contextSummary(artifacts));
    if (verdict.pass) {
      final = draft;
      break;
    }
    if (round >= MAX_REFLECTION_FIX_ROUNDS || !trace.hasBudget(3)) {
      final = verdict.revised ?? draft; // best-effort ship
      break;
    }
    const beforeFix = draft;
    await runSupervisorFixRound(trace, routed.intent, deps, artifacts, verdict.issues);

    // A fix round can itself decide the transcript is too ambiguous to proceed (e.g. it
    // redispatches DiagnosisAgent, which comes back asking a clarifying question instead of
    // a diagnosis) — honor that the same way the initial dispatch's clarification is honored,
    // instead of falling through to compose() on stale, unconfirmed artifacts.
    if (artifacts.clarification) {
      trace.addCode(
        "ResponseComposer",
        "assemble clarification (incomplete transcript, reflection fix round)",
        { clarification: true },
      );
      return { response: artifacts.clarification, steps: trace.steps };
    }

    draft = compose(artifacts);
    trace.addCode("ResponseComposer", `recompose after reflection fix round ${round + 1}`, {
      sections: Object.keys(artifacts).filter((k) => artifacts[k as keyof RunArtifacts] != null),
    });

    if (draft === beforeFix) {
      // The fix round changed nothing (Supervisor finalized immediately, or every candidate
      // dispatch was a guarded no-op given current artifacts) — re-running ReflectionAgent
      // would just re-score identical text for another LLM call. Ship the reflector's own
      // correction now instead of burning the budget on a repeat verdict.
      final = verdict.revised ?? draft;
      break;
    }
  }
  // Deterministic guarantee: the onboarding-assumptions disclosure survives any
  // LLM rewrite. If a reflection revision stripped it, re-attach it up front —
  // the tutor must always see what the agent assumed about a brand-new profile.
  if (artifacts.onboarded && !final.includes(artifacts.onboarded.exam_date)) {
    final = onboardSection(artifacts) + "\n\n" + final;
    trace.addCode(
      "ResponseComposer",
      "re-attach onboarding disclosure (stripped by a reflection rewrite)",
      { reattached: true },
    );
  }
  return { response: final, steps: trace.steps };
}

// ---------- response assembly (deterministic) ----------

/** The onboarding-assumptions disclosure. Factored out so the post-reflection
 *  guard can re-attach it if an LLM rewrite strips it — the tutor must always
 *  see what the agent assumed about a student it invented a profile for. */
function onboardSection(a: RunArtifacts): string {
  const o = a.onboarded!;
  return a.language === "he"
    ? `## תלמיד/ה חדש/ה נוסף/ה למערכת: ${o.name}\n` +
        `הונח תאריך בחינה: **${o.exam_date}**; יעד ציון מונח: **${o.target_grade}**.\n` +
        `אין נתונים קודמים — כל מושג מתחיל ב-0.5 שליטה עם ביטחון נמוך.\n` +
        `אפשר לתקן את תאריך הבחינה או את יעד הציון פשוט על ידי מענה כאן.`
    : `## New student onboarded: ${o.name}\n` +
        `Assumed exam date: **${o.exam_date}**; assumed target grade: **${o.target_grade}**.\n` +
        `No prior data — every concept starts at 0.5 mastery with low confidence.\n` +
        `You can correct the exam date or target grade just by replying.`;
}

function compose(a: RunArtifacts): string {
  if (a.queryAnswer) return a.queryAnswer;
  const s: string[] = [];
  const he = a.language === "he";

  if (a.onboarded) {
    s.push(onboardSection(a));
  }
  if (a.analysis) {
    s.push(`## ${he ? "סיכום המפגש" : "Session summary"}\n${a.analysis.session_summary}`);
  }
  if (a.masteryChanges?.length) {
    s.push(
      `## ${he ? "עדכוני שליטה" : "Mastery updates"}\n` +
        a.masteryChanges.map((c) => `- \`${c.concept_id}\`: ${c.from} → **${c.to}**`).join("\n"),
    );
  }
  if (a.diagnosis?.statement) {
    let d = `## ${he ? "אבחון" : "Diagnosis"}\n${a.diagnosis.statement}`;
    if (a.diagnosis.root_causes.length) {
      d += `\n\n${he ? "גורמי שורש" : "Root causes"}: ` +
        a.diagnosis.root_causes.map((r) => `\`${r.concept_id}\` (via \`${r.via}\`, score ${r.score})`).join(", ");
    }
    s.push(d);
  }
  if (a.probes?.length) {
    s.push(
      `## ${he ? "שאלות אבחון לפתיחת המפגש הבא" : "Diagnostic probes for next session"}\n` +
        a.probes.map((p, i) => `${i + 1}. ${p.question}\n   - ${he ? "תשובה צפויה" : "expect"}: ${p.expected_answer}\n   - ${he ? "מבחין" : "distinguishes"}: ${p.distinguishes}`).join("\n"),
    );
  }
  if (a.pace && a.forecast) {
    let f =
      `## ${he ? "קצב ותחזית" : "Pace & forecast"}\n` +
      `- ${he ? "ימים לבחינה" : "Days to exam"}: **${a.pace.days_to_exam}** (~${a.pace.sessions_left} ${he ? "מפגשים" : "sessions"})\n` +
      `- ${he ? "שליטה משוקללת" : "Weighted mastery"}: **${a.pace.weighted_mastery}** vs ${he ? "צפוי" : "expected"} ${a.pace.expected_mastery_by_now} → ${a.pace.on_track ? (he ? "בקצב" : "on track") : (he ? "**בפיגור**" : "**behind**")}\n` +
      `- ${he ? "תחזית ציון" : "Grade forecast"}: **${a.forecast.predicted_grade}** [${a.forecast.interval_low}–${a.forecast.interval_high}] · ${he ? "שיעורים נדרשים ליעד" : "lessons needed to target"}: **${a.forecast.lessons_needed}**`;
    if (a.audit) {
      f += `\n- ${he ? "ביקורת עצמית על התחזית הקודמת" : "Self-audit of prior forecast"} (**${a.audit.verdict}**): ${a.audit.critique}\n- ${he ? "התאמה" : "Adjustment"}: ${a.audit.adjustment}`;
    }
    s.push(f);
  }
  if (a.roadmap?.length) {
    let r =
      `## ${he ? 'מפת דרך' : "Roadmap"}\n` +
      a.roadmap.map((l) => `${l.lesson}. [${l.focus_concepts.map((c) => `\`${c}\``).join(", ")}] — ${l.goal}`).join("\n");
    if (a.replanRationale) r += `\n\n> ${he ? "שינוי תכנית" : "Replan/triage"}: ${a.replanRationale}`;
    s.push(r);
  }
  if (a.brief) {
    s.push(`## ${he ? "תדריך למפגש הבא" : "Next-session brief"}\n${a.brief}`);
  }
  return s.join("\n\n") || (he ? "לא נדרשה פעולה." : "No action was required for this event.");
}

function contextSummary(a: RunArtifacts): string {
  // Question flow: the draft was written FROM stored state by StudentQueryAgent;
  // the reflector checks internal consistency and honesty about uncertainty.
  // (Feeding it the transcript-flow artifact fields — which are legitimately
  // absent here — misleads it into "correcting" real data into "no data".)
  if (a.queryAnswer) {
    return (
      `question flow about student ${a.student?.name} (target ${a.student?.target_grade}, ` +
      `exam ${a.student?.exam_date}). The draft was generated from the agent's stored state ` +
      `(mastery, latest forecast, active plan); numbers in the draft come from that state. ` +
      `Check internal consistency, quantification, and honest uncertainty — do NOT remove ` +
      `figures on the grounds that they are missing from this context line.`
    );
  }
  // Clean, on-track session: the Supervisor deliberately kept the existing roadmap.
  // Without this note the reflector fails the draft for "missing" a plan/brief and
  // its fix round un-does the clean-session behavior by dispatching the planner.
  const cleanSession =
    a.diagnosis !== undefined &&
    a.diagnosis.weak_concepts.length === 0 &&
    a.pace?.on_track === true &&
    !a.roadmap;
  return (
    (a.onboarded
      ? `NOTE: this student was JUST ONBOARDED from this very transcript — the agent created ` +
        `the profile and ASSUMED exam date ${a.onboarded.exam_date} and target grade ` +
        `${a.onboarded.target_grade}. The draft MUST open with the onboarding-assumptions ` +
        `section; that section is correct and required — never remove or dispute it. `
      : "") +
    `student: ${a.student?.name}, target ${a.student?.target_grade}, exam ${a.student?.exam_date}; ` +
    `weak: ${a.diagnosis?.weak_concepts.map((w) => w.concept_id).join(", ") || "n/a"}; ` +
    `root causes: ${a.diagnosis?.root_causes.map((r) => r.concept_id).join(", ") || "n/a"}; ` +
    `forecast ${a.forecast?.predicted_grade ?? "n/a"}, on_track=${a.pace?.on_track ?? "n/a"}, ` +
    `sessions_left=${a.pace?.sessions_left ?? "n/a"}` +
    (cleanSession
      ? ". NOTE: clean, on-track session — the Supervisor deliberately kept the existing " +
        "roadmap; the draft is NOT supposed to contain a new plan or session brief. Judge it " +
        "as a session log + confirmation, and do not fail it for lacking planning sections."
      : "")
  );
}
