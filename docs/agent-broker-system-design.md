# Agent Broker 系統設計文件

## 版本資訊

| 項目 | 內容 |
|------|------|
| 版本 | v1.0.0 |
| 狀態 | Draft |
| 目標讀者 | AI 開發代理 |

---

## 1. 系統概覽

### 1.1 目標

建立一個多租戶 Agent Broker 平台，讓租戶能夠：

- 連接多個第三方服務（Slack、Jira、GitHub 等）作為事件來源（Source）
- 建立 Agent 並訂閱特定 Source
- 當第三方服務產生事件時，自動觸發對應 Agent 執行任務
- Agent 執行完畢後回報結果

### 1.2 核心概念

```
Tenant（租戶）
  ├── Source（第三方服務實例，例如 SlackA、JiraB）
  └── Agent（任務執行單元，訂閱一或多個 Source）

事件流：
第三方服務 → Webhook → Source 識別 → 路由查詢 → Agent Queue → Worker 執行 → 回報結果
```

### 1.3 技術選型

| 元件 | 選型 | 原因 |
|------|------|------|
| HTTP Server | Fastify (Node.js) | 高效能、低開銷、TypeScript 友好 |
| 任務佇列 | BullMQ | 動態 Queue、重試、優先級、本地可跑 |
| 佇列儲存 | Redis | BullMQ 底層依賴，輕量可自架 |
| 資料庫 | PostgreSQL | 關聯型資料、租戶隔離 |
| ORM | Prisma | TypeScript 型別安全 |
| 本地 Tunnel | Cloudflare Tunnel | 穩定、免費、可綁域名 |
| 部署環境 | Linode VPS | 自架，無雲端綁定 |

---

## 2. 系統架構

### 2.1 整體架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                        外部世界                              │
│  SlackA  SlackB  JiraA  JiraB  GitHubA  ...                 │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS Webhook
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Tunnel / Domain                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   Fastify HTTP Server                        │
│                                                             │
│  POST /webhook/:sourceId     ← 接收第三方事件               │
│  POST /api/task/report       ← Agent 回報結果               │
│  GET  /api/admin/queues      ← Bull Board 監控 UI           │
│                                                             │
│  REST API（租戶後台管理）：                                  │
│  /api/tenants                                               │
│  /api/sources                                               │
│  /api/agents                                                │
│  /api/agents/:id/subscriptions                              │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────┐
│           BullMQ             │
│                              │
│  Queue: broker:{agentId}     │  ← 每個 Agent 獨立一條 Queue
│  Queue: broker:{agentId}     │
│  Queue: broker:{agentId}     │
└──────────┬───────────────────┘
           │ Redis
           ▼
┌──────────────────────────────────────────────────────────────┐
│                      Agent Workers                           │
│                                                             │
│  Worker A → 消費 broker:agent_001                           │
│  Worker B → 消費 broker:agent_002                           │
│  Worker C → 消費 broker:agent_003                           │
└──────────────────────────────────────────────────────────────┘
           │ POST /api/task/report
           ▼
┌──────────────────────────────┐
│         Result Handler       │
│  儲存結果、觸發後續動作       │
└──────────────────────────────┘
```

### 2.2 Webhook 處理流程

```
POST /webhook/:sourceId
        │
        ▼
1. 查詢 source（by sourceId）
        │
        ├── 找不到 → 回 404
        │
        ▼
2. 驗證 HMAC Signature（各平台不同）
        │
        ├── 驗證失敗 → 回 401
        │
        ▼
3. 標準化 Payload（NormalizedEvent）
        │
        ▼
4. 查詢訂閱此 source 的所有 Agent
        │
        ▼
5. 對每個 Agent push job 到對應 Queue
        │
        ▼
6. 回 200 OK（立即回應，不等待 Agent 執行）
```

---

## 3. 資料模型

### 3.1 Schema（Prisma）

```prisma
model Tenant {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  sources   Source[]
  agents    Agent[]
}

model Source {
  id         String     @id @default(cuid())
  tenantId   String
  name       String
  type       SourceType // SLACK | JIRA | GITHUB | ...
  webhookSecret String  // 用於驗證 HMAC
  credentials Json      // 加密儲存（OAuth token 等）
  isActive   Boolean    @default(true)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt

  tenant        Tenant         @relation(fields: [tenantId], references: [id])
  subscriptions Subscription[]
}

model Agent {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  config    Json     // Agent 執行所需的設定（prompt、tools 等）
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant        Tenant         @relation(fields: [tenantId], references: [id])
  subscriptions Subscription[]
  taskResults   TaskResult[]
}

model Subscription {
  id        String   @id @default(cuid())
  agentId   String
  sourceId  String
  createdAt DateTime @default(now())

  agent  Agent  @relation(fields: [agentId], references: [id])
  source Source @relation(fields: [sourceId], references: [id])

  @@unique([agentId, sourceId])
}

model TaskResult {
  id        String      @id @default(cuid())
  agentId   String
  jobId     String      // BullMQ job id
  sourceId  String
  status    TaskStatus  // SUCCESS | FAILED | PARTIAL
  result    Json
  error     String?
  startedAt DateTime
  endedAt   DateTime
  createdAt DateTime    @default(now())

  agent Agent @relation(fields: [agentId], references: [id])
}

enum SourceType {
  SLACK
  JIRA
  GITHUB
}

enum TaskStatus {
  SUCCESS
  FAILED
  PARTIAL
}
```

---

## 4. API 設計

### 4.1 Webhook 接收

```
POST /webhook/:sourceId
```

Headers（依平台）：

| 平台 | Signature Header |
|------|-----------------|
| Slack | `X-Slack-Signature` |
| Jira | `X-Hub-Signature-256` |
| GitHub | `X-Hub-Signature-256` |

Response：
- `200 OK`：已接收，進入佇列
- `401 Unauthorized`：Signature 驗證失敗
- `404 Not Found`：sourceId 不存在

### 4.2 租戶管理 API

#### Sources

```
POST   /api/sources           建立 Source
GET    /api/sources           列出該租戶所有 Source
GET    /api/sources/:id       取得 Source 詳細
PATCH  /api/sources/:id       修改 Source
DELETE /api/sources/:id       刪除 Source
```

#### Agents

```
POST   /api/agents            建立 Agent（自動建立 BullMQ Queue + Worker）
GET    /api/agents            列出該租戶所有 Agent
GET    /api/agents/:id        取得 Agent 詳細
PATCH  /api/agents/:id        修改 Agent
DELETE /api/agents/:id        刪除 Agent（自動清除 Queue + 停止 Worker）
```

#### 訂閱管理

```
POST   /api/agents/:id/subscriptions          Agent 訂閱 Source
DELETE /api/agents/:id/subscriptions/:sourceId  取消訂閱
GET    /api/agents/:id/subscriptions          列出訂閱的 Source
```

#### 任務回報

```
POST /api/task/report
```

Body：
```json
{
  "jobId": "string",
  "agentId": "string",
  "sourceId": "string",
  "tenantId": "string",
  "status": "SUCCESS | FAILED | PARTIAL",
  "result": {},
  "error": "string | null",
  "startedAt": "ISO8601",
  "endedAt": "ISO8601"
}
```

---

## 5. BullMQ 設計

### 5.1 Queue 命名規則

```
broker:{agentId}

範例：
broker:agent_cm1a2b3c4d5e6f7g
broker:agent_cm9x8y7z6w5v4u3t
```

### 5.2 Job Payload 結構

```typescript
interface AgentJobPayload {
  jobId: string
  tenantId: string
  sourceId: string
  sourceType: 'SLACK' | 'JIRA' | 'GITHUB'
  agentId: string
  eventType: string        // 'message.created' | 'issue.updated' | ...
  normalizedEvent: NormalizedEvent
  rawPayload: unknown
  enqueuedAt: string       // ISO8601
}

interface NormalizedEvent {
  sourceId: string
  tenantId: string
  sourceType: string
  eventType: string
  actor?: string           // 觸發事件的使用者
  title?: string
  body?: string
  url?: string
  metadata: Record<string, unknown>
  occurredAt: string       // ISO8601
}
```

### 5.3 Queue 設定

```typescript
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,           // 首次重試等 5 秒，之後指數增長
  },
  removeOnComplete: {
    age: 86400,            // 完成的 job 保留 24 小時
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 86400,        // 失敗的 job 保留 7 天
  },
}
```

### 5.4 Worker 生命週期

- **建立 Agent** → 同步建立 BullMQ Worker，註冊到 WorkerRegistry
- **刪除 Agent** → Worker 優雅關閉（`worker.close()`），Queue obliterate
- **服務啟動** → 從 DB 讀取所有 active Agent，重建所有 Worker（支援重啟恢復）

```typescript
// 服務啟動時執行
async function bootstrapWorkers() {
  const agents = await prisma.agent.findMany({ where: { isActive: true } })
  for (const agent of agents) {
    await workerRegistry.start(agent.id, agent.config)
  }
}
```

---

## 6. Signature 驗證

### 6.1 Slack

```typescript
import * as crypto from 'crypto'

function verifySlackSignature(
  signingSecret: string,
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const baseString = `v0:${timestamp}:${body}`
  const hmac = crypto.createHmac('sha256', signingSecret)
  hmac.update(baseString)
  const computed = `v0=${hmac.digest('hex')}`
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
}
```

### 6.2 Jira / GitHub

```typescript
function verifyHubSignature(
  secret: string,
  body: string,
  signature: string         // 格式：sha256=xxxxx
): boolean {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body)
  const computed = `sha256=${hmac.digest('hex')}`
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
}
```

---

## 7. 多租戶隔離規則

### 7.1 資料層

- 所有 DB query 必須帶 `tenantId` 條件
- API 中間件從 JWT token 解析 `tenantId`，注入到 request context
- 禁止跨租戶查詢（Agent 不可存取其他租戶的 Source）

### 7.2 Queue 層

- Queue name 包含 `agentId`，間接隔離租戶
- Worker 只消費自己的 Queue，不跨 Agent 消費

### 7.3 Webhook 層

- 每個 Source 有獨立的 `webhookSecret`
- Webhook URL 以 `sourceId` 識別，不暴露 `tenantId`

### 7.4 Credentials 加密

- Source 的 OAuth token、API Key 等，加密後存入 DB
- 使用環境變數 `ENCRYPTION_KEY` 進行 AES-256-GCM 加密
- 記憶體中解密，不落日誌

---

## 8. 目錄結構

```
agent-broker/
├── src/
│   ├── server.ts                    # Fastify 入口
│   ├── config/
│   │   └── index.ts                 # 環境變數設定
│   ├── plugins/
│   │   ├── auth.ts                  # JWT 驗證 plugin
│   │   ├── prisma.ts                # Prisma client plugin
│   │   └── redis.ts                 # Redis connection plugin
│   ├── routes/
│   │   ├── webhook.ts               # POST /webhook/:sourceId
│   │   ├── task.ts                  # POST /api/task/report
│   │   ├── sources.ts               # CRUD /api/sources
│   │   ├── agents.ts                # CRUD /api/agents
│   │   └── subscriptions.ts         # /api/agents/:id/subscriptions
│   ├── services/
│   │   ├── webhook.service.ts       # Webhook 接收、路由邏輯
│   │   ├── source.service.ts        # Source CRUD 業務邏輯
│   │   ├── agent.service.ts         # Agent CRUD + Worker 生命週期
│   │   └── task.service.ts          # 任務回報處理
│   ├── queue/
│   │   ├── registry.ts              # WorkerRegistry（管理所有 Worker）
│   │   ├── worker.factory.ts        # 建立 Worker 的工廠函式
│   │   └── job.processor.ts         # Worker 處理 job 的核心邏輯
│   ├── normalizers/
│   │   ├── slack.normalizer.ts      # Slack payload 標準化
│   │   ├── jira.normalizer.ts       # Jira payload 標準化
│   │   └── github.normalizer.ts     # GitHub payload 標準化
│   ├── verifiers/
│   │   ├── slack.verifier.ts        # Slack HMAC 驗證
│   │   ├── jira.verifier.ts         # Jira HMAC 驗證
│   │   └── github.verifier.ts       # GitHub HMAC 驗證
│   └── utils/
│       ├── encryption.ts            # AES-256-GCM 加解密
│       └── logger.ts                # Pino logger 設定
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docker-compose.yml               # 本地開發用（Redis + PostgreSQL）
├── .env.example
└── package.json
```

---

## 9. 環境變數

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/agent_broker

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Auth
JWT_SECRET=your-jwt-secret

# Encryption（Credentials 加密）
ENCRYPTION_KEY=32-bytes-hex-string

# Cloudflare Tunnel（本地開發）
CF_TUNNEL_TOKEN=your-tunnel-token
```

---

## 10. 本地開發啟動

### 10.1 docker-compose.yml

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: agent_broker
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 10.2 啟動流程

```bash
# 1. 啟動基礎設施
docker-compose up -d

# 2. 安裝依賴
npm install

# 3. 執行 DB migration
npx prisma migrate dev

# 4. 啟動開發 server
npm run dev

# 5. 啟動 Cloudflare Tunnel（另開 terminal）
cloudflared tunnel --url http://localhost:3000
```

### 10.3 Webhook 測試流程

```
Cloudflare Tunnel → https://xxx.trycloudflare.com
                         │
                         ▼ 設定到第三方服務 Webhook URL
                   https://xxx.trycloudflare.com/webhook/{sourceId}
```

---

## 11. 後續擴展方向

| 功能 | 說明 |
|------|------|
| Rate Limiting | 每個租戶的 Webhook 流量限速，防止單一租戶打爆系統 |
| Bull Board UI | 整合 `@bull-board/fastify` 提供 Queue 監控介面 |
| Dead Letter Queue | 失敗超過重試次數的 job 移入 DLQ，人工介入 |
| Source Health Check | 定期檢查 Source 連線狀態 |
| Webhook 重放 | 提供 API 讓租戶重放歷史事件 |
| 多機器部署 | Worker 從 DB bootstrap，支援水平擴展 |
| Agent 版本管理 | Agent config 變更時保留歷史版本 |
