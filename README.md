# AutoTutor — Autonomous Session-to-Plan Agent for Bagrut Math Tutors

Final project, **course 960237 — Introduction to Modern AI Agents** (Technion, Spring 2026).
Team **The Autonomous**: Snir Hordan · Omer Yom Tov · Oz Diamond.

**Vercel URL:** https://auto-tutor-seven.vercel.app
**GitHub Repo URL:** https://github.com/snirhordan/auto-tutor

## What it is

An autonomous agent for freelance Israeli 5-unit bagrut math tutors. The tutor never issues
commands — they report **events**: paste the raw transcript of a tutoring session (or ask a
question about a student), and the agent decides on its own what the event requires:

- extract evidence of what the student can/can't do (**TranscriptAnalyzer**, few-shot),
- update a per-concept mastery model deterministically (**MasteryUpdater**, code),
- root-cause errors through a prerequisite graph over the **real Ministry of Education 5u
  curriculum** (**GapDiagnoser** + Agentic-RAG **CurriculumSearch** over 10 syllabus documents and
  20 real 581/582 exam papers),
- generate diagnostic probes when its own uncertainty is too high (**ProbeGenerator**, one-shot),
- recompute pace against the exam calendar (**CurriculumPacer**) and the predicted bagrut grade
  with a confidence interval (**ExamForecaster**),
- **audit its own previous forecast** against the new evidence and recalibrate
  (**ForecastAuditor** — Reflection over the agent's own prior output),
- build or **restructure** the remaining lesson roadmap + write a next-session brief
  (**PlannerAgent** — Plan-and-Execute with a Replan step),
- gate the outgoing reply (**ReflectionAgent**, N=1 skip-if-pass).

A **SupervisorAgent** (ReAct-style dispatch, ≤6) coordinates the specialists; an **IntentRouter**
(few-shot) classifies transcripts vs. questions vs. out-of-scope. Different inputs produce visibly
different `steps[]` traces — this is an agent, not a pipeline (see `/api/model_architecture`).

Course patterns used: Supervisor · ReAct · Plan-and-Execute · Reflection ×2 · Multi-Agent ·
Agentic RAG · N-shot per module · Persona/CoT/Question-Refinement prompting.

## API (per project spec)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/team_info` | GET | team + students |
| `/api/agent_info` | GET | description, purpose, prompt template, real captured examples |
| `/api/model_architecture` | GET | architecture diagram (PNG) |
| `/api/execute` | POST `{"prompt": "..."}` | run the agent → `{status, error, response, steps[]}` |

GUI at `/` — textarea, **Run Agent**, response, full collapsible steps trace, conversation history.
No authentication.

## Stack

Next.js (App Router, TypeScript) on **Vercel** · **Supabase** (students, concepts, prerequisite
edges, mastery, sessions, forecasts, plans, llm_usage) · **Pinecone** (namespaces: `syllabus`,
`exams`, `notes-{student}`) · **LLMod.ai** models `MB5R2CF-azure/gpt-5.4-mini` +
`MB5R2CF-azure/text-embedding-3-small`.

Efficiency guardrails: ≤15 LLM calls/run (hard budget in `lib/config.ts`), capped ReAct loops,
compact state digests, 3 pure-code modules, every call token-logged (`npm run budget`).

## Setup

```bash
npm install
cp .env.example .env        # fill in LLMod / Supabase / Pinecone keys
# 1. apply supabase/schema.sql in the Supabase SQL editor
npm run seed                # concept graph + demo students + baseline mastery
python3 scripts/extract_pdfs.py   # download + RTL-aware extraction of Ministry syllabus & exams
npm run parse-exams -- --limit 1  # ExamParser [LLM · strict JSON, Toby pattern]: verify one exam,
npm run parse-exams               #   then all 20 — reconstructs shattered formulas as LaTeX,
                                  #   tags questions with concept ids (offline, ~$0.15 total)
npm run ingest -- --limit 3 # subset smoke test
npm run ingest              # full corpus → Pinecone
npm run validate-corpus     # coverage report: curated graph vs ingested corpus
npm run dev                 # http://localhost:3000
```

## Tests

```bash
npm test                    # contract tests: exact endpoint schemas (no keys needed)
npm run eval                # replays 6 demo scenarios against a running server (spends budget)
npm run capture-examples    # record real runs into /api/agent_info examples
npm run budget              # per-module token/cost report
```

Demo scenario (in order): `data/transcripts/1_itai_vectors.txt` (hidden prerequisite gap →
probes) → `2_itai_probes.txt` (**the agent audits its own prior forecast and replans**) →
`3_noa_clean.txt` (clean session, short trace) → `4_dana_behind.txt` (calendar crisis → triage) →
`5_incomplete.txt` (clarifying question) → `6_out_of_scope.txt` (refusal).
