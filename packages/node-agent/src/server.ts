import Fastify from "fastify";
import fcors from "@fastify/cors";
import { spawn, type ChildProcess } from "node:child_process";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentProcess {
  proc: ChildProcess;
  pid: number;
  startedAt: number;
  restartCount: number;
  intentionallyStopped: boolean;
  logBuffer: LogEntry[];
  sseClients: Set<NodeJS.WritableStream>;
}

interface LogEntry {
  level: "info" | "error";
  message: string;
  timestamp: number;
}

// ─── In-memory process map ────────────────────────────────────────────────────

const processMap = new Map<string, AgentProcess>();

/** True only if the OS process actually exists. Signal-killed processes have
 * exitCode===null but signalCode set; zombie/orphan cases are caught by kill(0). */
function isProcessAlive(entry: AgentProcess): boolean {
  if (entry.proc.exitCode !== null) return false;
  if (entry.proc.signalCode !== null) return false;
  try {
    process.kill(entry.pid, 0); // throws ESRCH if process doesn't exist
    return true;
  } catch {
    return false;
  }
}

const MAX_LOG_BUFFER = 500; // keep last 500 lines per agent

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pushLog(agentId: string, entry: LogEntry) {
  const agent = processMap.get(agentId);
  if (!agent) return;
  agent.logBuffer.push(entry);
  if (agent.logBuffer.length > MAX_LOG_BUFFER) {
    agent.logBuffer.shift();
  }
  // Push to all SSE clients
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of agent.sseClients) {
    try {
      client.write(data);
    } catch {
      agent.sseClients.delete(client);
    }
  }
}

async function notifyApiServer(
  agentId: string,
  status: "stopped" | "crashed",
  exitCode: number | null,
) {
  const apiUrl = process.env.API_SERVER_URL || "http://localhost:8080";
  const token = process.env.INTERNAL_TOKEN || "";
  try {
    await fetch(`${apiUrl}/internal/node-agent/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ agentId, status, exitCode }),
    });
  } catch (err) {
    app.log.warn({ err, agentId }, "Failed to notify API server of agent exit");
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

await app.register(fcors, { origin: true });

// Health
app.get("/health", async () => {
  const agents = Array.from(processMap.entries()).map(([id, a]) => ({
    id,
    pid: a.pid,
    running: isProcessAlive(a),
    uptime: Date.now() - a.startedAt,
    restartCount: a.restartCount,
  }));
  return { status: "ok", agents };
});

// Start agent
app.post<{
  Params: { id: string };
  Body: { cmd: string; cwd?: string; env?: Record<string, string> };
}>("/agents/:id/start", async (req, reply) => {
  const { id } = req.params;
  const { cmd, cwd, env = {} } = req.body;

  // If already running, return existing pid
  const existing = processMap.get(id);
  if (existing && isProcessAlive(existing)) {
    return reply
      .code(409)
      .send({ error: "Agent already running", pid: existing.pid });
  }

  const proc = spawn(cmd, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    detached: false,
    ...(cwd ? { cwd } : {}),
  });

  if (!proc.pid) {
    return reply.code(500).send({ error: "Failed to spawn process" });
  }

  const agentEntry: AgentProcess = {
    proc,
    pid: proc.pid,
    startedAt: Date.now(),
    restartCount: existing ? existing.restartCount : 0,
    intentionallyStopped: false,
    logBuffer: [],
    sseClients: new Set(),
  };
  processMap.set(id, agentEntry);

  // Pipe stdout / stderr to log buffer
  proc.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      pushLog(id, { level: "info", message: line, timestamp: Date.now() });
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      pushLog(id, { level: "error", message: line, timestamp: Date.now() });
    }
  });

  proc.on("exit", (code, signal) => {
    app.log.info({ id, code, signal }, "Agent process exited");
    const entry = processMap.get(id);
    const intentional = entry?.intentionallyStopped ?? false;
    const status: "stopped" | "crashed" =
      intentional || code === 0 ? "stopped" : "crashed";
    notifyApiServer(id, status, code ?? null);
    // Clean SSE clients
    if (entry) {
      for (const client of entry.sseClients) {
        try {
          client.end();
        } catch {
          /* ignore */
        }
      }
      entry.sseClients.clear();
    }
  });

  reply.code(201);
  return { pid: proc.pid };
});

// Agent status
app.get<{ Params: { id: string } }>(
  "/agents/:id/status",
  async (req, reply) => {
    const { id } = req.params;
    const agent = processMap.get(id);
    if (!agent) {
      return reply.code(404).send({ error: "Agent not found" });
    }
    const running = isProcessAlive(agent);
    return {
      running,
      pid: running ? agent.pid : null,
      uptime: running ? Date.now() - agent.startedAt : null,
      restartCount: agent.restartCount,
      exitCode: agent.proc.exitCode,
    };
  },
);

// Stop agent
app.post<{ Params: { id: string } }>("/agents/:id/stop", async (req, reply) => {
  const { id } = req.params;
  const agent = processMap.get(id);
  if (!agent) {
    return reply.code(404).send({ error: "Agent not found" });
  }
  if (!isProcessAlive(agent)) {
    processMap.delete(id);
    return { success: true, note: "Already stopped" };
  }
  agent.intentionallyStopped = true;
  agent.proc.kill("SIGTERM");
  // Give it 5s then SIGKILL
  setTimeout(() => {
    try {
      if (isProcessAlive(agent)) agent.proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 5000);
  return { success: true };
});

// SSE log stream
app.get<{ Params: { id: string } }>(
  "/agents/:id/logs/stream",
  async (req, reply) => {
    const { id } = req.params;
    const agent = processMap.get(id);

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders();

    if (!agent) {
      reply.raw.write('data: {"error":"Agent not found"}\n\n');
      reply.raw.end();
      return reply;
    }

    // Replay buffered logs
    for (const entry of agent.logBuffer) {
      reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    // Register as live SSE client
    agent.sseClients.add(reply.raw);

    req.raw.on("close", () => {
      agent.sseClients.delete(reply.raw);
    });

    // Keep connection open (don't resolve)
    await new Promise<void>((resolve) => {
      reply.raw.on("close", resolve);
      reply.raw.on("finish", resolve);
    });

    return reply;
  },
);

// ─── Start ───────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 9090;

app.listen({ port, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Node Agent daemon listening on port ${port}`);
});
