#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { dispatchReply, transitionJiraIssue } from "@wpbawsed/agent-broker-core";

const REDIS_URL  = process.env.REDIS_URL  || "redis://localhost:6379";
const QUEUE_NAME = process.env.QUEUE_NAME || `broker-${process.env.AGENT_ID || "unknown"}`;

const pendingJobs = new Map();

const jiraOpts = () => ({
  jiraBaseUrl: process.env.JIRA_URL,
  jiraEmail:   process.env.JIRA_EMAIL,
  jiraToken:   process.env.JIRA_API_TOKEN,
});

// ── MCP Server ────────────────────────────────────────────────────────
const mcp = new Server(
  { name: "bullmq-channel", version: "0.1.0" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions:
      'Messages arrive as <channel source="bullmq" chat_id="JOB_ID">. ' +
      "Each message is a Jira event with fields: issueKey, summary, status, assignee, comments. " +
      "Analyze the task, perform any necessary actions, " +
      'then call the reply tool with chat_id and your response text. ' +
      'All replies must start with "AI回覆：".',
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Reply to the Jira issue and mark the job as done",
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
    await dispatchReply({ channel: pending.replyTo }, text, jiraOpts());
    if (pending.issueKey) {
      await transitionJiraIssue(pending.issueKey, "Wait UAT", jiraOpts()).catch((err) =>
        console.error(`[jira-channel] Cannot transition to Wait UAT: ${err.message}`),
      );
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

// ── ADF text extractor ────────────────────────────────────────────────
function extractText(val) {
  if (!val) return "";
  if (typeof val === "string") return val;
  const walk = (node) => {
    if (!node) return "";
    if (node.type === "text") return node.text || "";
    if (node.content) return node.content.map(walk).join(" ");
    return "";
  };
  return walk(val).replace(/\s+/g, " ").trim();
}

function formatJobContent(event) {
  const p = event.payload ?? {};
  const lines = [
    `Issue: ${p.issueKey ?? "?"} — ${p.summary ?? "(no summary)"}`,
    `Status: ${p.status ?? "?"}`,
    `Project: ${p.projectKey ?? "?"}`,
  ];

  if (p.assignee) lines.push(`Assignee: ${p.assignee}`);

  const raw = p.raw ?? {};
  const description = extractText(raw.issue?.fields?.description);
  if (description) lines.push(`Description: ${description}`);

  const changeItems = raw.changelog?.items ?? [];
  if (changeItems.length > 0) {
    lines.push(`\nChangelog:`);
    for (const item of changeItems) {
      lines.push(`  ${item.field}: "${item.fromString}" → "${item.toString}"`);
    }
  }

  const comments = raw.comment ? [raw.comment] : [];
  if (comments.length > 0) {
    lines.push(`\nComments (${comments.length}):`);
    for (const c of comments) {
      const author = c.author?.displayName ?? "?";
      const body = typeof c.body === "string" ? c.body : (c.body?.content?.[0]?.content?.[0]?.text ?? "");
      lines.push(`  [${author}] ${body}`);
    }
  }

  return lines.join("\n");
}

// ── BullMQ Worker ─────────────────────────────────────────────────────
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const event = job.data;
    const chat_id = String(job.id);
    const issueKey = event.payload?.issueKey ?? event.normalized?.issueKey;
    const replyTo = event.replyTo ?? `jira://${issueKey}`;

    if (issueKey) {
      await transitionJiraIssue(issueKey, "進行中", jiraOpts()).catch((err) =>
        console.error(`[jira-channel] Cannot transition to In Progress: ${err.message}`),
      );
    }

    await new Promise((resolve, reject) => {
      pendingJobs.set(chat_id, { resolve, reject, replyTo, issueKey });

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
          meta: { chat_id, issueKey: event.normalized?.issueKey, replyTo },
        },
      }).catch((err) => {
        console.error(`[jira-channel] Failed to notify Claude: ${err.message}`);
        pendingJobs.delete(chat_id);
        reject(err);
      });
    });
  },
  { connection: redis, concurrency: 1 },
);

worker.on("completed", (job) => console.error(`[jira-channel] Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`[jira-channel] Job ${job?.id} failed: ${err.message}`));

await mcp.connect(new StdioServerTransport());
console.error(`[jira-channel] Connected. Listening on queue: ${QUEUE_NAME}`);
