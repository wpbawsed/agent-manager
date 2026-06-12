// index.js — cloud agent runner, runs inside a Cloudflare Sandbox.
// Consumes jobs from BullMQ and executes them with the Claude Agent SDK.
// Reporting (heartbeat / metrics / logs) is built in via push-client.js.
//
// Env (injected by sandbox-worker at start):
//   AGENT_ID, AGENT_TOKEN, AGENT_MANAGER_URL  ← push API credentials
//   QUEUE_NAME, REDIS_URL                      ← job source
//   ANTHROPIC_API_KEY                          ← Claude Agent SDK
import { readFileSync, existsSync } from "node:fs";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { startReporting, pushLog, flushLogs, sendMetrics } from "./push-client.js";

const QUEUE_NAME = process.env.QUEUE_NAME || "broker-" + (process.env.AGENT_ID || "unknown");
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CLAUDE_MD = "/workspace/CLAUDE.md";

const systemPrompt = existsSync(CLAUDE_MD)
  ? readFileSync(CLAUDE_MD, "utf-8")
  : "You are a helpful agent.";

let processedCount = 0;
let errorCount = 0;

async function runTask(text) {
  let result = "";
  const stream = query({
    prompt: text,
    options: {
      systemPrompt,
      maxTurns: Number(process.env.MAX_TOOL_TURNS) || 10,
      cwd: "/workspace",
    },
  });
  for await (const message of stream) {
    if (message.type === "assistant") {
      for (const block of message.message.content ?? []) {
        if (block.type === "text") result += block.text;
      }
    }
    if (message.type === "result") {
      if (message.subtype !== "success") throw new Error("agent run failed: " + message.subtype);
    }
  }
  return result.trim();
}

startReporting();
pushLog("cloud agent runner started — queue: " + QUEUE_NAME);

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
new Worker(
  QUEUE_NAME,
  async (job) => {
    const text = String(job.data?.payload?.text ?? job.data?.text ?? JSON.stringify(job.data));
    pushLog("job " + job.id + " received: " + text.slice(0, 200), "info", String(job.id));
    try {
      const reply = await runTask(text);
      processedCount += 1;
      pushLog("job " + job.id + " done: " + reply.slice(0, 200), "info", String(job.id));
      sendMetrics({ processedCount, errorCount });
      return { reply };
    } catch (err) {
      errorCount += 1;
      pushLog("job " + job.id + " failed: " + err.message, "error", String(job.id));
      sendMetrics({ processedCount, errorCount });
      throw err;
    }
  },
  { connection, concurrency: Number(process.env.CONCURRENCY) || 1 },
);

process.on("SIGTERM", async () => {
  await flushLogs();
  process.exit(0);
});
