// Contract tests: the four required endpoints return EXACTLY the schemas the
// project spec defines. Route handlers are imported directly — no server or
// API keys needed for these.
import { describe, expect, it } from "vitest";
import { GET as teamInfo } from "../app/api/team_info/route";
import { GET as agentInfo } from "../app/api/agent_info/route";
import { GET as modelArchitecture } from "../app/api/model_architecture/route";
import { POST as execute } from "../app/api/execute/route";

describe("GET /api/team_info", () => {
  it("returns the exact required fields", async () => {
    const res = await teamInfo();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["group_batch_order_number", "students", "team_name"].sort(),
    );
    expect(typeof body.group_batch_order_number).toBe("string");
    expect(body.group_batch_order_number).toMatch(/^.+_.+$/); // {batch#}_{order#}
    expect(body.team_name).toBe("The Autonomous");
    expect(body.students).toHaveLength(3);
    for (const s of body.students) {
      expect(Object.keys(s).sort()).toEqual(["email", "name"]);
      expect(s.email).toMatch(/@campus\.technion\.ac\.il$/);
    }
  });
});

describe("GET /api/agent_info", () => {
  it("returns description, purpose, prompt_template, prompt_examples", async () => {
    const res = await agentInfo();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.description).toBe("string");
    expect(body.description.length).toBeGreaterThan(200);
    expect(body.description).toMatch(/CANNOT/); // constraints section required
    expect(typeof body.purpose).toBe("string");
    expect(typeof body.prompt_template.template).toBe("string");
    expect(Array.isArray(body.prompt_examples)).toBe(true);
    expect(body.prompt_examples.length).toBeGreaterThan(0);
    for (const ex of body.prompt_examples) {
      expect(typeof ex.prompt).toBe("string");
      expect(typeof ex.full_response).toBe("string");
      expect(Array.isArray(ex.steps)).toBe(true);
    }
  });
});

describe("GET /api/model_architecture", () => {
  it("returns a PNG", async () => {
    const res = await modelArchitecture();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const buf = Buffer.from(await res.arrayBuffer());
    // PNG magic bytes
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(buf.length).toBeGreaterThan(10_000);
  });
});

describe("POST /api/execute — error contract", () => {
  it("bad JSON → exact error schema", async () => {
    const res = await execute(new Request("http://test/api/execute", { method: "POST", body: "{" }));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["error", "response", "status", "steps"]);
    expect(body.status).toBe("error");
    expect(typeof body.error).toBe("string");
    expect(body.response).toBeNull();
    expect(body.steps).toEqual([]);
  });

  it("missing prompt → exact error schema", async () => {
    const res = await execute(
      new Request("http://test/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nope: 1 }),
      }),
    );
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.response).toBeNull();
    expect(body.steps).toEqual([]);
  });
});
