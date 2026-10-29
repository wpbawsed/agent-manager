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
| Frontend | Vue 3, Vite, Pinia, Vue Router, Vue Flow (workflow canvas) |
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

Pending DB migrations run automatically when the API container starts (`apps/api/src/db/migrate.ts`). With `pnpm run dev` nothing migrates — on a fresh database run `pnpm --filter @agent-manager/api run db:migrate` first.

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
| Agents | `/agents` | Register agents; monitoring: status (running／idle／error／offline), last heartbeat, brain commit, queue depth, 24h done／failed／avg duration／cost, current workflow step; setup material |
| Queues | `/queues` | Manage BullMQ queues |
| Brokers | `/brokers` | Webhook receivers |
| Routing | `/routing` | Broker → Queue **or** Workflow rules, eventType filters, reply policy |
| Workflows | `/workflows` | Graph editor (Vue Flow): agents as nodes, conditional edges, labels, gates; each save is a new version |
| Runs | `/workflow-runs`, `/workflow-runs/:id` | Runs (waiting-on-human first, count in the sidebar); run detail with the graph, every step's input／result／cost, resume and cancel |
| Logs | `/logs` | Agent log history and incoming webhook events |
| Playground | `/playground` | One-shot prompt against an agent's instruction (SSE) |
| Admin | `/admin` | User management and stats (admin role) |

## API

| Prefix | Auth | Purpose |
|---|---|---|
| `POST /:tenant/:sourceType/:sourceId` | broker secret | Webhook ingress |
| `/api/auth` | — | Register / login / me |
| `/api/agents` | user JWT | Agent CRUD, `GET /overview` monitoring (liveness, brain commit, queue depth, 24h stats), `GET /:id/integration` setup material, agent files |
| `/api/queues`, `/api/brokers`, `/api/routing` | user JWT | Queue / broker / routing rule CRUD |
| `/api/workflows` | user JWT | Workflow graphs; `PUT /:id` with a `graph` saves a new version |
| `/api/workflow-runs` | user JWT | Runs (interrupted first), `GET /:id` with steps, `POST /:id/resume`, `POST /:id/cancel` |
| `/api/logs`, `/api/playground`, `/api/admin` | user JWT | Logs, playground run, admin |
| `/internal/agents/:id/{heartbeat,metrics,logs}` | agent `apiToken` | Push APIs every agent calls (heartbeat: `running`/`idle`/`error`, `brainCommit`, `brainPullError`) |
| `/internal/agents/:id/events` | agent `apiToken` | Event start (`POST`) / finish (`PATCH /:eventId`); like `/internal/events` but books `agent_runs` |
| `GET /internal/agents/:id/work` | agent `apiToken` | Queue depth, recent runs, workflow runs waiting on a human at this agent |
| `/internal/events` | `INTERNAL_TOKEN` | Event start (`POST`) / finish (`PATCH /:eventId`, triggers the reply policy; `wf_` ids drive the workflow engine) |
| `/internal/agent-heartbeat`, `/internal/agent-log` | `INTERNAL_TOKEN` | Legacy, superseded by `/internal/agents/:id/*`; nothing in this repo calls them |

## Database Schema

| Table | Description |
|---|---|
| `users` | Auth users |
| `queues` | BullMQ queue definitions |
| `agents` | Agent registry (name, queue 1:1, type local/cloud, apiToken, status, last heartbeat) |
| `agent_metrics` | Metric snapshots pushed by agents |
| `agent_logs` | Agent log history |
| `brokers` | Webhook broker configs |
| `routing_rules` | Broker → Queue **or** Workflow links with filters and reply policy |
| `webhook_events` | Incoming webhook event log |
| `reply_contexts` | Where/how to reply for an in-flight event; deleted after the reply fires |
| `agent_runs` | One row per (agent, event): status, cost, duration — source of per-agent stats |
| `workflows`, `workflow_versions` | Workflow graphs; every save is a new immutable version |
| `workflow_runs`, `workflow_steps` | Executions pinned to a version, and one checkpoint row per step |

## Workflow Example

1. Create a **Queue** — `my-jira-queue`
2. Create a **Broker** — type `jira`
3. Create a **Routing Rule** — `jira-broker → my-jira-queue`, filter `issue_created`, set a reply policy
4. Register an **Agent** on `my-jira-queue` and copy its setup material
5. Run the agent with that env (e.g. a template-claude-agent container) — it heartbeats in and consumes the queue
6. Open a Jira issue → webhook → routed → agent runs → result posted back to the issue
