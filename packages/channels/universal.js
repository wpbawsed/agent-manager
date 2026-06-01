#!/usr/bin/env node
/**
 * Universal BullMQ Claude Channel
 *
 * Handles events from any source (Jira, Notion, LINE, Slack, Railway, webhook).
 * The replyTo URI (e.g. slack://C123, jira://PROJ-1, line://push/Gxxx?reply=TOKEN)
 * is set by the broker on each event and determines where the reply goes.
 *
 * All platform dispatch is delegated to @wpbawsed/agent-broker-core.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { dispatchReply } from "@wpbawsed/agent-broker-core";

const REDIS_URL  = process.env.REDIS_URL  || "redis://localhost:6379";
const QUEUE_NAME = process.env.QUEUE_NAME || `broker-${process.env.AGENT_ID || "unknown"}`;

const pendingJobs = new Map();

// All supported platform credentials — only used ones are needed per-agent
const platformOpts = () => ({
  slackToken:       process.env.SLACK_BOT_TOKEN,
  jiraBaseUrl:      process.env.JIRA_URL,
  jiraEmail:        process.env.JIRA_EMAIL,
  jiraToken:        process.env.JIRA_API_TOKEN,
  notionToken:      process.env.NOTION_TOKEN,
  lineChannelToken: process.env.LINE_CHANNEL_TOKEN,
});

// ── MCP Server ────────────────────────────────────────────────────────
const mcp = new Server(
  { name: "bullmq-channel-universal", version: "0.1.0" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions:
      'Messages arrive as <channel source="bullmq" chat_id="JOB_ID">. ' +
      "Each message is an event from an external platform. " +
      "Read the event, perform any necessary actions, " +
      "then call the reply tool with chat_id and your response. " +
      'All replies must start with "AI回覆：".',
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send reply to the originating platform and mark the job as done",
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
    if (pending.replyTo) {
      await dispatchReply({ channel: pending.replyTo, thread_ts: pending.threadTs }, text, platformOpts());
    }
    pending.resolve();
    pendingJobs.delete(chat_id);
    return { content: [{ type: "text", text: "replied and job completed" }] };
  } catch (err) {
    pending.reject(err);
    pendingJobs.delete(chat_id);
    return { content: [{ type: "text", text: `reply failed: ${err.message}` }] };
  }
});

// ── Format job for Claude (generic) ──────────────────────────────────
function formatJobContent(event) {
  const p = event.payload ?? {};
  const lines = [
    `Source: ${event.sourceType ?? "unknown"}`,
    `Event: ${event.eventType ?? "?"}`,
  ];

  // Include whichever fields the normalizer put in payload
  const skip = new Set(["raw"]);
  for (const [k, v] of Object.entries(p)) {
    if (skip.has(k) || v == null) continue;
    lines.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }

  if (p.raw) {
    lines.push(`\nRaw (truncated): ${JSON.stringify(p.raw).slice(0, 500)}`);
  }

  return lines.join("\n");
}

// ── BullMQ Worker ─────────────────────────────────────────────────────
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const event   = job.data;
    const chat_id = String(job.id);
    const replyTo = event.replyTo ?? "";
    // Slack thread_ts lives in source_meta or top-level
    const threadTs = event.source_meta?.thread_ts ?? event.payload?.threadTs ?? undefined;

    await new Promise((resolve, reject) => {
      pendingJobs.set(chat_id, { resolve, reject, replyTo, threadTs });

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
          meta: { chat_id, replyTo, sourceType: event.sourceType },
        },
      }).catch((err) => {
        console.error(`[universal-channel] Failed to notify Claude: ${err.message}`);
        pendingJobs.delete(chat_id);
        reject(err);
      });
    });
  },
  { connection: redis, concurrency: 1 },
);

worker.on("completed", (job) => console.error(`[universal-channel] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[universal-channel] Job ${job?.id} failed: ${err.message}`));

await mcp.connect(new StdioServerTransport());
console.error(`[universal-channel] Connected. Listening on queue: ${QUEUE_NAME}`);
