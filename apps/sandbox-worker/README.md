# sandbox-worker

Cloudflare Worker，**唯一**能操作 Cloudflare Sandbox 的入口。
Fastify API（Railway）對 cloud agent 的所有生命週期操作都透過這裡。

## 架構

```
Fastify API (Railway)
   │  Bearer SANDBOX_INTERNAL_TOKEN
   ▼
sandbox-worker（本 Worker）
   │  getSandbox(env.Sandbox, agentId)
   ▼
Sandbox instance（每個 agent 一個，隔離 filesystem）
   └─ /opt/agent-runner/index.js   ← 內建 push 回報（heartbeat/metrics/logs）
```

Runner 透過 `runner/` 目錄烘進 Docker image：BullMQ consumer + Claude Agent SDK +
push-client（與 local agent template 相同的回報契約）。

## API

| Method | Path | 說明 |
|---|---|---|
| POST | `/agents/:id/init` | 建立 sandbox、寫入 CLAUDE.md |
| POST | `/agents/:id/start` | 啟動 runner（注入 env） |
| POST | `/agents/:id/stop` | 停止 runner |
| GET | `/agents/:id/status` | runner 是否存活 |

## 部署

```bash
cd apps/sandbox-worker
wrangler secret put SANDBOX_INTERNAL_TOKEN   # 與 API 的 SANDBOX_INTERNAL_TOKEN 相同
wrangler secret put ANTHROPIC_API_KEY
pnpm deploy
```

部署後在 API（Railway）設定：

```
SANDBOX_WORKER_URL=https://agent-manager-sandbox.{account}.workers.dev
SANDBOX_INTERNAL_TOKEN=...
MANAGER_PUBLIC_URL=https://{your-api}.up.railway.app
```

## 注意

- Sandbox 對外連線需可達 Redis（BullMQ）。若 Redis 在內網，需走 TLS tunnel
  （見 `docs/sandbox-migration-todo.md` 的 stunnel 方案）。
- Runner 的回報走 agent-manager 的 `/internal/agents/:id/*` push API，
  用該 agent 自己的 `AGENT_TOKEN` 認證。
