// sandbox-worker — the only component allowed to touch Cloudflare Sandboxes.
// The Fastify API (Railway) calls these endpoints for cloud agents:
//
//   POST /agents/:id/init    create sandbox + write CLAUDE.md
//   POST /agents/:id/start   start the baked-in runner (push APIs built in)
//   POST /agents/:id/stop    kill the runner process
//   GET  /agents/:id/status  is the runner process alive?
//
// Auth: Bearer SANDBOX_INTERNAL_TOKEN (shared secret with the API server).
import { getSandbox, type Sandbox as SandboxDO } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<SandboxDO>;
  SANDBOX_INTERNAL_TOKEN: string;
  ANTHROPIC_API_KEY: string;
}

const RUNNER_CMD = "node /opt/agent-runner/index.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorized(req: Request, env: Env): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/.exec(auth);
  return Boolean(
    match && env.SANDBOX_INTERNAL_TOKEN && match[1] === env.SANDBOX_INTERNAL_TOKEN,
  );
}

async function findRunner(sandbox: ReturnType<typeof getSandbox>) {
  const processes = await sandbox.listProcesses();
  return processes.find((p) => p.command.includes("agent-runner")) ?? null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const match = /^\/agents\/([^/]+)\/(init|start|stop|status)$/.exec(url.pathname);
    if (!match) return json({ error: "Not found" }, 404);
    if (!authorized(req, env)) return json({ error: "Unauthorized" }, 401);

    const [, agentId, action] = match;
    const sandbox = getSandbox(env.Sandbox, agentId);

    try {
      switch (action) {
        case "init": {
          const body = (await req.json().catch(() => ({}))) as {
            instruction?: string;
          };
          await sandbox.mkdir("/workspace", { recursive: true });
          await sandbox.writeFile("/workspace/CLAUDE.md", body.instruction ?? "");
          return json({ ok: true }, 201);
        }

        case "start": {
          const body = (await req.json().catch(() => ({}))) as {
            cmd?: string;
            env?: Record<string, string>;
            instruction?: string;
          };
          if (body.instruction !== undefined) {
            await sandbox.writeFile("/workspace/CLAUDE.md", body.instruction);
          }

          const existing = await findRunner(sandbox);
          if (existing) return json({ ok: true, note: "Already running", pid: existing.id });

          const proc = await sandbox.startProcess(body.cmd ?? RUNNER_CMD, {
            env: {
              ...body.env,
              ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
            },
            cwd: "/workspace",
          });
          return json({ ok: true, pid: proc.id }, 201);
        }

        case "stop": {
          const proc = await findRunner(sandbox);
          if (!proc) return json({ ok: true, note: "Already stopped" });
          await sandbox.killProcess(proc.id);
          return json({ ok: true });
        }

        case "status": {
          const proc = await findRunner(sandbox);
          return json({ running: Boolean(proc), pid: proc?.id ?? null });
        }
      }
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }

    return json({ error: "Not found" }, 404);
  },
};
