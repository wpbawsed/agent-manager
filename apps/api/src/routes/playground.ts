import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { agents } from "../db/schema.js";

interface PlaygroundMessage {
  role: "user" | "assistant";
  content: string;
}

export default async function playgroundRoutes(app: FastifyInstance) {
  /**
   * POST /api/playground/run
   * Body: { agent_id, message, history?: PlaygroundMessage[] }
   * Response: text/event-stream
   *
   * Generic playground endpoint — runs a one-shot prompt against the agent's instruction.
   */
  app.post<{
    Body: {
      agent_id: string;
      message: string;
      history?: PlaygroundMessage[];
    };
  }>("/run", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const { agent_id, message, history = [] } = req.body;

    if (!agent_id || !message) {
      return reply
        .status(400)
        .send({ error: "agent_id and message are required" });
    }

    // Load agent
    const [agent] = await app.db
      .select()
      .from(agents)
      .where(eq(agents.id, agent_id))
      .limit(1);

    if (!agent || agent.ownerId !== user.sub) {
      return reply.status(404).send({ error: "Agent not found" });
    }

    // Build the prompt: inject instruction + history + message
    const parts: string[] = [];
    if (agent.instruction) {
      parts.push(`[System]\n${agent.instruction}\n`);
    }
    for (const h of history) {
      parts.push(
        `[${h.role === "user" ? "Human" : "Assistant"}]\n${h.content}`,
      );
    }
    parts.push(`[Human]\n${message}`);
    const fullPrompt = parts.join("\n\n");

    // Set SSE headers
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader("Content-Type", "text/event-stream");
    raw.setHeader("Cache-Control", "no-cache");
    raw.setHeader("Connection", "keep-alive");
    raw.flushHeaders();

    // Spawn claude CLI
    const proc = spawn(
      "claude",
      ["--print", fullPrompt, "--output-format", "stream-json"],
      {
        shell: false,
        env: { ...process.env },
      },
    );

    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          // claude stream-json emits { type, ... }
          if (parsed.type === "text" || parsed.type === "content_block_delta") {
            const text = parsed.text ?? parsed.delta?.text ?? "";
            if (text) {
              raw.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
          }
        } catch {
          // raw text fallback
          raw.write(`data: ${JSON.stringify({ text: line })}\n\n`);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      raw.write(`data: ${JSON.stringify({ error: chunk.toString() })}\n\n`);
    });

    proc.on("close", () => {
      raw.write("data: [DONE]\n\n");
      raw.end();
    });

    proc.on("error", (err) => {
      raw.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      raw.write("data: [DONE]\n\n");
      raw.end();
    });

    // If client disconnects, kill claude
    req.socket?.on("close", () => {
      proc.kill("SIGTERM");
    });
  });
}
