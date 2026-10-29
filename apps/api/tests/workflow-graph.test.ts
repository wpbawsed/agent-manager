/**
 * Unit tests for src/workflow/graph.ts (pure — no DB, no queue).
 * Run: node --import tsx --test tests/workflow-graph.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  END,
  buildInput,
  fillTemplate,
  initialState,
  mergeState,
  parseLabel,
  selectNext,
  validateGraph,
  type StepResult,
  type WorkflowGraph,
} from "../src/workflow/graph.ts";

const graph: WorkflowGraph = {
  entry: "dev",
  nodes: [
    { id: "dev", agentId: "a1", input: "{{input.text}}" },
    { id: "review", agentId: "a2", input: "review {{nodes.dev.mrUrl}}", labels: ["approve", "changes"] },
    { id: "deploy", agentId: "a3", input: "deploy", interruptBefore: true },
  ],
  edges: [
    { from: "dev", to: "review", when: { status: "done", hasMrUrl: true } },
    { from: "dev", to: END, when: { status: "done" } },
    { from: "review", to: "deploy", when: { label: "approve" } },
    { from: "review", to: "dev", when: { label: "changes" } },
    { from: "deploy", to: END },
  ],
};
const done = (node: string, extra: Partial<StepResult> = {}): StepResult => ({ node, status: "done", ...extra });

// ─── validateGraph ─────────────────────────────────────────────────────────

test("validateGraph accepts a well-formed graph", () => {
  assert.deepEqual(validateGraph(graph, new Set(["a1", "a2", "a3"])), []);
});

test("validateGraph reports unknown entry, edge targets, agents and labels", () => {
  const errors = validateGraph(
    {
      entry: "nope",
      nodes: [{ id: "x", agentId: "ghost", input: "hi" }],
      edges: [
        { from: "x", to: "missing" },
        { from: "x", to: END, when: { label: "approve" } },
      ],
    },
    new Set(["a1"]),
  );
  assert.ok(errors.some((e) => e.includes("entry")));
  assert.ok(errors.some((e) => e.includes("unknown node")));
  assert.ok(errors.some((e) => e.includes("unknown agent ghost")));
  assert.ok(errors.some((e) => e.includes('label "approve"')));
});

test("validateGraph rejects duplicate ids, reserved END and bad maxSteps", () => {
  const errors = validateGraph({
    entry: "a",
    maxSteps: 0,
    nodes: [
      { id: "a", agentId: "x", input: "i" },
      { id: "a", agentId: "x", input: "i" },
      { id: "END", agentId: "x", input: "i" },
    ],
    edges: [],
  });
  assert.ok(errors.some((e) => e.includes("duplicate node id: a")));
  assert.ok(errors.some((e) => e.includes("reserved")));
  assert.ok(errors.some((e) => e.includes("maxSteps")));
});

// ─── templates ─────────────────────────────────────────────────────────────

test("fillTemplate resolves input, node results and human; unknown paths are empty", () => {
  const state = mergeState(initialState({ text: "build X", raw: { big: true } }), done("dev", { mrUrl: "https://pr/1" }));
  assert.equal(fillTemplate("{{input.text}} → {{nodes.dev.mrUrl}} / {{human}} / {{nodes.nope.summary}} / {{input.raw.big}}", state, "ok"),
    "build X → https://pr/1 / ok /  / true");
});

test("buildInput appends the human reply and the label instruction", () => {
  const state = initialState({ text: "t" });
  const text = buildInput(graph.nodes[1], state, "請再看一次");
  assert.match(text, /人工回覆：\n請再看一次/);
  assert.match(text, /結論：<approve\|changes>/);
});

test("buildInput does not duplicate the human reply when the template uses {{human}}", () => {
  const text = buildInput({ id: "n", agentId: "a", input: "do: {{human}}" }, initialState({}), "X");
  assert.equal(text, "do: X");
});

// ─── labels ────────────────────────────────────────────────────────────────

test("parseLabel takes the last 結論 line and only accepts known labels", () => {
  const labels = ["approve", "changes"];
  assert.equal(parseLabel("看過了\n結論：changes\n...\n結論: approve", labels), "approve");
  assert.equal(parseLabel("結論：`approve`", labels), "approve");
  assert.equal(parseLabel("結論：maybe", labels), undefined);
  assert.equal(parseLabel(undefined, labels), undefined);
});

// ─── selectNext ────────────────────────────────────────────────────────────

test("selectNext: first matching edge wins", () => {
  assert.equal(selectNext(graph, "dev", done("dev", { mrUrl: "u" })), "review");
  assert.equal(selectNext(graph, "dev", done("dev")), END);
});

test("selectNext: label routes and loops back", () => {
  assert.equal(selectNext(graph, "review", done("review", { label: "approve" })), "deploy");
  assert.equal(selectNext(graph, "review", done("review", { label: "changes" })), "dev");
});

test("selectNext: no match → END when done, null (run fails) when failed", () => {
  const g: WorkflowGraph = { entry: "a", nodes: [{ id: "a", agentId: "x", input: "i" }], edges: [] };
  assert.equal(selectNext(g, "a", done("a")), END);
  assert.equal(selectNext(g, "a", { node: "a", status: "failed" }), null);
});

test("selectNext: a status=failed edge catches failures", () => {
  const g: WorkflowGraph = {
    entry: "a",
    nodes: [{ id: "a", agentId: "x", input: "i" }, { id: "fix", agentId: "x", input: "i" }],
    edges: [{ from: "a", to: "fix", when: { status: "failed" } }],
  };
  assert.equal(selectNext(g, "a", { node: "a", status: "failed" }), "fix");
});

// ─── state ─────────────────────────────────────────────────────────────────

test("mergeState overwrites the node's latest result and appends history", () => {
  let s = initialState({ text: "t" });
  s = mergeState(s, done("dev", { summary: "v1" }));
  s = mergeState(s, done("dev", { summary: "v2" }));
  assert.equal(s.nodes.dev.summary, "v2");
  assert.deepEqual(s.history.map((h) => h.summary), ["v1", "v2"]);
});
