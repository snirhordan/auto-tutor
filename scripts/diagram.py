#!/usr/bin/env python3
"""Generate public/architecture.png — the AutoTutor architecture diagram.

Toby-style (Lecture 5/6): event input → modules with capability badges →
knowledge bases feeding decisions. Module names match the steps[] trace exactly.
Usage: python3 scripts/diagram.py
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "architecture.png")

INK = "#16181d"
BLUE = "#2f4f8f"
BLUE_SOFT = "#e8eef9"
GREY = "#667085"
GREEN = "#1e7d43"
PURPLE = "#7b3fa0"
RED_SOFT = "#f6c9c0"
YELLOW_SOFT = "#fff3cd"

fig, ax = plt.subplots(figsize=(17, 11), dpi=110)
ax.set_xlim(0, 100)
ax.set_ylim(0, 66)
ax.axis("off")


def box(x, y, w, h, fc="white", ec=INK, lw=1.4):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.35",
                                fc=fc, ec=ec, lw=lw, zorder=2))


def simple(x, y, w, h, label, sub=None, fc="white"):
    """Small module box: bold centered label + optional italic sub-line."""
    box(x, y, w, h, fc=fc)
    cy = y + h / 2 + (1.0 if sub else 0)
    ax.text(x + w / 2, cy, label, ha="center", va="center",
            fontsize=11, fontweight="bold", color=INK, zorder=3)
    if sub:
        ax.text(x + w / 2, y + h / 2 - 1.4, sub, ha="center", va="center",
                fontsize=8, color=GREY, zorder=3, style="italic")


def block(x, y, w, h, title, lines, fc=BLUE_SOFT):
    """Sub-agent block: bold title at TOP, content lines beneath."""
    box(x, y, w, h, fc=fc)
    ax.text(x + w / 2, y + h - 1.6, title, ha="center", va="center",
            fontsize=12, fontweight="bold", color=INK, zorder=3)
    for i, (text, color, weight) in enumerate(lines):
        ax.text(x + w / 2, y + h - 3.9 - 2.1 * i, text, ha="center", va="center",
                fontsize=8.6, color=color, fontweight=weight, zorder=3)


def badge(x, y, text, fc=BLUE):
    w = 1.0 + 0.78 * len(text)
    ax.add_patch(FancyBboxPatch((x, y), w, 1.7, boxstyle="round,pad=0.22",
                                fc=fc, ec="white", lw=0.8, zorder=6))
    ax.text(x + w / 2, y + 0.85, text, ha="center", va="center",
            fontsize=7, color="white", fontweight="bold", zorder=7)


def arrow(x1, y1, x2, y2, color=INK, lw=1.4, ls="-"):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=14,
                                 color=color, lw=lw, linestyle=ls, zorder=1))


# ---- title ----
ax.text(50, 64.4, "AutoTutor — Autonomous Session-to-Plan Agent for Bagrut Math Tutors",
        ha="center", fontsize=15, fontweight="bold", color=INK)
ax.text(50, 62.6, 'The tutor reports an EVENT (session transcript) or asks a question — never a command. '
                  'Standing goal: "bring every student to their target grade by their exam date."',
        ha="center", fontsize=9.5, color=GREY)

# ---- input → router → supervisor ----
simple(1.5, 47, 13, 8, "Input (event)", "paste transcript /\nask about a student", fc=BLUE_SOFT)
simple(19, 47, 14, 8, "IntentRouter", "transcript | question |\nout-of-scope")
badge(19.6, 54.2, "LLM · few-shot")
arrow(14.9, 51, 18.6, 51)

simple(38, 45.5, 17, 11, "SupervisorAgent", "owns the goal; dispatches\nspecialists per event;\nmonitors; stops", fc=YELLOW_SOFT)
badge(38.6, 55.7, "LLM · ReAct dispatch ≤6")
arrow(33.4, 51, 37.6, 51)

# ---- refusal path ----
simple(19, 37.5, 14, 5.5, "Refusal / Clarify", "out-of-scope refusal;\nunknown student → ask")
badge(19.6, 42.2, "code")
arrow(26, 46.6, 26, 43.6, color=GREY)

# ---- onboarding path ----
simple(1.5, 37.5, 14, 5.5, "StudentOnboarder",
       "unknown student on a\ntranscript → create profile\n(0.5 priors), state\nassumptions")
badge(2.1, 42.2, "code")
arrow(19.4, 49, 15.6, 40.5, color=GREY)

# ---- sub-agent blocks (right column) ----
block(60, 49.5, 38, 10.5, "DiagnosisAgent", [
    ("TranscriptAnalyzer [LLM · few-shot]   ·   MasteryUpdater [code]", INK, "normal"),
    ("GapDiagnoser [code · prereq graph]   ·   ProbeGenerator [LLM · one-shot]", INK, "normal"),
    ("CurriculumSearch [Agentic RAG — the agent chooses the namespace]", PURPLE, "bold"),
])
badge(60.6, 59.2, "LLM · ReAct ≤5 iters")
arrow(55.4, 54.5, 59.6, 54.5)

block(60, 38, 38, 9.5, "AssessmentAgent", [
    ("CurriculumPacer [code · exam calendar]  ·  ExamForecaster [code · weighted forecast]", INK, "normal"),
    ("ForecastAuditor [LLM · Reflection over the agent's OWN prior forecast]", GREEN, "bold"),
])
badge(60.6, 46.7, "code + reflection")
arrow(55.4, 49.5, 59.6, 43.5)

block(60, 26.5, 38, 9.5, "PlannerAgent", [
    ("PlannerLLM → lesson roadmap (triage when behind)", INK, "normal"),
    ("ExecutorLLM → next-session brief  ·  ReplanLLM → restructure on contradiction", INK, "normal"),
])
badge(60.6, 35.2, "LLM · Plan-and-Execute")
arrow(55.4, 47.5, 59.6, 32)

block(60, 17.5, 26, 7, "StudentQueryAgent", [
    ("answers from stored state — quantified,", GREY, "normal"),
    ("uncertainty-honest", GREY, "normal"),
])
badge(60.6, 23.7, "LLM · persona")
arrow(55.4, 46.5, 59.6, 21.5)

# ---- composer → reflection → response ----
simple(19, 25.5, 14, 6, "ResponseComposer", "assembles artifacts\ninto the reply")
badge(19.6, 30.9, "code")
simple(1.5, 25.5, 13, 6, "ReflectionAgent", "scores the outgoing reply\n1-10; pass at >= 8")
badge(2.1, 30.9, "LLM · Reflection")
arrow(42, 45.1, 30, 31.9)
arrow(18.6, 28.5, 15, 28.5)
arrow(8, 31.5, 39, 45, color=GREY, ls="--", lw=1.1)
ax.text(36, 35.3, "fail → fix round (≤2)", ha="center", fontsize=7.5, color=GREY, style="italic")
simple(1.5, 16.5, 13, 5.5, "Response + steps[]", "full trace of every\nmodule call", fc=BLUE_SOFT)
arrow(8, 25.1, 8, 22.4)

# ---- knowledge bases (Toby-style DBs) ----
block(19, 4.5, 32, 9, "Supabase (state)", [
    ("students · concepts · concept_edges · mastery", GREY, "normal"),
    ("sessions · forecasts (self-audit trail) · plans · llm_usage", GREY, "normal"),
], fc=RED_SOFT)
block(56, 4.5, 34, 9, "Pinecone (vectors)", [
    ("namespaces: syllabus (Ministry curriculum) · exams", GREY, "normal"),
    ("(real 581/582 papers, per-question via offline", GREY, "normal"),
    ("ExamParser [LLM · strict JSON]) · notes-{student}", GREY, "normal"),
], fc=RED_SOFT)

arrow(35, 13.9, 44, 44.9, color=GREY, ls="--", lw=1.1)   # supabase → supervisor
arrow(73, 13.9, 73, 17.1, color=GREY, ls="--", lw=1.1)   # pinecone → studentquery/diagnosis column
arrow(84, 13.9, 90, 49.1, color=GREY, ls="--", lw=1.1)   # pinecone → diagnosis (curriculum search)

ax.text(50, 1.9, "Every LLM call appears in steps[] under its module name; deterministic modules are traced with llm:false.  "
                 "Guardrails: ≤20 LLM calls/run, capped loops, compact state digests, and a reflection "
                 "routing loop (fail → Supervisor fix round, ≤2) before shipping best-effort.",
        ha="center", fontsize=9, color=GREY)
ax.text(50, 0.2, "Patterns (course 960237): Supervisor · ReAct · Plan-and-Execute · Reflection ×2 · Multi-Agent · Agentic RAG · "
                 "N-shot per module · Persona/CoT/Question-Refinement prompting",
        ha="center", fontsize=9, color=BLUE, fontweight="bold")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
plt.tight_layout()
plt.savefig(OUT, bbox_inches="tight", facecolor="white")
print(f"wrote {OUT}")
