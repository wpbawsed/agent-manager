/**
 * Unit tests for src/lib/broker-core.ts (no server, no network — fetch is stubbed).
 * Run: node --import tsx --test tests/broker-core.test.ts
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseReplyChannel, dispatchReply, transitionJiraIssue } from "../src/lib/broker-core.ts";

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

function stubFetch(...responses: Response[]) {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const res = responses.shift();
    if (!res) throw new Error(`unexpected fetch ${url}`);
    return res;
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const bodyOf = (c: Call) => JSON.parse(String(c.init.body));

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ─── parseReplyChannel ─────────────────────────────────────────────────────

test("parseReplyChannel parses slack://", () => {
  assert.deepEqual(parseReplyChannel("slack://C1234567"), { protocol: "slack", target: "C1234567" });
});

test("parseReplyChannel parses jira://", () => {
  assert.deepEqual(parseReplyChannel("jira://PROJ-123"), { protocol: "jira", target: "PROJ-123" });
});

test("parseReplyChannel keeps the full URL for webhook://", () => {
  assert.deepEqual(parseReplyChannel("webhook://https://example.com/callback"), {
    protocol: "webhook",
    target: "https://example.com/callback",
  });
});

test("parseReplyChannel throws on invalid format", () => {
  assert.throws(() => parseReplyChannel("invalid-channel"), /Invalid reply_to.channel format/);
});

// ─── dispatchReply ─────────────────────────────────────────────────────────

test("slack reply posts to chat.postMessage with thread_ts", async () => {
  stubFetch(json({ ok: true }));
  await dispatchReply({ channel: "slack://C1", thread_ts: "123.456" }, "hi", { slackToken: "xoxb-t" });
  assert.equal(calls[0].url, "https://slack.com/api/chat.postMessage");
  assert.deepEqual(bodyOf(calls[0]), { channel: "C1", text: "hi", thread_ts: "123.456" });
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer xoxb-t");
});

test("slack reply surfaces Slack API errors", async () => {
  stubFetch(json({ ok: false, error: "channel_not_found" }));
  await assert.rejects(
    dispatchReply({ channel: "slack://C1" }, "hi", { slackToken: "t" }),
    /Slack API error: channel_not_found/,
  );
});

test("jira reply posts an ADF comment with basic auth", async () => {
  stubFetch(json({ id: "1" }, 201));
  await dispatchReply({ channel: "jira://PROJ-1" }, "done", {
    jiraBaseUrl: "https://x.atlassian.net",
    jiraEmail: "a@b.c",
    jiraToken: "tok",
  });
  assert.equal(calls[0].url, "https://x.atlassian.net/rest/api/3/issue/PROJ-1/comment");
  assert.equal(bodyOf(calls[0]).body.content[0].content[0].text, "done");
  const auth = (calls[0].init.headers as Record<string, string>).Authorization;
  assert.equal(auth, "Basic " + Buffer.from("a@b.c:tok").toString("base64"));
});

test("line reply falls back to push when the reply token is rejected", async () => {
  stubFetch(new Response("expired", { status: 400 }), json({}));
  await dispatchReply({ channel: "line://push/G1?reply=RT" }, "hi", { lineChannelToken: "t" });
  assert.equal(calls[0].url, "https://api.line.me/v2/bot/message/reply");
  assert.equal(bodyOf(calls[0]).replyToken, "RT");
  assert.equal(calls[1].url, "https://api.line.me/v2/bot/message/push");
  assert.equal(bodyOf(calls[1]).to, "G1");
});

test("notion reply adds a page comment", async () => {
  stubFetch(json({ id: "c1" }));
  await dispatchReply({ channel: "notion://PAGE1" }, "hi", { notionToken: "t" });
  assert.equal(calls[0].url, "https://api.notion.com/v1/comments");
  assert.equal(bodyOf(calls[0]).parent.page_id, "PAGE1");
});

test("webhook reply posts text and metadata", async () => {
  stubFetch(new Response(null, { status: 204 }));
  const res = await dispatchReply({ channel: "webhook://https://example.com/cb", metadata: { a: 1 } }, "hi");
  assert.deepEqual(res, { ok: true, status: 204 });
  assert.deepEqual(bodyOf(calls[0]), { text: "hi", metadata: { a: 1 } });
});

test("unsupported protocol throws", async () => {
  await assert.rejects(dispatchReply({ channel: "ftp://x" }, "hi"), /Unsupported reply protocol: ftp/);
});

// ─── transitionJiraIssue ───────────────────────────────────────────────────

const jiraOpts = { jiraBaseUrl: "https://x.atlassian.net", jiraEmail: "a@b.c", jiraToken: "tok" };

test("transitionJiraIssue picks the first transition matching the pattern", async () => {
  stubFetch(json({ transitions: [{ id: "11", name: "To Do" }, { id: "31", name: "Done" }] }), json({}));
  await transitionJiraIssue("PROJ-1", "done", jiraOpts);
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(bodyOf(calls[1]), { transition: { id: "31" } });
});

test("transitionJiraIssue lists available transitions when none match", async () => {
  stubFetch(json({ transitions: [{ id: "11", name: "To Do" }] }));
  await assert.rejects(transitionJiraIssue("PROJ-1", "review", jiraOpts), /Available: To Do/);
});
