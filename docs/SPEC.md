# Agent Manager — 技術規格文件（v4）

> 最後更新：2026-06-02
> 此文件反映當前 source code 的實際架構，非設計草稿。

---

## 系統架構總覽

### 核心概念

**Broker → Router（Routing Rule）→ Queue → Agent**

- **Broker**：對外 Webhook 接收器（Slack / Jira / GitHub / LINE / Railway / Notion）
- **Routing Rule**：SNS filter-style 路由規則，連結 Broker → Queue，可選 `eventTypes` allowlist
- **Queue**：獨立 BullMQ Queue entity（類 SQS），與 Broker/Agent 解耦
- **Agent**：Generic worker，1:1 消費一條 Queue，只需 instruction + queue 即可建立

```
外部世界（Slack / Jira / Notion / Line / Railway / GitHub）
  │ HTTPS Webhook
  ▼
Cloudflare Tunnel（對外 webhook URL）
  │ 轉發到本機
  ▼
─────────────────────────────────────────────────────────────
使用者本機

┌───────────────────────────────────────────────────────┐
│  API Server（Fastify, port 8080）                      │
│  POST /:tenant/:sourceType/:sourceId                   │
│   → HMAC 驗證 → 標準化 Event                          │
│   → 查 routing_rules（brokerId → queueId）             │
│   → eventTypes 比對（allowlist）                       │
│   → push job 到 BullMQ Queue                          │
│                                                        │
│  REST API（Agent / Queue / Broker / Routing / Logs）   │
└──────────┬───────────────────────┬────────────────────┘
           │                       │
           ▼                       ▼
      PostgreSQL               Redis + BullMQ
      (source of truth)        Queue（獨立命名，1:1 per Agent）
           │                       │
           │                       ▼
           │                Agent Process
           │                └── Mode 2: claude --dangerously-skip-permissions
           │                    (persistent, MCP channel via .mcp.json)
           │                    channel JS: packages/channels/{type}.js
           │
           ▼
      Node Agent（port 9090）
      └── process spawn / kill / log SSE
           │
           ▼
      UI（Vue 3, port 3000）
```

---

## 技術棧

| 層次 | 技術 |
|---|---|
| UI | Vue 3 + Vite + Vue Router + Pinia + Naive UI + @vue-flow/core |
| API Server | Fastify + TypeScript |
| ORM | Drizzle ORM |
| 資料庫 | PostgreSQL |
| 任務佇列 | BullMQ + Redis |
| 認證 | @fastify/jwt（JWT） |
| Node Agent | Node.js（獨立 process，port 9090） |
| 對外 Webhook | Cloudflare Tunnel（穿透，不需公開 IP） |
| Channel SDK | `@wpbawsed/agent-broker-core`（npm）|
| 部署 | Docker Compose（本機一體化） |

---

## Webhook URL 格式

```
https://{tunnel-domain}/{tenant}/{sourceType}/{sourceId}

範例：
https://xxx.trycloudflare.com/wpbawsed/slack/abc-broker-uuid
https://xxx.trycloudflare.com/wpbawsed/jira/xyz-broker-uuid
```

- `tenant`：對應 `users.subdomain`（e.g. `wpbawsed`）
- `sourceType`：`slack | jira | github | line | railway | notion`
- `sourceId`：對應 `brokers.id`

---

## Webhook 處理流程

```
POST /:tenant/:sourceType/:sourceId
        │
        ▼
1. 查 users WHERE subdomain = tenant → 取得 ownerId
        │ 404 if not found
        ▼
2. 查 brokers WHERE id = sourceId AND type = sourceType AND ownerId
        │ 404 if not found
        ▼
3. 呼叫對應 normalizer（HMAC 驗證 + 標準化 payload）
        │ Slack url_verification challenge → 直接回 200 + challenge
        │ HMAC 失敗 → 回 401
        ▼
4. 確認 broker.status = 'active'
        │ inactive → 回 403
        ▼
5. 查 routing_rules WHERE brokerId，JOIN queues 取得 queueName + replyTarget
        │ 無 rules → 回 200 { ok: true, routed: 0 }
        ▼
6. eventTypes 比對（allowlist）
        │ routing_rule.eventTypes = null → 全部通過（catch-all）
        │ routing_rule.eventTypes = ["issue_created"] → 只通過 eventType 相符的 event
        ▼
7. 對每個匹配的 queue，組裝 job：
        │ replyTarget 有值 → 覆蓋 event.replyTo（來源 ≠ 回覆目標）
        │ replyTarget 為 null → 保留 event.replyTo（原路回覆）
        ▼
8. push job 到 BullMQ queue（queue.name）
        ▼
9. 寫 webhook_events audit log（fire-and-forget）
        ▼
10. 回 200 { ok: true, eventId, routed, errors }
```

---

## 已支援的 Normalizer

| 平台 | 驗證方式 | 特殊處理 |
|---|---|---|
| Slack | HMAC-SHA256（`X-Slack-Signature`） | `url_verification` challenge 直接回應 |
| Jira | HMAC-SHA256（`X-Hub-Signature-256`） | - |
| GitHub | HMAC-SHA256（`X-Hub-Signature-256`） | - |
| Line | HMAC-SHA256（`X-Line-Signature`） | - |
| Railway | Bearer token（`Authorization`） | - |
| Notion | HMAC-SHA256（`X-Notion-Signature`） | `url_verification` challenge 直接回應 |

---

## 資料模型（PostgreSQL + Drizzle）

### DB Migrations

| 版本 | 檔案 | 說明 |
|---|---|---|
| 0000 | `0000_unusual_ender_wiggin.sql` | 初始 schema（users, agents, brokers, routing_rules） |
| 0001 | `0001_add_user_subdomain.sql` | users 加 subdomain 欄位 |
| 0002 | `0002_add_webhook_events.sql` | webhook_events audit log 表 |
| 0003 | `0003_add_routing_rule_reply_target.sql` | routing_rules 加 reply_target 欄位 |
| 0004 | `0004_new_queue_architecture.sql` | 新增 queues 表；agents 加 queueId；routing_rules 改為 queueId + eventTypes（移除 agentId / conditions） |

### users

```typescript
{
  id:           text  PK
  email:        text  UNIQUE NOT NULL
  passwordHash: text  NOT NULL
  role:         text  DEFAULT 'owner'     // owner | admin
  subdomain:    text  UNIQUE              // webhook URL tenant 識別子
  createdAt:    bigint
}
```

### queues（v4 新增）

獨立 BullMQ Queue entity。Broker 透過 routing_rule 把 event 路由進 Queue；Agent 1:1 消費。

```typescript
{
  id:          text  PK
  ownerId:     text  FK → users.id
  name:        text  NOT NULL            // BullMQ queue name，同一 owner 下唯一
  description: text
  createdAt:   bigint
}
```

### agents

Generic worker。建立時只需選 Queue + 填 instruction，其餘設定均在 CLAUDE.md / .mcp.json 中管理。

```typescript
{
  id:          text  PK
  ownerId:     text  FK → users.id
  name:        text  NOT NULL
  description: text
  instruction: text                      // system prompt
  queueId:     text  nullable  FK → queues.id   // 1:1，可晚於建立時設定
  runtimeCmd:  text                      // 啟動指令，由 Node Agent spawn
  apiToken:    text  UNIQUE NOT NULL     // 建立時自動產生
  status:      text  DEFAULT 'stopped'   // stopped | running | error
  createdAt:   bigint
  updatedAt:   bigint
}
```

### brokers

```typescript
{
  id:           text  PK
  ownerId:      text  FK → users.id
  name:         text  NOT NULL
  type:         text  NOT NULL            // slack | jira | github | line | railway | notion
  config:       text  NOT NULL            // JSON: signing_secret, bot_token 等
  webhookPath:  text  NOT NULL            // e.g. /slack/{id}（顯示用）
  requiredVars: text                      // JSON: outbound credentials schema + values
  status:       text  DEFAULT 'inactive'  // active | inactive | error
  createdAt:    bigint
  updatedAt:    bigint
}
```

### routing_rules（v4 更新）

連結 Broker → Queue，支援 `eventTypes` allowlist（SNS filter style）。

```typescript
{
  id:          text  PK
  ownerId:     text  FK → users.id
  name:        text
  brokerId:    text  FK → brokers.id
  queueId:     text  FK → queues.id       // v4：改為指向 Queue（不再是 agentId）
  eventTypes:  text                        // JSON string[]：allowlist，null = catch-all
  replyTarget: text  nullable             // 覆蓋回覆目標 URI，null = 使用 event.replyTo
  createdAt:   bigint
}
```

### webhook_events（audit log）

```typescript
{
  id:             text  PK
  brokerId:       text  NOT NULL         // 無 FK（broker 刪除後保留 log）
  ownerId:        text  NOT NULL
  sourceType:     text  NOT NULL
  eventType:      text                   // message | issue.updated | url_verification 等
  status:         text  NOT NULL         // challenge | queued | no_rules | inactive | error | rejected
  routed:         integer DEFAULT 0      // 成功 enqueue 的 queue 數量
  errorMessage:   text
  payloadSummary: text                   // JSON 截斷至 2KB
  createdAt:      bigint
}
```

### agent_logs

```typescript
{
  id:        text  PK
  agentId:   text  FK → agents.id
  ownerId:   text  NOT NULL
  sessionId: text
  level:     text  NOT NULL              // info | error
  message:   text  NOT NULL
  createdAt: bigint
}
```

---

## Agent 執行模式

目前只支援 **Mode 2（MCP Channel）**。Mode 1 已移除。

### Mode 2：MCP Channel（持久互動 session）

BullMQ Worker 包裝成 MCP Server，透過 `.mcp.json` 讓 `claude` 啟動時自動載入。
Channel JS 統一放在 `packages/channels/`，各 agent 只需設定 `.mcp.json` 指向對應檔案。

```
.mcp.json → packages/channels/{type}.js
                │ 同時也是 BullMQ Worker
                │
BullMQ job 進來
  → Worker 收到 job
  → mcp.notification("notifications/claude/channel", { content, meta })
  → Claude 互動 session 收到 channel 訊息
  → Claude 分析、使用工具（多輪推理，可用任何 MCP tool）
  → Claude 呼叫 reply MCP tool（chat_id + text）
  → dispatchReply（透過 @wpbawsed/agent-broker-core）
  → job.resolve()，BullMQ 標記完成
```

**特性：**
- 持久 session，保留對話 context
- 可用全部 MCP tools（Bash, Jira, Notion, …）
- 啟動方式：`cd agents/{agent-dir} && claude --dangerously-skip-permissions`
- Platform dispatch 集中在 `@wpbawsed/agent-broker-core`

#### Mode 2 Channel 種類

| 檔案 | 適用場景 | 特殊行為 |
|---|---|---|
| `packages/channels/jira.js` | Jira issue 事件 | job 開始 → 轉 In Progress；reply 後 → 轉 Wait UAT |
| `packages/channels/notion.js` | Notion page 事件 | job 開始 → 轉 In Progress；reply 後 → 轉 Wait UAT + 加 comment |
| `packages/channels/line.js` | LINE 群組訊息 | reply 優先用 replyToken，過期則 fallback push |
| `packages/channels/railway.js` | Railway 部署事件 | 無外部 dispatch，reply 只寫 log |
| `packages/channels/universal.js` | 任意來源 | 根據 replyTo URI scheme 自動 dispatch，無 domain logic |

#### Mode 2 Agent 目錄結構

```
agents/{agent-id}/
├── CLAUDE.md         # system prompt + 操作說明（claude 啟動時自動載入）
└── .mcp.json         # MCP server 設定（指向 packages/channels/xxx.js）
```

#### .mcp.json 範例

```json
{
  "mcpServers": {
    "bullmq": {
      "command": "node",
      "args": ["../../packages/channels/jira.js"],
      "env": {
        "REDIS_URL": "redis://:password@localhost:6379",
        "QUEUE_NAME": "broker-{agentId}",
        "AGENT_ID": "{agentId}",
        "JIRA_URL": "https://xxx.atlassian.net",
        "JIRA_EMAIL": "user@example.com",
        "JIRA_API_TOKEN": "..."
      }
    }
  }
}
```

#### universal.js 的 .mcp.json（多平台）

```json
{
  "mcpServers": {
    "bullmq": {
      "command": "node",
      "args": ["../../packages/channels/universal.js"],
      "env": {
        "REDIS_URL": "redis://:password@localhost:6379",
        "QUEUE_NAME": "broker-{agentId}",
        "AGENT_ID": "{agentId}",
        "SLACK_BOT_TOKEN": "xoxb-...",
        "JIRA_URL": "...",
        "JIRA_EMAIL": "...",
        "JIRA_API_TOKEN": "...",
        "NOTION_TOKEN": "...",
        "LINE_CHANNEL_TOKEN": "..."
      }
    }
  }
}
```

---

## agent-broker-core SDK

`@wpbawsed/agent-broker-core`（npm）封裝所有平台的 dispatch 操作，供 `packages/channels/` 使用。

### 安裝

```bash
npm install @wpbawsed/agent-broker-core
```

### 支援的函式

```typescript
// BrokerEvent schema 驗證
validateEvent(data): BrokerEvent
createEvent(fields): BrokerEvent

// 根據 replyTo URI scheme 自動 dispatch
dispatchReply(replyTo: { channel: string, thread_ts?: string }, text: string, opts?): Promise<void>

// replyTo URI 解析
parseReplyChannel(channel: string): { protocol: string, target: string }

// Slack
setSlackReaction(action: 'add'|'remove', channelId, messageTs, emoji?, opts?): Promise<void>

// Jira
transitionJiraIssue(issueKey, namePattern, opts?): Promise<void>

// Notion
updateNotionPage(pageId, properties, opts?): Promise<void>
addNotionComment(pageId, text, opts?): Promise<void>
fetchNotionPage(pageId, opts?): Promise<object|null>
fetchNotionBlocks(pageId, opts?): Promise<string|object[]|null>
```

### replyTo URI 格式

| 平台 | 格式 | 範例 |
|---|---|---|
| Slack | `slack://{channelId}` | `slack://C1234567` |
| Jira | `jira://{issueKey}` | `jira://PROJ-123` |
| Notion | `notion://{pageId}` | `notion://abc123...` |
| LINE | `line://push/{groupOrUserId}?reply={replyToken}` | `line://push/Cxxx?reply=TOKEN` |
| Webhook | `webhook://{url}` | `webhook://https://example.com/hook` |

---

## 標準化 AgentEvent 格式（BullMQ job payload）

```typescript
interface AgentEvent {
  eventId:    string        // randomUUID，webhook 進來時產生
  brokerId:   string
  sourceType: string        // slack | jira | github | line | railway | notion
  eventType:  string        // message | issue.updated | url_verification 等
  payload:    {
    text?:    string        // 主要文字內容
    // 各平台原始欄位（channel, userId, issueKey 等）
    [key: string]: unknown
  }
  replyTo:    string        // 回覆目標 URI（見上方格式表）
                            // 若 routing_rule.replyTarget 有值，會在 enqueue 前覆蓋此欄位
  ts:         string        // ISO8601 or platform timestamp
}
```

---

## Node Agent（port 9090）

獨立的 process 管理 daemon，負責 spawn / kill / 監控 agent process。

### API

```
POST /agents/:id/start
  body: { cmd: string, cwd?: string, env?: Record<string, string> }
  → 201 { pid }
  → 409 if already running

POST /agents/:id/stop
  → 200 { success: true }
  (SIGTERM，5 秒後 SIGKILL)

GET  /agents/:id/status
  → { running, pid, uptime, restartCount, exitCode }

GET  /agents/:id/logs/stream
  → text/event-stream
  → 即時推送 { level: 'info'|'error', message, timestamp }
  → 啟動前 500 行 log buffer 會先 replay

GET  /health
  → { status: 'ok', agents: [{id, pid, running, uptime, restartCount}] }
```

### Process 狀態回報

Process exit 時，Node Agent 呼叫 `POST /internal/node-agent/status`（帶 INTERNAL_TOKEN），API Server 更新 `agents.status`。

---

## API Server 端點

### 認證

```
POST /api/auth/register   { email, password }
POST /api/auth/login      { email, password } → { token }
GET  /api/auth/me
```

### Agent

```
GET    /api/agents
POST   /api/agents          { name, description?, instruction?, queueId?, runtimeCmd? }
GET    /api/agents/:id      → 含 liveStatus（from Node Agent，best-effort）
PATCH  /api/agents/:id
DELETE /api/agents/:id
POST   /api/agents/:id/start
POST   /api/agents/:id/stop
POST   /api/agents/:id/rotate-token
GET    /api/agents/:id/node-status
```

### Queue

```
GET    /api/queues
POST   /api/queues          { name, description? }
GET    /api/queues/:id
PATCH  /api/queues/:id
DELETE /api/queues/:id
```

### Agent Files

```
GET  /api/agents/:id/files           列出 agent 目錄的檔案
GET  /api/agents/:id/files/content   讀取檔案內容 ?path=relative/path
PUT  /api/agents/:id/files/content   寫入檔案內容
```

### Broker

```
GET    /api/brokers
POST   /api/brokers         { name, type, config, requiredVars? }
GET    /api/brokers/:id
PATCH  /api/brokers/:id
DELETE /api/brokers/:id
POST   /api/brokers/:id/activate
POST   /api/brokers/:id/deactivate
```

### Routing

```
GET    /api/routing
POST   /api/routing         { brokerId, queueId, eventTypes?, replyTarget? }
GET    /api/routing/:id
DELETE /api/routing/:id
```

### Logs

```
GET  /api/logs              ?agentId=&limit=           agent 執行 log
GET  /api/logs/webhooks     ?brokerId=&status=&limit=  webhook audit log
GET  /api/logs/:agentId/stream  → text/event-stream（proxy Node Agent SSE）
```

### Playground

```
POST /api/playground/run    { agentId, message, history? }
  → text/event-stream（SSE 串流 Claude 回應）
```

### Admin

```
GET  /api/admin/users
GET  /api/admin/stats
```

### Internal（Node Agent ↔ API Server，需 INTERNAL_TOKEN）

```
POST /internal/node-agent/status  { agentId, status, exitCode? }
POST /internal/agent-log          { agentId, level?, message, metadata? }
```

### Webhook（無 auth，HMAC guards）

```
POST /:tenant/:sourceType/:sourceId
```

---

## UI 頁面

| 路徑 | 說明 |
|---|---|
| `/login` `/register` | 認證頁 |
| `/agents` | Agent 列表，Queue 名稱、狀態 badge，啟動/停止/詳情 |
| `/agents/:id` | Agent 詳情：Overview（編輯）/ Instruction（CLAUDE.md 編輯）/ Logs（SSE）/ Docs / Skills / Variables / Repos / MCP Config |
| `/queues` | Queue 列表，建立/刪除 |
| `/brokers` | Broker 列表，類型 icon，CRUD，webhook URL 複製 |
| `/routing` | `@vue-flow/core` 視覺化連線圖：Broker → Queue → Agent；eventTypes 多選設定 |
| `/logs` | Webhook audit log + Agent 執行 log，篩選 |
| `/playground` | 與 Agent 對話（SSE 串流） |
| `/admin` | 使用者管理、系統統計 |

---

## Repo 結構

```
agent-manager/
├── packages/
│   ├── api/                   # Fastify API Server（port 8080）
│   │   └── src/
│   │       ├── app.ts
│   │       ├── db/
│   │       │   ├── schema.ts
│   │       │   └── migrations/
│   │       │       ├── 0000_unusual_ender_wiggin.sql
│   │       │       ├── 0001_add_user_subdomain.sql
│   │       │       ├── 0002_add_webhook_events.sql
│   │       │       ├── 0003_add_routing_rule_reply_target.sql
│   │       │       └── 0004_new_queue_architecture.sql
│   │       ├── plugins/
│   │       │   ├── auth.ts
│   │       │   ├── db.ts
│   │       │   └── bullmq.ts
│   │       ├── routes/
│   │       │   ├── webhook.ts
│   │       │   ├── auth.ts
│   │       │   ├── agents.ts
│   │       │   ├── agent-files.ts
│   │       │   ├── brokers.ts
│   │       │   ├── queues.ts
│   │       │   ├── routing.ts
│   │       │   ├── logs.ts
│   │       │   ├── playground.ts
│   │       │   ├── admin.ts
│   │       │   └── internal.ts
│   │       ├── services/
│   │       │   ├── agents.ts
│   │       │   ├── auth.ts
│   │       │   ├── brokers.ts
│   │       │   ├── queues.ts
│   │       │   └── routing.ts
│   │       └── normalizers/
│   │           ├── index.ts
│   │           ├── slack.ts
│   │           ├── jira.ts
│   │           ├── github.ts
│   │           ├── line.ts
│   │           ├── railway.ts
│   │           └── notion.ts
│   ├── channels/              # 共用 BullMQ+MCP channel adapters（Mode 2 用）
│   │   ├── package.json       # @agent-manager/channels
│   │   ├── jira.js            # Jira 事件：transition + comment
│   │   ├── notion.js          # Notion 事件：updatePage + addComment
│   │   ├── line.js            # LINE 訊息：replyToken → fallback push
│   │   ├── railway.js         # Railway 事件：log only
│   │   ├── universal.js       # 任意來源：根據 replyTo URI dispatch
│   │   └── test-push.js       # 開發用：手動 push 假 event 到 queue
│   ├── node-agent/            # Node Agent daemon（port 9090）
│   │   └── src/server.ts
│   └── ui/                    # Vue 3（port 3000）
│       └── src/
│           ├── pages/
│           │   ├── AgentsPage.vue
│           │   ├── AgentDetailPage.vue
│           │   ├── QueuesPage.vue
│           │   ├── BrokersPage.vue
│           │   ├── RoutingPage.vue
│           │   ├── LogsPage.vue
│           │   ├── PlaygroundPage.vue
│           │   ├── AdminPage.vue
│           │   ├── LoginPage.vue
│           │   └── RegisterPage.vue
│           ├── components/
│           ├── stores/        # Pinia（auth / agents / queues / brokers / routing / logs）
│           ├── api/
│           └── router/
├── agents/                    # 實際 Agent 實例（不追蹤 .mcp.json 及 .env）
│   └── {agent-id}/
│       ├── CLAUDE.md          # system prompt + 操作說明
│       └── .mcp.json          # MCP server 設定（指向 packages/channels/xxx.js）
├── docker-compose.yml
└── docs/
    ├── SPEC.md                # 本文件
    ├── REQUIREMENTS.md
    ├── ui-redesign.html       # UI 設計規格（同步於 v4 架構）
    └── agent-broker-system-design.md
```

---

## 環境變數

### API Server

```env
PORT=8080
DATABASE_URL=postgres://user:password@localhost:5432/agent_manager
REDIS_URL=redis://localhost:6379
JWT_SECRET=...
NODE_AGENT_URL=http://127.0.0.1:9090
INTERNAL_TOKEN=...          # API Server ↔ Node Agent shared secret
CORS_ORIGIN=http://localhost:3000
```

### Node Agent

```env
PORT=9090
API_SERVER_URL=http://localhost:8080
INTERNAL_TOKEN=...
```

### Agent（Mode 2，.mcp.json env 區塊）

```env
REDIS_URL=redis://:password@localhost:6379
QUEUE_NAME=broker-{agentId}
AGENT_ID={agentId}

# 依使用的 channel 類型填入對應的：
JIRA_URL=https://xxx.atlassian.net
JIRA_EMAIL=...
JIRA_API_TOKEN=...

NOTION_TOKEN=...
NOTION_STATUS_PROP=Status   # 預設 "Status"，可覆蓋

LINE_CHANNEL_TOKEN=...

SLACK_BOT_TOKEN=...
```

---

## Docker Compose

```yaml
services:
  api:
    ports: ["8080:8080"]
    environment:
      DATABASE_URL, REDIS_URL, JWT_SECRET, NODE_AGENT_URL, INTERNAL_TOKEN, CORS_ORIGIN

  ui:
    ports: ["3000:3000"]

  node-agent:
    ports: ["9090:9090"]
    environment:
      API_SERVER_URL, INTERNAL_TOKEN

  postgres:
    image: postgres:15
    ports: ["5432:5432"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

Mode 2 agent（`claude --dangerously-skip-permissions`）直接在 host 執行，不 container 化，原因：
- `claude` CLI 認證存在 `~/.claude/`，container 無法保留
- 吃訂閱制額度，不需 API Key
