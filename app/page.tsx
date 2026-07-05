"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Step {
  module: string;
  prompt: { system_prompt: string; user_prompt: string };
  response: unknown;
  llm?: boolean;
}

interface Turn {
  prompt: string;
  status: "ok" | "error";
  response: string | null;
  error: string | null;
  steps: Step[];
}

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "Transcript: Itai (vectors)",
    text: `Student: Itai
Tutor: Let's compute the angle between u=(1,-2,2) and v=(3,0,-4).
Itai: u·v = 3 + 0 + 8 = 11.
Tutor: Check the last term again.
Itai: Oh — 2·(-4) is -8, so it's 3 - 8 = -5. Then cos θ = -5/(3·5) = -1/3, θ ≈ 109°.
Tutor: Good. Why is cos negative here?
Itai: Because... the angle is more than 90? I always mix up which quadrants cosine is negative in.
Tutor: We'll come back to that. Try |u|.
Itai: √(1+4+4) = 3, easy.`,
  },
  { label: "Question about a student", text: "How is Itai doing? Will he reach his target by the exam?" },
  { label: "Out of scope", text: "Solve x²−5x+6=0 for me please" },
];

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);

  async function run() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p }),
      });
      const data = await res.json();
      setHistory((h) => [
        { prompt: p, status: data.status, response: data.response, error: data.error, steps: data.steps ?? [] },
        ...h,
      ]);
      setPrompt("");
    } catch (e) {
      setHistory((h) => [
        { prompt: p, status: "error", response: null, error: String(e), steps: [] },
        ...h,
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>AutoTutor</h1>
      <p className="sub">
        Autonomous session-to-plan agent for bagrut math tutors — paste a session transcript (the event) or
        ask about a student; the agent decides everything else. · <a href="/api/agent_info">agent_info</a> ·{" "}
        <a href="/api/model_architecture">architecture</a> · <a href="/api/team_info">team_info</a>
      </p>

      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex.label} className="ghost" onClick={() => setPrompt(ex.text)}>
            {ex.label}
          </button>
        ))}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={'Student: <name>\n<paste the session transcript here>\n\n— or ask: "How is Itai doing?"'}
      />
      <div className="row">
        <button className="run" onClick={run} disabled={busy || !prompt.trim()}>
          {busy ? "Agent working…" : "Run Agent"}
        </button>
        <span className="hint">
          {busy ? "The Supervisor is dispatching sub-agents — a full transcript run takes ~1–2 minutes." : "Follow-up prompts welcome — state persists per student."}
        </span>
      </div>

      {history.map((t, i) => (
        <div className="card" key={history.length - i}>
          <div className="who">You</div>
          <div className="prompt-echo" dir="auto">{t.prompt}</div>
          <div className="who" style={{ marginTop: "0.8rem" }}>AutoTutor</div>
          {t.status === "ok" ? (
            <div className="response" dir="auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.response}</ReactMarkdown>
            </div>
          ) : (
            <div className="error">{t.error}</div>
          )}
          {t.steps.length > 0 && (
            <details className="steps">
              <summary>
                Steps trace — {t.steps.length} steps ({t.steps.filter((s) => s.llm !== false).length} LLM calls)
              </summary>
              {t.steps.map((s, j) => (
                <details className="step" key={j}>
                  <summary>
                    <span>{j + 1}. {s.module}</span>
                    <span className={`badge${s.llm === false ? " code" : ""}`}>
                      {s.llm === false ? "code" : "LLM"}
                    </span>
                  </summary>
                  <div className="body">
                    <h4>system prompt</h4>
                    <pre>{s.prompt.system_prompt}</pre>
                    <h4>user prompt</h4>
                    <pre>{s.prompt.user_prompt}</pre>
                    <h4>response</h4>
                    <pre>{typeof s.response === "string" ? s.response : JSON.stringify(s.response, null, 2)}</pre>
                  </div>
                </details>
              ))}
            </details>
          )}
        </div>
      ))}
    </main>
  );
}
