# Agent Manager → Cloudflare Sandbox 遷移 TODO

> ⚠️ **已過時（2026-07-04）**：`node-agent` 已於本次架構調整中移除，方向改為
> agent-teammate monorepo 獨立部署到 Railway（見 `personal-developer-agent/repos/agent-teammate/`），
> 不是遷去 Cloudflare Sandbox。本文件內容不再反映現況，保留僅供歷史參考。

> 討論日期：2026-06-10  
> 目標：將 agent runtime 從本機 node-agent 遷移到 Cloudflare Sandbox，讓電腦不需要開著也能執行 agent。

---

## 架構總覽

```
UI (Vue 3)
  ├── Logs        → SSE stream from sandbox
  ├── Metrics     → CF Analytics / exec metrics
  ├── CLAUDE.md   → 編輯 → API → sandbox.writeFile()
  ├── Skills      → 檔案管理 → sandbox.writeFile/readFile()
  ├── Credentials → 加密存 DB → sandbox exec 時注入 env
  └── Variables   → 存 DB → sandbox exec 時注入 env
        ↓
Fastify API (source of truth: PostgreSQL)
        ↓ HTTP proxy
Cloudflare Worker (sandbox-worker) ← 唯一能操作 Sandbox 的入口
        ↓ getSandbox(env.Sandbox, agentId)
Sandbox instance (per agent, isolated filesystem)
        ↓ MCP Server (per agent)
Agent 可自我修改工作台 (CLAUDE.md / Skills / Variables)
```

**重要限制**：`getSandbox()` 只能在 Cloudflare Worker 內呼叫（需要 Durable Object binding），Fastify API 無法直接建立 Sandbox，必須透過 sandbox-worker HTTP endpoint 當橋樑。

---

## Phase 1：Sandbox Worker 基本版（取代 node-agent）

> 目標：電腦不需要開著，agent 在 Cloudflare 上跑

### [ ] 新增 `apps/sandbox-worker/`

```
apps/sandbox-worker/
├── wrangler.jsonc
├── package.json
├── Dockerfile
└── src/
    └── index.ts
```

### [ ] `wrangler.jsonc`

```jsonc
{
  "name": "agent-manager-sandbox",
  "containers": [{
    "class_name": "Sandbox",
    "image": "./Dockerfile",
    "instance_type": "basic",
    "max_instances": 10
  }],
  "durable_objects": {
    "bindings": [{ "class_name": "Sandbox", "name": "Sandbox" }]
  },
  "migrations": [{ "new_sqlite_classes": ["Sandbox"], "tag": "v1" }]
}
```

### [ ] `Dockerfile`（自訂 image）

```dockerfile
FROM docker.io/cloudflare/sandbox:0.7.0

# Claude Agent SDK
RUN npm install -g @anthropic-ai/claude-agent-sdk

# AWS CLI
RUN pip install awscli

# Helm
RUN curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# kubectl
RUN curl -LO "https://dl.k8s.io/release/$(curl -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && install -m 0755 kubectl /usr/local/bin/kubectl

EXPOSE 8080
```

### [ ] `src/index.ts` — 暴露跟 node-agent 相同的 REST API

| Method | Path | 說明 |
|---|---|---|
| POST | `/agents/:id/init` | 建立 sandbox，寫入初始 CLAUDE.md + skills 目錄 |
| POST | `/agents/:id/start` | `sandbox.exec(runtimeCmd, {env})` |
| POST | `/agents/:id/stop` | `sandbox.destroy()` 或 kill process |
| GET | `/agents/:id/status` | 回傳 running/stopped |
| GET | `/agents/:id/logs/stream` | SSE，轉送 exec stdout/stderr |

### [ ] Fastify API 整合

- `createAgent()` 結尾加 HTTP call 到 `/agents/:id/init`
- `NODE_AGENT_URL` env var 改指向 sandbox-worker URL
- API routes 本身不動（介面相同）

### [ ] 驗證 Redis 連線

- [ ] 測試 sandbox 能否連到 EC2 Redis port 6379（outbound TCP）
- [ ] 如果不通：EC2 裝 stunnel，包成 TLS port 443
  ```ini
  # /etc/stunnel/redis.conf
  [redis]
  accept  = 443
  connect = 127.0.0.1:6379
  cert    = /etc/ssl/certs/stunnel.pem
  ```
  改 `REDIS_URL=rediss://ec2-ip:443`

---

## Phase 2：Variables + Credentials

> 目標：Agent 能安全取得 API keys、env vars

### [ ] DB Schema 新增

```sql
-- 一般環境變數（明文）
CREATE TABLE agent_variables (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(agent_id, key)
);

-- Secrets（加密存）
CREATE TABLE agent_secrets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  UNIQUE(agent_id, key)
);
```

### [ ] Fastify API 新端點

```
GET    /api/agents/:id/variables
PUT    /api/agents/:id/variables/:key    body: { value }
DELETE /api/agents/:id/variables/:key

GET    /api/agents/:id/secrets           ← 只回 key 清單，不回 value
PUT    /api/agents/:id/secrets/:key      body: { value }  → 加密後存
DELETE /api/agents/:id/secrets/:key
```

### [ ] Sandbox Worker start 時注入 env

```typescript
// POST /agents/:id/start
const variables = await db.getVariables(agentId)
const secrets = await db.getSecrets(agentId)   // 解密
const env = { ...variables, ...secrets }
await sandbox.exec(agent.runtimeCmd, { env })
```

### [ ] UI：Agent Detail → Variables tab + Credentials tab

- Variables：key-value 表格，可新增/編輯/刪除
- Credentials：key-value 表格，value 輸入後以 `••••••` 顯示，不可讀回

---

## Phase 3：CLAUDE.md + Skills 檔案管理

> 目標：從 UI 直接編輯 agent 的指令與技能，無需進 terminal

### [ ] DB Schema 新增

```sql
CREATE TABLE agent_files (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  path TEXT NOT NULL,        -- e.g. "CLAUDE.md", ".claude/skills/deploy.md"
  content TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(agent_id, path)
);
```

### [ ] Fastify API 新端點

```
GET    /api/agents/:id/files              ← 列出所有檔案（path + updated_at）
GET    /api/agents/:id/files/*path        ← 讀單一檔案內容
PUT    /api/agents/:id/files/*path        ← 寫檔（DB + sandbox.writeFile）
DELETE /api/agents/:id/files/*path        ← 刪檔（DB + sandbox sandbox 內刪除）
```

### [ ] Sandbox Worker file proxy 端點

```
GET    /agents/:id/files/*path   → sandbox.readFile(path)
PUT    /agents/:id/files/*path   → sandbox.writeFile(path, content)
DELETE /agents/:id/files/*path   → sandbox.exec(`rm /workspace/${path}`)
GET    /agents/:id/files         → sandbox.listFiles('/workspace')
```

### [ ] createAgent 預設建立初始檔案

```typescript
// DB 預建
await db.insertFile(agentId, 'CLAUDE.md', instruction ?? '')
await db.insertFile(agentId, '.claude/skills/.gitkeep', '')

// Sandbox 同步
await sandboxWorker.writeFile(agentId, 'CLAUDE.md', instruction ?? '')
await sandboxWorker.mkdir(agentId, '.claude/skills')
```

### [ ] UI：Agent Detail → CLAUDE.md tab + Skills tab

- CLAUDE.md：Monaco editor，存檔即同步
- Skills：
  - 左側檔案樹（列出 `.claude/skills/` 下所有 `.md`）
  - 右側 Monaco editor
  - 新增 / 重新命名 / 刪除

---

## Phase 4：MCP Server（Agent 自我修改工作台）

> 目標：Agent 執行中可以自己修改 CLAUDE.md、新增 skill、設定 variable

### [ ] MCP Server endpoint（掛在 sandbox-worker 或獨立 Worker）

路徑：`GET/POST /mcp/:agentId`（標準 MCP over HTTP 協議）

暴露的工具：

| Tool | 說明 |
|---|---|
| `read_claudemd()` | 讀自己的 CLAUDE.md |
| `write_claudemd(content)` | 改自己的 CLAUDE.md（寫 DB + sandbox） |
| `list_skills()` | 列出 `.claude/skills/` 下所有檔案 |
| `read_skill(name)` | 讀單一 skill |
| `create_skill(name, content)` | 建新 skill |
| `update_skill(name, content)` | 改 skill |
| `delete_skill(name)` | 刪 skill |
| `set_variable(key, value)` | 設定 env var（寫 DB） |
| `set_secret(key, value)` | 設定 secret（加密寫 DB） |
| `list_variables()` | 列出自己的 variables |

### [ ] 安全驗證

- 每個 MCP request 帶 `Authorization: Bearer {agent.apiToken}`
- 只能操作自己 agentId 對應的資料

### [ ] Agent SDK 啟動時注入 MCP server

```typescript
await query({
  prompt: task,
  mcpServers: [{
    type: 'http',
    url: `${SANDBOX_WORKER_URL}/mcp/${agentId}`,
    headers: { Authorization: `Bearer ${agent.apiToken}` }
  }]
})
```

### [ ] UI 即時反映 agent 的自我修改

- MCP tool 寫入後觸發 API event（WebSocket 或 polling）
- UI Skills tab / CLAUDE.md tab 自動 refresh

---

## Phase 5：Metrics

> 目標：在 UI 看到 agent 的運行狀況

### [ ] 基本 metrics（exec-based）

```typescript
// sandbox-worker GET /agents/:id/metrics
const result = await sandbox.exec('ps aux | grep claude | head -2')
// parse CPU, MEM
```

### [ ] 進階（Cloudflare Workers Analytics Engine）

- 每次 exec 完成後寫入 Analytics Engine（duration、exitCode）
- UI Metrics tab 用 Cloudflare GraphQL API 查詢並畫圖

---

## 不需要改動的部分

| 項目 | 原因 |
|---|---|
| Fastify API 現有 routes | sandbox-worker 暴露相同介面 |
| BullMQ queue 邏輯 | 保留，速度快 |
| DB agents/queues/brokers/routing schema | 不動 |
| UI 現有頁面（Agents list、Queues、Brokers、Routing） | 不動 |
| Webhook broker 邏輯 | 不動 |

---

## 環境變數異動

```bash
# 改這一個，其他不動
NODE_AGENT_URL=https://agent-manager-sandbox.{account}.workers.dev

# 新增
SANDBOX_INTERNAL_TOKEN=...      # sandbox-worker ↔ API 驗證
SECRETS_ENCRYPTION_KEY=...      # agent_secrets 加密 key（AES-256）
```
