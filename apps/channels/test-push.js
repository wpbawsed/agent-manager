#!/usr/bin/env node
/**
 * Test helper: push a fake event to a BullMQ queue.
 *
 * Usage:
 *   REDIS_URL=redis://:password@localhost:6379 node test-push.js jira
 *   node test-push.js notion
 *   node test-push.js railway
 *   node test-push.js line
 *   node test-push.js universal <replyTo>
 *
 * Requires REDIS_URL env var.
 */

import { Queue } from "bullmq";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("Error: REDIS_URL env var is required");
  console.error("  Example: REDIS_URL=redis://:password@localhost:6379 node test-push.js jira");
  process.exit(1);
}

const QUEUES = {
  jira:      process.env.QUEUE_JIRA    || "broker-jira",
  notion:    process.env.QUEUE_NOTION  || "broker-notion",
  railway:   process.env.QUEUE_RAILWAY || "broker-railway",
  line:      process.env.QUEUE_LINE    || "broker-line",
};

const EVENTS = {
  jira: {
    sourceType: "jira",
    eventType: "issue_updated",
    replyTo: "jira://TEST-1",
    payload: {
      issueKey: "TEST-1",
      summary: "Channel rewrite 測試",
      status: "In Progress",
      projectKey: "TEST",
      assignee: "your-email@example.com",
      raw: {
        changelog: { items: [{ field: "status", fromString: "To Do", toString: "In Progress" }] },
      },
    },
  },
  notion: {
    sourceType: "notion",
    eventType: "page.updated",
    replyTo: "notion://fake-page-id-0000-0000-0000-000000000001",
    payload: {
      entityId: "fake-page-id-0000-0000-0000-000000000001",
      status: "In Progress",
      eventType: "page.updated",
      raw: {
        entity: { id: "fake-page-id-0000-0000-0000-000000000001" },
        data: { properties: { Status: { status: { name: "In Progress" } } } },
      },
    },
  },
  railway: {
    sourceType: "railway",
    eventType: "DEPLOYMENT_SUCCESS",
    payload: {
      projectName: "test-project",
      serviceName: "api",
      environment: "production",
      severity: "info",
      raw: { type: "DEPLOYMENT_SUCCESS", details: { url: "https://example.up.railway.app" } },
    },
  },
  line: {
    sourceType: "line",
    eventType: "message",
    replyTo: "line://push/Cfake_group_id?reply=fake_reply_token",
    payload: {
      userId: "Ufake_user_id",
      groupId: "Cfake_group_id",
      sourceType: "group",
      text: "測試訊息，請問現在幾點？",
      replyToken: "fake_reply_token",
      isMentioned: true,
      eventType: "message",
    },
  },
};

const target = process.argv[2];
const customReplyTo = process.argv[3];

if (!target || !QUEUES[target]) {
  console.error(`Usage: node test-push.js <${Object.keys(QUEUES).join("|")}>`);
  process.exit(1);
}

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUES[target], { connection: redis });

const event = { ...EVENTS[target] };
if (customReplyTo) event.replyTo = customReplyTo;

const job = await queue.add("agent-event", event, {
  attempts: 1,
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
});

console.log(`✅  Pushed ${target} test event`);
console.log(`   Queue:  ${QUEUES[target]}`);
console.log(`   Job ID: ${job.id}`);
console.log(`   replyTo: ${event.replyTo ?? "(none)"}`);

await redis.quit();
