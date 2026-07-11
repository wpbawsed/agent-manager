import { eq } from "drizzle-orm";
import { dispatchReply, transitionJiraIssue, type ReplyOpts } from "@wpbawsed/agent-broker-core";
import type { DB } from "../db/client.js";
import { brokers, replyContexts } from "../db/schema.js";

/**
 * Reply policy 執行層（Layer A 的 egress）。
 *
 * 職責分工提醒：
 *  - dispatchReply / transitionJiraIssue = 「怎麼打 Slack/Jira API」= agent-broker-core，現成，不重寫。
 *  - 本檔 = 「何時、對誰、做哪個動作」的 policy 編排 + 憑證來源（broker.requiredVars）。
 *
 * 兩個 interceptor：
 *  - runAck：webhook filter 過、enqueue 成功後 fire-and-forget（onReceived）。
 *  - runReply：agent 回報結果（PATCH /internal/events/:id）後（onSuccess/onFailure）。
 */

export interface ReplyStep {
  /** 呼叫 dispatchReply(replyTo, text) —— 貼訊息/留言回原平台 */
  reply?: boolean;
  /** 呼叫 transitionJiraIssue(issueKey, name) —— 轉 Jira 卡狀態 */
  jiraTransition?: string;
  /** reply 文字前綴（例如失敗時 "❌ "） */
  prefix?: string;
}

export interface ReplyPolicy {
  onReceived?: ReplyStep; // ack：收到並排入佇列
  onSuccess?: ReplyStep;  // agent 完成
  onFailure?: ReplyStep;  // agent 失敗
}

/** agent 回報結果（Layer B AgentResult 的相關欄位） */
export interface AgentResultLite {
  status?: "success" | "failed";
  summary?: string;
  mrUrl?: string;
  error?: string;
  replyTo?: string;
}

/** jira://CBGPB-123 → CBGPB-123；非 jira 協議回 undefined */
export function resolveIssueKey(replyTo?: string | null): string | undefined {
  if (!replyTo) return undefined;
  const m = replyTo.match(/^jira:\/\/([^/?#]+)/);
  return m?.[1];
}

/** broker.requiredVars(JSON BrokerVar[]) → agent-broker-core 的 opts */
function brokerOpts(requiredVarsJson: string | null): ReplyOpts {
  const vars: Record<string, string> = {};
  if (requiredVarsJson) {
    try {
      for (const v of JSON.parse(requiredVarsJson) as Array<{ key: string; value?: string }>) {
        if (v.value) vars[v.key] = v.value;
      }
    } catch {
      /* ignore malformed */
    }
  }
  return {
    slackToken: vars.SLACK_BOT_TOKEN,
    jiraBaseUrl: vars.JIRA_URL,
    jiraEmail: vars.JIRA_EMAIL,
    jiraToken: vars.JIRA_API_TOKEN,
    notionToken: vars.NOTION_TOKEN,
    lineChannelToken: vars.LINE_CHANNEL_TOKEN,
  };
}

async function loadBrokerOpts(db: DB, brokerId: string): Promise<ReplyOpts> {
  const [b] = await db
    .select({ requiredVars: brokers.requiredVars })
    .from(brokers)
    .where(eq(brokers.id, brokerId))
    .limit(1);
  return brokerOpts(b?.requiredVars ?? null);
}

/** 執行單一 step（dispatchReply + jiraTransition）；錯誤只記 log，不中斷 */
async function execStep(
  step: ReplyStep | undefined,
  ctx: { replyTo?: string | null; issueKey?: string; text: string; opts: ReplyOpts },
): Promise<void> {
  if (!step) return;
  const text = `${step.prefix ?? ""}${ctx.text}`;
  if (step.reply && ctx.replyTo) {
    await dispatchReply({ channel: ctx.replyTo }, text, ctx.opts).catch((err) =>
      console.error(`[reply-policy] dispatchReply failed: ${(err as Error).message}`),
    );
  }
  if (step.jiraTransition && ctx.issueKey) {
    await transitionJiraIssue(ctx.issueKey, step.jiraTransition, ctx.opts).catch((err) =>
      console.error(`[reply-policy] transition failed: ${(err as Error).message}`),
    );
  }
}

/**
 * Ack interceptor：enqueue 成功後呼叫（fire-and-forget）。
 * onReceived 通常是「Slack 加 emoji / Jira 轉進行中」。
 */
export function runAck(
  db: DB,
  args: { brokerId: string; replyTo?: string | null; policy: ReplyPolicy },
): void {
  if (!args.policy.onReceived) return;
  void (async () => {
    const opts = await loadBrokerOpts(db, args.brokerId);
    await execStep(args.policy.onReceived, {
      replyTo: args.replyTo,
      issueKey: resolveIssueKey(args.replyTo),
      text: "", // onReceived 一般只轉狀態/加 emoji，不需文字
      opts,
    });
  })().catch((err) => console.error(`[reply-policy] ack failed: ${(err as Error).message}`));
}

/**
 * Reply interceptor：agent 回報結果後呼叫（fire-and-forget）。
 * 從 reply_contexts 撈回 policy/replyTo/issueKey，執行 onSuccess/onFailure，最後清掉 context。
 */
export function runReply(db: DB, eventId: string, result: AgentResultLite): void {
  void (async () => {
    const [ctx] = await db
      .select()
      .from(replyContexts)
      .where(eq(replyContexts.eventId, eventId))
      .limit(1);
    if (!ctx) return; // 該事件沒有 reply policy，跳過

    const policy = JSON.parse(ctx.policy) as ReplyPolicy;
    const step = result.status === "failed" ? policy.onFailure : policy.onSuccess;
    if (step) {
      const opts = await loadBrokerOpts(db, ctx.brokerId);
      const text =
        result.status === "failed"
          ? result.error || result.summary || "(failed)"
          : [result.summary, result.mrUrl && `MR: ${result.mrUrl}`].filter(Boolean).join("\n");
      await execStep(step, {
        replyTo: result.replyTo ?? ctx.replyTo,
        issueKey: ctx.jiraIssueKey ?? undefined,
        text,
        opts,
      });
    }
    await db.delete(replyContexts).where(eq(replyContexts.eventId, eventId));
  })().catch((err) => console.error(`[reply-policy] reply failed: ${(err as Error).message}`));
}
