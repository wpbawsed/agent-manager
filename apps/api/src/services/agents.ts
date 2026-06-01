import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { agents, queues } from "../db/schema.js";
import type { DB } from "../db/client.js";

const NODE_AGENT_URL = process.env.NODE_AGENT_URL || "http://127.0.0.1:9090";
const AGENTS_BASE_DIR = process.env.AGENTS_BASE_DIR
  ? resolve(process.env.AGENTS_BASE_DIR)
  : join(process.cwd(), "..", "..", "agents");

// Agent folder scaffold

async function scaffoldAgentFolder(params: {
  agentId: string;
  agentName: string;
  instruction: string | null | undefined;
  queueName: string | null;
}) {
  const { agentId, agentName, instruction, queueName } = params;

  const slug = agentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const shortId = agentId.split("-")[0];
  const folderName = `${slug}-${shortId}`;
  const agentDir = join(AGENTS_BASE_DIR, folderName);

  await mkdir(agentDir, { recursive: true });
  await mkdir(join(agentDir, "broker"), { recursive: true });
  await mkdir(join(agentDir, ".claude", "skills"), { recursive: true });
  await mkdir(join(agentDir, "docs"), { recursive: true });
  await mkdir(join(agentDir, "repos"), { recursive: true });

  const claudeMd = instruction || `# ${agentName}\n\nAgent system prompt.\n`;
  await writeFile(join(agentDir, "CLAUDE.md"), claudeMd);

  const resolvedQueueName = queueName ?? `broker-${agentId}`;
  const envContent = [
    `# Agent: ${agentName}`,
    `# Agent ID: ${agentId}`,
    "",
    `# BullMQ (Redis)`,
    `REDIS_URL=redis://localhost:6379`,
    `QUEUE_NAME=${resolvedQueueName}`,
    `CONCURRENCY=1`,
    "",
    `# Claude API`,
    `# ANTHROPIC_API_KEY=sk-ant-your-key-here`,
    "",
    `AGENT_ID=${agentId}`,
    `INTERNAL_TOKEN=${process.env.INTERNAL_TOKEN ?? ""}`,
    `DASHBOARD_URL=${process.env.DASHBOARD_URL ?? "http://localhost:8080"}`,
    "",
    `MAX_TOOL_TURNS=10`,
  ].join("\n");

  await writeFile(join(agentDir, ".env"), envContent);
  await writeFile(
    join(agentDir, ".env.example"),
    [
      `# Agent: ${agentName}`,
      `REDIS_URL=redis://localhost:6379`,
      `QUEUE_NAME=${resolvedQueueName}`,
      `CONCURRENCY=1`,
      `AGENT_ID=${agentId}`,
      `DASHBOARD_URL=http://localhost:8080`,
      `INTERNAL_TOKEN=`,
    ].join("\n"),
  );
  await writeFile(
    join(agentDir, ".gitignore"),
    [".env", ".env.*", "*.local.md", ".DS_Store", "repos", "docs", "node_modules"].join("\n"),
  );
  await writeFile(join(agentDir, ".mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2));
  await writeFile(
    join(agentDir, "package.json"),
    JSON.stringify(
      { name: slug, version: "0.1.0", private: true, type: "module", scripts: { start: "node index.js", dev: "node --watch index.js" } },
      null,
      2,
    ),
  );
  await writeFile(
    join(agentDir, "broker", "package.json"),
    JSON.stringify(
      {
        name: `${slug}-broker`,
        version: "0.1.0",
        private: true,
        type: "module",
        dependencies: { "@wpbawsed/agent-broker-sdk": "^0.1.2", bullmq: "^5.0.0", ioredis: "^5.0.0", dotenv: "^16.0.0" },
      },
      null,
      2,
    ),
  );

  // index.js written as a plain string (no template literals that would confuse TS)
  const agentJs = [
    'import { resolve, dirname } from "path";',
    'import { readFileSync } from "fs";',
    'import { fileURLToPath } from "url";',
    'import { spawn } from "child_process";',
    "",
    'const __dirname = dirname(fileURLToPath(import.meta.url));',
    'export const SYSTEM_PROMPT = readFileSync(resolve(__dirname, "CLAUDE.md"), "utf-8");',
    "",
    'export function runClaudeCLI(prompt) {',
    '  return new Promise((resolveP, rejectP) => {',
    '    const proc = spawn("claude", ["--print", "--output-format", "text"], {',
    '      stdio: ["pipe", "pipe", "pipe"], cwd: __dirname,',
    '      env: (() => { const e = { ...process.env }; delete e.ANTHROPIC_API_KEY; return e; })(),',
    '    });',
    '    proc.stdin.write(prompt); proc.stdin.end();',
    '    let out = "", err = "";',
    '    proc.stdout.on("data", (d) => { out += d; });',
    '    proc.stderr.on("data", (d) => { err += d; });',
    '    proc.on("close", (code) => { if (code !== 0) rejectP(new Error("claude exited " + code)); else resolveP(out.trim()); });',
    '    proc.on("error", (e) => rejectP(e));',
    '  });',
    '}',
    "",
    'export async function handleMessage(event, ctx) {',
    '  const text = String(event.payload?.text ?? event.text ?? JSON.stringify(event.payload ?? event));',
    '  try {',
    '    const reply = await runClaudeCLI(SYSTEM_PROMPT + "\\n\\n---\\n\\n" + text);',
    '    await ctx.reply(reply);',
    '  } catch (err) {',
    '    await ctx.reply("Error: " + err.message).catch(() => {});',
    '  }',
    '  await ctx.done();',
    '}',
    "",
    'if (import.meta.url === "file://" + process.argv[1]) {',
    '  const { startBroker } = await import("./broker/index.js");',
    '  startBroker(handleMessage);',
    '}',
  ].join("\n");

  await writeFile(join(agentDir, "index.js"), agentJs);

  const brokerJs = [
    'import { resolve, dirname } from "path";',
    'import { fileURLToPath } from "url";',
    'import { config } from "dotenv";',
    'import { BullMQConsumer } from "@wpbawsed/agent-broker-sdk";',
    "",
    'const __dirname = dirname(fileURLToPath(import.meta.url));',
    'config({ path: resolve(__dirname, "../.env") });',
    "",
    'const QUEUE_NAME  = process.env.QUEUE_NAME  || ("broker-" + (process.env.AGENT_ID || "unknown"));',
    'const REDIS_URL   = process.env.REDIS_URL   || "redis://localhost:6379";',
    'const CONCURRENCY = Number(process.env.CONCURRENCY) || 1;',
    "",
    'export function startBroker(onMessage) {',
    '  const consumer = new BullMQConsumer({',
    '    queueName:     QUEUE_NAME,',
    '    redisUrl:      REDIS_URL,',
    '    agentId:       process.env.AGENT_ID || "unknown",',
    '    concurrency:   CONCURRENCY,',
    '    dashboardUrl:  process.env.DASHBOARD_URL || null,',
    '    internalToken: process.env.INTERNAL_TOKEN || null,',
    '    replyOptions: {',
    '      slackToken:       process.env.SLACK_BOT_TOKEN,',
    '      lineChannelToken: process.env.LINE_CHANNEL_TOKEN,',
    '      jiraBaseUrl:      process.env.JIRA_URL,',
    '      jiraEmail:        process.env.JIRA_EMAIL,',
    '      jiraToken:        process.env.JIRA_API_TOKEN,',
    '      notionToken:      process.env.NOTION_TOKEN,',
    '    },',
    '  });',
    '  consumer.on("message", onMessage);',
    '  consumer.on("error", (err) => console.error("[broker] Error:", err.message));',
    '  consumer.start();',
    '  return consumer;',
    '}',
  ].join("\n");

  await writeFile(join(agentDir, "broker", "index.js"), brokerJs);

  return { agentDir, folderName };
}

// Agent CRUD

export interface CreateAgentInput {
  name: string;
  description?: string;
  instruction?: string;
  queueId?: string;
  runtimeCmd?: string;
  ownerId: string;
}

export async function createAgent(db: DB, input: CreateAgentInput) {
  const id = randomUUID();
  const apiToken = randomUUID();
  const now = Date.now();

  // Look up queue name for scaffold .env (best-effort)
  let queueName: string | null = null;
  if (input.queueId) {
    const [queue] = await db.select().from(queues).where(eq(queues.id, input.queueId)).limit(1);
    if (queue?.ownerId !== input.ownerId) throw new Error("Queue not found or access denied");
    queueName = queue.name;
  }

  try {
    await scaffoldAgentFolder({ agentId: id, agentName: input.name, instruction: input.instruction, queueName });
  } catch (err) {
    console.error("Agent scaffold error:", err);
  }

  const [agent] = await db
    .insert(agents)
    .values({
      id,
      ownerId: input.ownerId,
      name: input.name,
      description: input.description,
      instruction: input.instruction,
      queueId: input.queueId ?? null,
      runtimeCmd: input.runtimeCmd ?? null,
      apiToken,
      status: "stopped",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return agent;
}

export async function listAgents(db: DB, ownerId: string) {
  return db.select().from(agents).where(eq(agents.ownerId, ownerId));
}

export async function getAgent(db: DB, id: string, ownerId: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!agent || agent.ownerId !== ownerId) return null;
  return agent;
}

export async function updateAgent(
  db: DB,
  id: string,
  ownerId: string,
  input: Partial<Omit<CreateAgentInput, "ownerId">>,
) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return null;

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.instruction !== undefined) updates.instruction = input.instruction;
  if (input.queueId !== undefined) updates.queueId = input.queueId;
  if (input.runtimeCmd !== undefined) updates.runtimeCmd = input.runtimeCmd;

  const [updated] = await db.update(agents).set(updates).where(eq(agents.id, id)).returning();
  return updated;
}

export async function deleteAgent(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return false;
  await db.delete(agents).where(eq(agents.id, id));
  return true;
}

// Agent lifecycle

export async function startAgent(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return { ok: false, error: "Agent not found" };

  // Resolve queue name from the linked queue entity
  let queueName = `broker-${id}`; // fallback if no queue assigned
  if (agent.queueId) {
    const [queue] = await db.select().from(queues).where(eq(queues.id, agent.queueId)).limit(1);
    if (queue) queueName = queue.name;
  }

  const { cmd, cwd } = buildStartConfig(agent);
  const env: Record<string, string> = {
    AGENT_ID: id,
    AGENT_API_TOKEN: agent.apiToken,
    API_SERVER_URL: process.env.API_SERVER_URL || "http://localhost:8080",
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
    QUEUE_NAME: queueName,
  };

  const res = await fetch(`${NODE_AGENT_URL}/agents/${id}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, cwd, env }),
  });

  if (res.status === 409) {
    const body = (await res.json()) as { pid?: number };
    await db.update(agents).set({ status: "running", updatedAt: Date.now() }).where(eq(agents.id, id));
    return { ok: true, pid: body.pid };
  }
  if (!res.ok) return { ok: false, error: `Node agent error: ${await res.text()}` };

  const data = (await res.json()) as { pid?: number };
  await db.update(agents).set({ status: "running", updatedAt: Date.now() }).where(eq(agents.id, id));
  return { ok: true, pid: data.pid };
}

export async function stopAgent(db: DB, id: string, ownerId: string) {
  const agent = await getAgent(db, id, ownerId);
  if (!agent) return { ok: false, error: "Agent not found" };

  const res = await fetch(`${NODE_AGENT_URL}/agents/${id}/stop`, { method: "POST" });
  if (!res.ok && res.status !== 404) return { ok: false, error: `Node agent error: ${await res.text()}` };

  await db.update(agents).set({ status: "stopped", updatedAt: Date.now() }).where(eq(agents.id, id));
  return { ok: true };
}

export async function getAgentNodeStatus(id: string) {
  const res = await fetch(`${NODE_AGENT_URL}/agents/${id}/status`);
  if (!res.ok) return null;
  return res.json();
}

function buildStartConfig(agent: { runtimeCmd: string | null; name: string; id: string }) {
  const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const shortId = agent.id.split("-")[0];
  const dir = join(AGENTS_BASE_DIR, `${slug}-${shortId}`);
  if (agent.runtimeCmd) return { cmd: agent.runtimeCmd, cwd: dir };
  return { cmd: `node ${join(dir, "index.js")}`, cwd: dir };
}
