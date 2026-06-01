/**
 * Integration tests for /api/agents
 *
 * Prerequisites: API server must be running on http://localhost:8080
 * Run: node --test tests/agents.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:8080";

// ─── Helpers ──────────────────────────────────────────────────────────────

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// ─── Test state ────────────────────────────────────────────────────────────

const TEST_EMAIL = `agent-test-${Date.now()}@example.com`;
const TEST_PASS = "test1234";
let token = "";
let agentId = "";

// ─── Setup ────────────────────────────────────────────────────────────────

before(async () => {
  // Register + login to get token
  await api("POST", "/api/auth/register", {
    email: TEST_EMAIL,
    password: TEST_PASS,
  });
  const { body } = await api("POST", "/api/auth/login", {
    email: TEST_EMAIL,
    password: TEST_PASS,
  });
  assert.ok(body?.token, "Login must return JWT token");
  token = body.token;
});

// ─── Tests ────────────────────────────────────────────────────────────────

test("POST /api/agents — create agent", async () => {
  const { status, body } = await api(
    "POST",
    "/api/agents",
    {
      name: "test-agent",
      description: "Integration test agent",
      instruction: "You are a test assistant.",
      runtimeCmd: "echo hello",
    },
    token,
  );

  assert.equal(
    status,
    201,
    `Expected 201, got ${status}: ${JSON.stringify(body)}`,
  );
  assert.ok(body.id, "Response must include id");
  assert.equal(body.name, "test-agent");
  assert.equal(body.status, "stopped");
  agentId = body.id;
});

test("POST /api/agents — rejects missing name", async () => {
  const { status } = await api(
    "POST",
    "/api/agents",
    { description: "no name" },
    token,
  );
  assert.equal(status, 400, "Missing required 'name' should return 400");
});

test("POST /api/agents — rejects unauthenticated request", async () => {
  const { status } = await api("POST", "/api/agents", { name: "hack" });
  assert.equal(status, 401, "Missing token should return 401");
});

test("GET /api/agents — list agents", async () => {
  const { status, body } = await api("GET", "/api/agents", null, token);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body), "Should return an array");
  const found = body.find((a) => a.id === agentId);
  assert.ok(found, "Created agent should appear in list");
});

test("GET /api/agents/:id — get single agent", async () => {
  const { status, body } = await api(
    "GET",
    `/api/agents/${agentId}`,
    null,
    token,
  );
  assert.equal(status, 200);
  assert.equal(body.id, agentId);
  assert.equal(body.name, "test-agent");
});

test("GET /api/agents/:id — returns 404 for unknown id", async () => {
  const { status } = await api(
    "GET",
    "/api/agents/nonexistent-id",
    null,
    token,
  );
  assert.equal(status, 404);
});

test("PATCH /api/agents/:id — update name and description", async () => {
  const { status, body } = await api(
    "PATCH",
    `/api/agents/${agentId}`,
    { name: "updated-agent", description: "Updated description" },
    token,
  );
  assert.equal(status, 200);
  assert.equal(body.name, "updated-agent");
  assert.equal(body.description, "Updated description");
});

test("DELETE /api/agents/:id — delete agent", async () => {
  const { status } = await api("DELETE", `/api/agents/${agentId}`, null, token);
  assert.equal(status, 204);
});

test("GET /api/agents/:id — returns 404 after delete", async () => {
  const { status } = await api("GET", `/api/agents/${agentId}`, null, token);
  assert.equal(status, 404);
});

test("DELETE /api/agents/:id — returns 404 for already deleted agent", async () => {
  const { status } = await api("DELETE", `/api/agents/${agentId}`, null, token);
  assert.equal(status, 404);
});
