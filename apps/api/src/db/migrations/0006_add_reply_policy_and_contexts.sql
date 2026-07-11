-- Reply policy + interceptors（Layer B agent 回報後由 Layer A 執行回覆）
-- 慣例同 0001-0005：idempotent，可重複套用（手動 psql -f 或既有流程）。

-- 每條 routing rule 的宣告式 reply policy：{ onReceived?, onSuccess?, onFailure? }
ALTER TABLE "routing_rules" ADD COLUMN IF NOT EXISTS "reply_policy" TEXT;

-- 於 enqueue 時寫入，供 ReplyInterceptor 在 agent 回報時解析 where/what/how；reply 後刪除。
CREATE TABLE IF NOT EXISTS "reply_contexts" (
  "event_id"       TEXT PRIMARY KEY,
  "broker_id"      TEXT NOT NULL,
  "reply_to"       TEXT,
  "jira_issue_key" TEXT,
  "policy"         TEXT NOT NULL,
  "created_at"     BIGINT NOT NULL
);
