#!/usr/bin/env node
/**
 * Railway Event BullMQ Claude Channel
 * Receives Railway deployment events and has Claude describe them.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Worker } from "bullmq";
import { Redis } from "ioredis";

const REDIS_URL  = process.env.REDIS_URL  || "redis://localhost:6379";
const QUEUE_NAME = process.env.QUEUE_NAME || `broker-${process.env.AGENT_ID || "unknown"}`;

const pendingJobs = new Map();

// ── MCP Server ─────────────────────────────────────────────────────────
const mcp = new Server(
  { name: "bullmq-channel", version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions:
      'Messages arrive as <channel source="bullmq" chat_id="JOB_ID">. ' +
      "Each message is a Railway deployment event. " +
      "Describe what happened in Traditional Chinese, clearly and concisely. " +
      "Then call the reply tool with chat_id and your description. " +
      'All replies must start with "AI回覆：".',
  },
);

// ── reply tool ─────────────────────────────────────────────────────────
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Log the event description and mark the job as done",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: { type: "string" },
          text:    { type: "string", description: 'Must start with "AI回覆："' },
        },
        required: ["chat_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "reply") throw new Error(`unknown tool: ${req.params.name}`);

  const { chat_id, text } = req.params.arguments;
  const pending = pendingJobs.get(chat_id);
  if (!pending) {
    return { content: [{ type: "text", text: `No pending job: ${chat_id}` }] };
  }

  console.error(`[railway-agent] ${text}`);
  pending.resolve();
  pendingJobs.delete(chat_id);
  return { content: [{ type: "text", text: "logged and job completed" }] };
});

// ── Format job for Claude ──────────────────────────────────────────────
function formatJobContent(event) {
  const p = event.payload ?? {};
  return [
    `Event: ${p.raw?.type ?? event.eventType ?? "?"}`,
    `Project: ${p.projectName || p.projectId || "?"}`,
    p.serviceName ? `Service: ${p.serviceName}` : null,
    p.environment ? `Environment: ${p.environment}` : null,
    p.severity    ? `Severity: ${p.severity}` : null,
    `Details: ${JSON.stringify(p.raw?.details ?? {})}`,
  ].filter(Boolean).join("\n");
}

// ── BullMQ Worker ──────────────────────────────────────────────────────
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const event   = job.data;
    const chat_id = String(job.id);
    console.error(`[railway-agent] Job ${chat_id} received — ${event.eventType}`);

    await new Promise((resolve, reject) => {
      pendingJobs.set(chat_id, { resolve, reject });

      setTimeout(() => {
        if (pendingJobs.has(chat_id)) {
          pendingJobs.delete(chat_id);
          reject(new Error(`Timeout (job ${chat_id})`));
        }
      }, 600_000);

      mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content: formatJobContent(event),
          meta: { chat_id },
        },
      }).catch((err) => {
        console.error(`[railway-agent] Failed to notify Claude: ${err.message}`);
        pendingJobs.delete(chat_id);
        reject(err);
      });
    });
  },
  { connection: redis, concurrency: 1 },
);

worker.on("completed", (job) =>
  console.error(`[railway-agent] Job ${job.id} completed`));
worker.on("failed", (job, err) =>
  console.error(`[railway-agent] Job ${job?.id} failed: ${err.message}`));

await mcp.connect(new StdioServerTransport());
console.error(`[railway-agent] Connected. Listening on queue: ${QUEUE_NAME}`);
