#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { updateNotionPage, fetchNotionBlocks, addNotionComment } from "@wpbawsed/agent-broker-core";

const REDIS_URL          = process.env.REDIS_URL          || "redis://localhost:6379";
const QUEUE_NAME         = process.env.QUEUE_NAME         || `broker-${process.env.AGENT_ID || "unknown"}`;
const NOTION_STATUS_PROP = process.env.NOTION_STATUS_PROP || "Status";

const pendingJobs = new Map();

const notionOpts = () => ({ notionToken: process.env.NOTION_TOKEN });

// ── MCP Server ────────────────────────────────────────────────────────
const mcp = new Server(
  { name: "bullmq-channel", version: "0.1.0" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions:
      'Messages arrive as <channel source="bullmq" chat_id="JOB_ID">. ' +
      "Each message is a Notion page event with fields: pageId, title, status, changelog. " +
      "Analyze the task, perform any necessary actions, " +
      'then call the reply tool with chat_id and your response text. ' +
      'All replies must start with "AI回覆：".',
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Reply to the Notion page and mark the job as done",
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
    if (pending.pageId) {
      await addNotionComment(pending.pageId, text, notionOpts());
      await updateNotionPage(
        pending.pageId,
        { [NOTION_STATUS_PROP]: { status: { name: "Wait UAT" } } },
        notionOpts(),
      ).catch((err) => console.error(`[notion-channel] Cannot transition to Wait UAT: ${err.message}`));
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

// ── Format job for Claude ─────────────────────────────────────────────
function extractText(val) {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map((t) => t.plain_text ?? t.text?.content ?? "").join("");
  return "";
}

function formatJobContent(event) {
  const p = event.payload ?? {};
  const raw = p.raw ?? {};
  const pageId = p.entityId ?? raw.entity?.id ?? "?";
  const title  = extractText(raw.data?.properties?.title?.title ?? raw.data?.properties?.Name?.title ?? []);
  const status = raw.data?.properties?.[NOTION_STATUS_PROP]?.status?.name ?? p.status ?? "?";

  const lines = [
    `Page: ${pageId}`,
    `Title: ${title || "(no title)"}`,
    `Status: ${status}`,
    `Event: ${p.eventType ?? raw.type ?? "?"}`,
  ];

  const changedProps = Object.keys(raw.data?.properties ?? {});
  if (changedProps.length > 0) lines.push(`\nChanged properties: ${changedProps.join(", ")}`);

  return lines.join("\n");
}

// ── BullMQ Worker ─────────────────────────────────────────────────────
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const event   = job.data;
    const chat_id = String(job.id);
    const pageId  = event.payload?.entityId ?? event.payload?.raw?.entity?.id;

    if (pageId) {
      await updateNotionPage(
        pageId,
        { [NOTION_STATUS_PROP]: { status: { name: "In Progress" } } },
        notionOpts(),
      ).catch((err) => console.error(`[notion-channel] Cannot transition to In Progress: ${err.message}`));
    }

    const pageContent = pageId
      ? await fetchNotionBlocks(pageId, notionOpts()).catch(() => "")
      : "";

    await new Promise((resolve, reject) => {
      pendingJobs.set(chat_id, { resolve, reject, pageId });

      setTimeout(() => {
        if (pendingJobs.has(chat_id)) {
          pendingJobs.delete(chat_id);
          reject(new Error(`Timeout: Claude did not reply within 10 minutes (job ${chat_id})`));
        }
      }, 600_000);

      const content = formatJobContent(event)
        + (pageContent ? `\n\nPage Content:\n${pageContent}` : "");

      mcp.notification({
        method: "notifications/claude/channel",
        params: { content, meta: { chat_id, pageId } },
      }).catch((err) => {
        console.error(`[notion-channel] Failed to notify Claude: ${err.message}`);
        pendingJobs.delete(chat_id);
        reject(err);
      });
    });
  },
  { connection: redis, concurrency: 1 },
);

worker.on("completed", (job) => console.error(`[notion-channel] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[notion-channel] Job ${job?.id} failed: ${err.message}`));

await mcp.connect(new StdioServerTransport());
console.error(`[notion-channel] Connected. Listening on queue: ${QUEUE_NAME}`);
