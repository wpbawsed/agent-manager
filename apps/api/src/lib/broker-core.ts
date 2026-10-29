// Outbound reply dispatch: "how to call the Slack / Jira / Notion / LINE API".
// Moved from agent-broker/packages/core (published as @wpbawsed/agent-broker-core
// 0.1.1) so agent-manager no longer depends on a separately published package.
// Only the surface the manager uses is kept; the agent-side helpers
// (setSlackReaction, Notion page fetch/update, BrokerEventSchema) were dropped —
// see agent-broker's git history if they are ever needed again.
//
// Supported reply channel URIs:
//   slack://C1234567                          → Slack chat.postMessage
//   jira://PROJ-123                           → Jira REST comment
//   notion://PAGE_ID                          → Notion page comment
//   line://push/GROUP_OR_USER_ID?reply=TOKEN  → LINE reply (token) or push
//   webhook://https://...                     → HTTP POST

export interface ReplyOpts {
  slackToken?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraToken?: string;
  notionToken?: string;
  lineChannelToken?: string;
  [k: string]: unknown;
}

export interface ReplyTarget {
  channel: string; // protocol://target, e.g. slack://C123, jira://PROJ-1
  thread_ts?: string;
  metadata?: unknown;
}

export function parseReplyChannel(channel: string): { protocol: string; target: string } {
  const match = channel.match(/^([a-z]+):\/\/(.+)$/);
  if (!match) throw new Error(`Invalid reply_to.channel format: ${channel}`);
  return { protocol: match[1], target: match[2] };
}

export async function dispatchReply(replyTo: ReplyTarget, text: string, opts: ReplyOpts = {}): Promise<unknown> {
  const { protocol, target } = parseReplyChannel(replyTo.channel);

  switch (protocol) {
    case "slack":
      return dispatchSlack(target, replyTo.thread_ts, text, opts);
    case "jira":
      return dispatchJira(target, text, opts);
    case "notion":
      return addNotionComment(target, text, opts);
    case "line": {
      // target = "push/GROUP_ID?reply=TOKEN"
      const url = new URL(`line://${target}`);
      const pushTarget = url.pathname.replace(/^\/+/, "");
      const replyToken = url.searchParams.get("reply") || null;
      return dispatchLine(pushTarget, replyToken, text, opts);
    }
    case "webhook":
      return dispatchWebhook(target, text, replyTo.metadata);
    default:
      throw new Error(`Unsupported reply protocol: ${protocol}`);
  }
}

async function dispatchSlack(channelId: string, threadTs: string | undefined, text: string, opts: ReplyOpts) {
  const token = opts.slackToken || process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is required for Slack replies");

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: channelId, text, ...(threadTs && { thread_ts: threadTs }) }),
  });

  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

function jiraBasicAuth(opts: ReplyOpts): string {
  const email = opts.jiraEmail || process.env.JIRA_EMAIL;
  const token = opts.jiraToken || process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("JIRA_EMAIL and JIRA_API_TOKEN are required");
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function jiraFetch(path: string, options: RequestInit = {}, opts: ReplyOpts = {}): Promise<any> {
  const baseUrl = opts.jiraBaseUrl || process.env.JIRA_URL || process.env.JIRA_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_URL is required for Jira API calls");
  const res = await fetch(`${baseUrl}/rest/api/3${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: jiraBasicAuth(opts),
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira API ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function dispatchJira(issueKey: string, text: string, opts: ReplyOpts) {
  return jiraFetch(
    `/issue/${issueKey}/comment`,
    {
      method: "POST",
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
      }),
    },
    opts,
  );
}

/** Transition a Jira issue to the first transition whose name contains namePattern (case-insensitive). */
export async function transitionJiraIssue(issueKey: string, namePattern: string, opts: ReplyOpts = {}): Promise<void> {
  const data = (await jiraFetch(`/issue/${issueKey}/transitions`, {}, opts)) as {
    transitions?: { id: string; name: string }[];
  };
  const t = data.transitions?.find((t) => t.name.toLowerCase().includes(namePattern.toLowerCase()));
  if (!t) {
    const available = data.transitions?.map((t) => t.name).join(", ");
    throw new Error(`No transition matching "${namePattern}" for ${issueKey}. Available: ${available}`);
  }
  await jiraFetch(
    `/issue/${issueKey}/transitions`,
    { method: "POST", body: JSON.stringify({ transition: { id: t.id } }) },
    opts,
  );
}

async function dispatchLine(pushTarget: string, replyToken: string | null, text: string, opts: ReplyOpts) {
  const token = opts.lineChannelToken || process.env.LINE_CHANNEL_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_TOKEN is required for LINE replies");

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // Try replyToken first (free, time-limited ~30s)
  if (replyToken) {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers,
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
    if (res.ok) return res.json();
    // replyToken expired — fall through to push
  }

  // Fallback: push (paid, no time limit)
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers,
    body: JSON.stringify({ to: pushTarget, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) throw new Error(`LINE push API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function dispatchWebhook(url: string, text: string, metadata: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, metadata }),
  });
  if (!res.ok) throw new Error(`Webhook error ${res.status}: ${await res.text()}`);
  return { ok: true, status: res.status };
}

async function addNotionComment(pageId: string, text: string, opts: ReplyOpts) {
  const token = opts.notionToken || process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is required for Notion comments");

  const res = await fetch("https://api.notion.com/v1/comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { page_id: pageId },
      rich_text: [{ type: "text", text: { content: text } }],
    }),
  });
  if (!res.ok) throw new Error(`Notion comment API error ${res.status}: ${await res.text()}`);
  return res.json();
}
