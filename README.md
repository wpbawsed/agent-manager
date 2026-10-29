# Agent Manager

A self-hosted control plane for AI agents: webhook brokers, routing rules, queues, and the agent registry. Built on a **Broker → Routing Rule → Queue → Agent** architecture — think SNS/SQS for your AI agents.

The manager never runs agents itself. Each agent is its own runtime (normally a [template-claude-agent](https://github.com/wpbawsed/template-claude-agent) container) that consumes its queue and reports back through the push APIs.

Where this is heading (workflow layer, shared agent shell, migration phases): [`docs/system-integration-design.md`](docs/system-integration-design.md).

## Architecture

```
Webhook Event (Jira / Slack / GitHub / LINE / Notion / Railway)
    │
    ▼
Broker          ← receives webhooks, normalizes to AgentEvent (apps/api/src/normalizers)
    │
    ▼
Routing Rule    ← filters by eventType / conditions, links Broker → Queue, carries the reply policy
    │
    ▼
Queue           ← independent BullMQ queue (like SQS)
    │
    ▼
Agent           ← 1:1 consumer, runs on its own (local machine or cloud container)
    │
    ▼ PATCH /internal/events/:eventId
Reply policy    ← posts the result back to Slack / Jira / Notion / LINE (apps/api/src/lib/broker-core.ts)
```

## Apps

| App | Description |
|---|---|
| `apps/api` | Fastify REST API + Drizzle ORM + PostgreSQL + BullMQ; webhook ingress, reply dispatch |
| `apps/ui` | Vue 3 + Vite + Pinia frontend |

## Tech Stack

| Layer | Tech |
|---|---|
| API | Fastify, Drizzle ORM, PostgreSQL, Redis |
| Queue | BullMQ |
| Frontend | Vue 3, Vite, Pinia, Vue Router |
| Auth | JWT (`@fastify/jwt`) for users; per-agent `apiToken` for the push APIs |
| Infra | Docker Compose (local), Railway (deploy) |

## Quick Start

Prerequisites: Node.js 20+, pnpm 9+, Docker.

```bash
pnpm install
cp .env.example .env          # fill in JWT_SECRET, INTERNAL_TOKEN
docker compose up postgres redis -d
pnpm run dev                  # API on :8080, UI on :3000
```

Pending DB migrations run automatically when the API container starts (`apps/api/src/db/migrate.ts`).

Full stack in Docker:

```bash
docker compose up --build
```

UI at `http://localhost:3000`.

## Tests

```bash
pnpm --filter @agent-manager/api run test:unit   # broker-core, no server needed
pnpm --filter @agent-manager/api run test        # integration, needs the API on :8080
```

## UI Pages

| Page | Path | Description |
|---|---|---|
| Login / Register | `/login` `/register` | JWT auth |
| Agents | `/agents` | Register agents, online status from heartbeats, setup material (token, env, push endpoints) |
| Queues | `/queues` | Manage BullMQ queues |
| Brokers | `/brokers` | Webhook receivers |
| Routing | `/routing` | Broker → Queue rules, eventType filters, reply policy |
| Logs | `/logs` | Agent log history and incoming webhook events |
| Playground | `/playground` | One-shot prompt against an agent's instruction (SSE) |
| Admin | `/admin` | User management and stats (admin role) |

## API

| Prefix | Auth | Purpose |
|---|---|---|
| `POST /:tenant/:sourceType/:sourceId` | broker secret | Webhook ingress |
| `/api/auth` | — | Register / login / me |
| `/api/agents` | user JWT | Agent CRUD, `GET /:id/integration` setup material, agent files |
| `/api/queues`, `/api/brokers`, `/api/routing` | user JWT | Queue / broker / routing rule CRUD |
| `/api/logs`, `/api/playground`, `/api/admin` | user JWT | Logs, playground run, admin |
| `/internal/agents/:id/{heartbeat,metrics,logs}` | agent `apiToken` | Push APIs every agent calls |
| `/internal/events` | `INTERNAL_TOKEN` | Event start (`POST`) / finish (`PATCH /:eventId`, triggers the reply policy) |

## Database Schema

| Table | Description |
|---|---|
| `users` | Auth users |
| `queues` | BullMQ queue definitions |
| `agents` | Agent registry (name, queue 1:1, type local/cloud, apiToken, status, last heartbeat) |
| `agent_metrics` | Metric snapshots pushed by agents |
| `agent_logs` | Agent log history |
| `brokers` | Webhook broker configs |
| `routing_rules` | Broker → Queue links with filters and reply policy |
| `webhook_events` | Incoming webhook event log |
| `reply_contexts` | Where/how to reply for an in-flight event; deleted after the reply fires |

## Workflow Example

1. Create a **Queue** — `my-jira-queue`
2. Create a **Broker** — type `jira`
3. Create a **Routing Rule** — `jira-broker → my-jira-queue`, filter `issue_created`, set a reply policy
4. Register an **Agent** on `my-jira-queue` and copy its setup material
5. Run the agent with that env (e.g. a template-claude-agent container) — it heartbeats in and consumes the queue
6. Open a Jira issue → webhook → routed → agent runs → result posted back to the issue
