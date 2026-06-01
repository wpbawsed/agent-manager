#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { dispatchReply } from "@wpbawsed/agent-broker-core";

const REDIS_URL  = process.env.REDIS_URL  || "redis://localhost:6379";
const QUEUE_NAME = process.env.QUEUE_NAME || `broker-${process.env.AGENT_ID || "unknown"}`;

const pendingJobs = new Map();

const lineOpts = () => ({ lineChannelToken: process.env.LINE_CHANNEL_TOKEN });

// ── MCP Server ────────────────────────────────────────────────────────
const mcp = new Server(
  { name: "bullmq-channel", version: "0.1.0" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions:
      'Messages arrive as <channel source="bullmq" chat_id="JOB_ID">. ' +
      "Each message is a LINE group message that mentioned the bot. " +
      "Read the message and reply helpfully in Traditional Chinese. " +
      "Then call the reply tool with chat_id and your response text. " +
      'All replies must start with "AI回覆：".',
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send reply to LINE group and mark the job as done",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "Job ID from the channel message" },
          text:    { type: "string", description: 'Reply text. Must start with "AI回覆："' },
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
    return { content: [{ type: "text", text: `No pending job for chat_id: ${chat_id}` }] };
  }

  try {
    // replyTo format: line://push/{pushTarget}?reply={replyToken}
    // dispatchReply handles try-reply → fallback-push internally
    await dispatchReply({ channel: pending.replyTo }, text, lineOpts());
    pending.resolve();
    pendingJobs.delete(chat_id);
    return { content: [{ type: "text", text: "replied and job completed" }] };
  } catch (err) {
    pending.reject(err);
    pendingJobs.delete(chat_id);
    return { content: [{ type: "text", text: `reply failed: ${err.message}` }] };
  }
});

// ── Format job for Claude ─────────────────────────────────────────────
function formatJobContent(event) {
  const p = event.payload ?? {};
  return [
    `From: ${p.userId || "unknown"}`,
    p.groupId ? `Group: ${p.groupId}` : null,
    `Source: ${p.sourceType ?? "user"}`,
    `Message: ${p.text || "(empty)"}`,
  ].filter(Boolean).join("\n");
}

// ── BullMQ Worker ─────────────────────────────────────────────────────
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const event   = job.data;
    const chat_id = String(job.id);
    const replyTo = event.replyTo ?? "";

    await new Promise((resolve, reject) => {
      pendingJobs.set(chat_id, { resolve, reject, replyTo });

      setTimeout(() => {
        if (pendingJobs.has(chat_id)) {
          pendingJobs.delete(chat_id);
          reject(new Error(`Timeout: Claude did not reply within 10 minutes (job ${chat_id})`));
        }
      }, 600_000);

      mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content: formatJobContent(event),
          meta: { chat_id, replyTo },
        },
      }).catch((err) => {
        console.error(`[line-channel] Failed to notify Claude: ${err.message}`);
        pendingJobs.delete(chat_id);
        reject(err);
      });
    });
  },
  { connection: redis, concurrency: 1 },
);

worker.on("completed", (job) => console.error(`[line-channel] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[line-channel] Job ${job?.id} failed: ${err.message}`));

await mcp.connect(new StdioServerTransport());
console.error(`[line-channel] Connected. Listening on queue: ${QUEUE_NAME}`);
