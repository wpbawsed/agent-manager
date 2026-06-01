# Agent Manager

A self-hosted platform for managing AI Agents, webhook brokers, queues, and routing rules. Built on a **Broker → Router → Queue → Agent** architecture — think SNS/SQS for your AI Agents.

## Architecture

```
Webhook Event (Jira / Railway / Slack / ...)
    │
    ▼
Broker          ← receives webhooks, normalizes to AgentEvent
    │
    ▼
Routing Rule    ← filters by eventTypes (allowlist), links Broker → Queue
    │
    ▼
Queue           ← independent BullMQ queue (like SQS)
    │
    ▼
Agent           ← 1:1 consumer, runs Claude Code CLI with your instruction
```

## Packages

| Package | Description |
|---|---|
| `packages/api` | Fastify REST API + Drizzle ORM + PostgreSQL |
| `packages/ui` | Vue 3 + Vite + Naive UI frontend |
| `packages/node-agent` | Node.js daemon that manages Agent processes |
| `packages/channels` | Shared types / channel definitions |

## Tech Stack

| Layer | Tech |
|---|---|
| API | Fastify, Drizzle ORM, PostgreSQL, Redis |
| Queue | BullMQ |
| Frontend | Vue 3, Vite, Naive UI, Pinia, Vue Router, @vue-flow/core |
| Agent runtime | Claude Code CLI |
| Auth | JWT (jose) |
| Real-time | SSE (Server-Sent Events) |
| Infra | Docker Compose (local), Cloudflare Workers (webhook receivers) |

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### 1. Clone and install

```bash
git clone <repo-url>
cd agent-manager
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

Required env vars:

```env
JWT_SECRET=<random string>
DATABASE_URL=postgresql://agent:agent@localhost:5432/agent_manager
REDIS_URL=redis://localhost:6379
INTERNAL_TOKEN=<random string for node-agent communication>
NODE_AGENT_URL=http://localhost:9090
```

### 3. Start infrastructure

```bash
docker compose up postgres redis -d
```

### 4. Run migrations

```bash
cd packages/api
pnpm run migrate
```

### 5. Start development servers

```bash
# All at once
pnpm run dev

# Or individually
pnpm run dev:api    # API server on :8080
pnpm run dev:ui     # UI on :3000
```

### Docker (full stack)

```bash
docker compose up --build
```

UI will be available at `http://localhost:3000`.

## UI Pages

| Page | Path | Description |
|---|---|---|
| Login / Register | `/login` `/register` | JWT auth |
| Agents | `/agents` | List + create + start/stop Agents |
| Agent Detail | `/agents/:id` | Overview, Instruction (CLAUDE.md), Logs, Docs, Skills, Variables, MCP, Repos |
| Queues | `/queues` | Manage BullMQ queues |
| Brokers | `/brokers` | Webhook receivers (Jira, Slack, Notion) |
| Routing | `/routing` | Visual flow: Broker → Queue → Agent with eventTypes filters |
| Logs | `/logs` | Real-time SSE log stream + agent log history |
| Playground | `/playground` | Chat with any Agent via SSE |
| Admin | `/admin` | User management (admin role required) |

## API

Base URL: `http://localhost:8080/api`

All routes except `/auth/*` require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register user |
| POST | `/auth/login` | Login → JWT |
| GET | `/auth/me` | Current user |
| GET/POST | `/agents` | List / Create agent |
| GET/PATCH/DELETE | `/agents/:id` | Get / Update / Delete agent |
| POST | `/agents/:id/start` | Start agent process |
| POST | `/agents/:id/stop` | Stop agent process |
| GET | `/agents/:id/logs/stream` | SSE log stream |
| GET/POST | `/queues` | List / Create queue |
| DELETE | `/queues/:id` | Delete queue |
| GET/POST | `/brokers` | List / Create broker |
| PATCH/DELETE | `/brokers/:id` | Update / Delete broker |
| POST | `/brokers/:id/activate` | Activate broker |
| GET/POST | `/routing` | List / Create routing rule |
| DELETE | `/routing/:id` | Delete rule |
| POST | `/webhook/:brokerId` | Webhook entry point |

## Database Schema

| Table | Description |
|---|---|
| `users` | Auth users (email, password hash, role) |
| `queues` | BullMQ queue definitions |
| `agents` | Agent configs (name, instruction, queueId, status) |
| `brokers` | Webhook broker configs (type, credentials, webhookUrl) |
| `routing_rules` | Broker → Queue links with eventTypes filter |
| `webhook_events` | Incoming webhook event log |
| `agent_logs` | Agent execution log history |

## Workflow Example

1. **Create a Queue** — `my-jira-queue`
2. **Create a Broker** — type `jira`, paste your Jira webhook secret
3. **Create a Routing Rule** — link `jira-broker → my-jira-queue`, filter `issue_created,issue_updated`
4. **Create an Agent** — select `my-jira-queue`, write instruction (your CLAUDE.md prompt)
5. **Start the Agent** — it connects to the queue and waits for events
6. **Open a Jira card** → webhook fires → event routed → Agent runs Claude Code CLI automatically

## Deployment

### Cloudflare Workers (webhook receivers)

```bash
pnpm run deploy:workers
```

### Terraform (infrastructure)

```bash
pnpm run tf:init
pnpm run tf:plan
pnpm run tf:apply
```

## Development Notes

- **DB source of truth**: PostgreSQL (via Drizzle ORM)
- **Agent processes**: Managed by `packages/node-agent` (HTTP API on `:9090`)
- **Logs streaming**: API proxies SSE from node-agent to UI
- **Agent files** (CLAUDE.md, Skills, Docs, MCP config, Variables, Repos): stored under `agents/{name}/` directory
