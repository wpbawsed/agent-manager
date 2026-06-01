// routes/agent-files.ts
// Filesystem-based CRUD for agent docs/, repos/, and .claude/skills/ directories.
// Registered under /api/agents/:id (prefix shared with agents.ts)

import type { FastifyInstance } from "fastify";
import { join, dirname } from "path";
import { readdir, readFile, writeFile, mkdir, rm, rename } from "fs/promises";
import { watch } from "fs";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { agents } from "../db/schema.js";
import { getAgent } from "../services/agents.js";

const execFile = promisify(execFileCb);

const AGENTS_BASE_DIR =
  process.env.AGENTS_BASE_DIR || join(process.cwd(), "..", "..", "agents");

function agentDir(agent: { name: string; id: string }): string {
  const slug = agent.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const shortId = agent.id.split("-")[0];
  return join(AGENTS_BASE_DIR, `${slug}-${shortId}`);
}

// Safe filename: no path traversal
function safeName(name: string): string | null {
  const n = name.replace(/[/\\]/g, "");
  if (!n || n === "." || n === "..") return null;
  return n;
}
// ── Skill file browser helpers ────────────────────────────────────────────

interface SkillFileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: SkillFileEntry[];
}

async function walkSkillDir(dir: string, base = ""): Promise<SkillFileEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    () => [] as Awaited<ReturnType<typeof readdir>>,
  );
  const result: SkillFileEntry[] = [];
  for (const e of entries) {
    const relPath = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const children = await walkSkillDir(join(dir, String(e.name)), String(relPath));
      result.push({ name: String(e.name), path: String(relPath), type: "dir", children });
    } else {
      result.push({ name: String(e.name), path: String(relPath), type: "file" });
    }
  }
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function safeSkillFilePath(skillDir: string, relPath: string): string | null {
  if (!relPath || relPath.includes("\0")) return null;
  const target = join(skillDir, relPath);
  if (!target.startsWith(skillDir + "/")) return null;
  return target;
}
export default async function agentFilesRoutes(app: FastifyInstance) {
  // ── DOCS ──────────────────────────────────────────────────────────────

  // GET /api/agents/:id/docs
  app.get<{ Params: { id: string } }>(
    "/:id/docs",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const dir = join(agentDir(agent), "docs");
      await mkdir(dir, { recursive: true });
      const files = await readdir(dir).catch(() => [] as string[]);
      return files.filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
    },
  );

  // GET /api/agents/:id/docs/:filename
  app.get<{ Params: { id: string; filename: string } }>(
    "/:id/docs/:filename",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const name = safeName(req.params.filename);
      if (!name) return reply.code(400).send({ error: "Invalid filename" });

      const filePath = join(agentDir(agent), "docs", name);
      const content = await readFile(filePath, "utf-8").catch(() => null);
      if (content === null)
        return reply.code(404).send({ error: "File not found" });
      return { filename: name, content };
    },
  );

  // PUT /api/agents/:id/docs/:filename
  app.put<{
    Params: { id: string; filename: string };
    Body: { content: string };
  }>(
    "/:id/docs/:filename",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const name = safeName(req.params.filename);
      if (!name) return reply.code(400).send({ error: "Invalid filename" });

      const { content } = req.body as { content: string };
      if (typeof content !== "string")
        return reply.code(400).send({ error: "content is required" });

      const dir = join(agentDir(agent), "docs");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), content, "utf-8");
      return { filename: name };
    },
  );

  // DELETE /api/agents/:id/docs/:filename
  app.delete<{ Params: { id: string; filename: string } }>(
    "/:id/docs/:filename",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const name = safeName(req.params.filename);
      if (!name) return reply.code(400).send({ error: "Invalid filename" });

      const filePath = join(agentDir(agent), "docs", name);
      await rm(filePath, { force: true });
      return reply.code(204).send();
    },
  );

  // GET /api/agents/:id/docs/watch — SSE: push updated file list on any change in docs/
  app.get<{ Params: { id: string } }>(
    "/:id/docs/watch",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) {
        reply.code(404).send({ error: "Agent not found" });
        return;
      }

      const dir = join(agentDir(agent), "docs");
      await mkdir(dir, { recursive: true });

      const reqOrigin = req.headers.origin || "";
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      if (reqOrigin) {
        reply.raw.setHeader("Access-Control-Allow-Origin", reqOrigin);
        reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
      }
      reply.hijack();

      const sendList = async () => {
        const files = await readdir(dir).catch(() => [] as string[]);
        const list = files.filter(
          (f) => f.endsWith(".md") || f.endsWith(".txt"),
        );
        reply.raw.write(`data: ${JSON.stringify(list)}\n\n`);
      };

      await sendList();

      let debounce: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(dir, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          sendList();
        }, 200);
      });

      req.raw.on("close", () => {
        if (debounce) clearTimeout(debounce);
        watcher.close();
        reply.raw.end();
      });
    },
  );

  // ── SKILLS ────────────────────────────────────────────────────────────

  // GET /api/agents/:id/skills
  app.get<{ Params: { id: string } }>(
    "/:id/skills",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const dir = join(agentDir(agent), ".claude", "skills");
      await mkdir(dir, { recursive: true });
      const entries = await readdir(dir, { withFileTypes: true }).catch(
        () => [] as Awaited<ReturnType<typeof readdir>>,
      );
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    },
  );

  // GET /api/agents/:id/skills/:name — read SKILL.md content
  app.get<{ Params: { id: string; name: string } }>(
    "/:id/skills/:name",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const name = safeName(req.params.name);
      if (!name) return reply.code(400).send({ error: "Invalid skill name" });

      const skillMd = join(
        agentDir(agent),
        ".claude",
        "skills",
        name,
        "SKILL.md",
      );
      const content = await readFile(skillMd, "utf-8").catch(() => null);
      if (content === null)
        return reply.code(404).send({ error: "Skill not found" });
      return { name, content };
    },
  );

  // PUT /api/agents/:id/skills/:name — create or update SKILL.md
  app.put<{
    Params: { id: string; name: string };
    Body: { content: string };
  }>(
    "/:id/skills/:name",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const name = safeName(req.params.name);
      if (!name) return reply.code(400).send({ error: "Invalid skill name" });

      const { content } = req.body as { content: string };
      if (typeof content !== "string")
        return reply.code(400).send({ error: "content is required" });

      const skillDir = join(agentDir(agent), ".claude", "skills", name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
      return { name };
    },
  );

  // PATCH /api/agents/:id/skills/:name — rename skill directory
  app.patch<{ Params: { id: string; name: string }; Body: { name: string } }>(
    "/:id/skills/:name",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const oldName = safeName(req.params.name);
      if (!oldName) return reply.code(400).send({ error: "Invalid skill name" });

      const newName = safeName((req.body as { name: string }).name ?? "");
      if (!newName) return reply.code(400).send({ error: "Invalid new skill name" });

      if (oldName === newName) return { name: newName };

      const skillsDir = join(agentDir(agent), ".claude", "skills");
      const oldDir = join(skillsDir, oldName);
      const newDir = join(skillsDir, newName);

      if (!oldDir.startsWith(skillsDir + "/") || !newDir.startsWith(skillsDir + "/")) {
        return reply.code(400).send({ error: "Invalid path" });
      }

      await rename(oldDir, newDir);
      return { name: newName };
    },
  );

  // DELETE /api/agents/:id/skills/:name
  app.delete<{ Params: { id: string; name: string } }>(
    "/:id/skills/:name",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const name = safeName(req.params.name);
      if (!name) return reply.code(400).send({ error: "Invalid skill name" });

      const skillDir = join(agentDir(agent), ".claude", "skills", name);
      await rm(skillDir, { recursive: true, force: true });
      return reply.code(204).send();
    },
  );

  // ── SKILL FILE BROWSER ───────────────────────────────────────────────

  // GET /:id/skills/:name/files — list all files as tree
  app.get<{ Params: { id: string; name: string } }>(
    "/:id/skills/:name/files",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      const name = safeName(req.params.name);
      if (!name) return reply.code(400).send({ error: "Invalid skill name" });
      const skillDir = join(agentDir(agent), ".claude", "skills", name);
      await mkdir(skillDir, { recursive: true });
      return walkSkillDir(skillDir);
    },
  );

  // GET /:id/skills/:name/files/* — read a file
  app.get<{ Params: { id: string; name: string; "*": string } }>(
    "/:id/skills/:name/files/*",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      const name = safeName(req.params.name);
      if (!name) return reply.code(400).send({ error: "Invalid skill name" });
      const skillDir = join(agentDir(agent), ".claude", "skills", name);
      const filePath = safeSkillFilePath(skillDir, req.params["*"]);
      if (!filePath) return reply.code(400).send({ error: "Invalid path" });
      const content = await readFile(filePath, "utf-8").catch(() => null);
      if (content === null)
        return reply.code(404).send({ error: "File not found" });
      return { path: req.params["*"], content };
    },
  );

  // PUT /:id/skills/:name/files/* — write a file
  app.put<{
    Params: { id: string; name: string; "*": string };
    Body: { content: string };
  }>(
    "/:id/skills/:name/files/*",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      const name = safeName(req.params.name);
      if (!name) return reply.code(400).send({ error: "Invalid skill name" });
      const skillDir = join(agentDir(agent), ".claude", "skills", name);
      const filePath = safeSkillFilePath(skillDir, req.params["*"]);
      if (!filePath) return reply.code(400).send({ error: "Invalid path" });
      const { content } = req.body as { content: string };
      if (typeof content !== "string")
        return reply.code(400).send({ error: "content is required" });
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf-8");
      return { path: req.params["*"] };
    },
  );

  // DELETE /:id/skills/:name/files/* — delete a file
  app.delete<{ Params: { id: string; name: string; "*": string } }>(
    "/:id/skills/:name/files/*",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      const name = safeName(req.params.name);
      if (!name) return reply.code(400).send({ error: "Invalid skill name" });
      const skillDir = join(agentDir(agent), ".claude", "skills", name);
      const filePath = safeSkillFilePath(skillDir, req.params["*"]);
      if (!filePath) return reply.code(400).send({ error: "Invalid path" });
      await rm(filePath, { force: true });
      return reply.code(204).send();
    },
  );

  // ── REPOS ─────────────────────────────────────────────────────────────
  // Repos stored as repos/repos.json: [{ name, path, description }]

  // GET /api/agents/:id/repos
  app.get<{ Params: { id: string } }>(
    "/:id/repos",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const reposFile = join(agentDir(agent), "repos", "repos.json");
      const raw = await readFile(reposFile, "utf-8").catch(() => "[]");
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    },
  );

  // PUT /api/agents/:id/repos — replace entire repos list
  app.put<{
    Params: { id: string };
    Body: {
      repos: Array<{ name: string; path: string; description?: string }>;
    };
  }>("/:id/repos", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const agent = await getAgent(app.db, req.params.id, user.sub);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const { repos } = req.body as {
      repos: Array<{ name: string; path: string; description?: string }>;
    };
    if (!Array.isArray(repos))
      return reply.code(400).send({ error: "repos must be an array" });

    const dir = join(agentDir(agent), "repos");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "repos.json"),
      JSON.stringify(repos, null, 2),
      "utf-8",
    );
    return repos;
  });

  // ── MCP CONFIG ────────────────────────────────────────────────────────

  // GET /api/agents/:id/mcp-config
  app.get<{ Params: { id: string } }>(
    "/:id/mcp-config",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const mcpFile = join(agentDir(agent), ".mcp.json");
      const raw = await readFile(mcpFile, "utf-8").catch(
        () => '{"mcpServers":{}}',
      );
      try {
        return JSON.parse(raw);
      } catch {
        return { mcpServers: {} };
      }
    },
  );

  // PUT /api/agents/:id/mcp-config
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/:id/mcp-config",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      await writeFile(
        join(agentDir(agent), ".mcp.json"),
        JSON.stringify(req.body, null, 2),
        "utf-8",
      );
      return req.body;
    },
  );

  // ── CLAUDE.md (instruction) ───────────────────────────────────────────

  // GET /api/agents/:id/claude-md
  app.get<{ Params: { id: string } }>(
    "/:id/claude-md",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const content = await readFile(
        join(agentDir(agent), "CLAUDE.md"),
        "utf-8",
      ).catch(() => "");
      return { content };
    },
  );

  // PUT /api/agents/:id/claude-md
  app.put<{ Params: { id: string }; Body: { content: string } }>(
    "/:id/claude-md",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const { content } = req.body as { content: string };
      if (typeof content !== "string")
        return reply.code(400).send({ error: "content is required" });

      await writeFile(join(agentDir(agent), "CLAUDE.md"), content, "utf-8");
      return { ok: true };
    },
  );

  // ── VARIABLES (stored in DB) ──────────────────────────────────────────

  // GET /api/agents/:id/variables
  app.get<{ Params: { id: string } }>(
    "/:id/variables",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      try {
        return JSON.parse((agent as any).variables || "{}");
      } catch {
        return {};
      }
    },
  );

  // PUT /api/agents/:id/variables
  app.put<{
    Params: { id: string };
    Body: Record<string, string>;
  }>(
    "/:id/variables",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const vars = req.body as Record<string, string>;
      if (typeof vars !== "object" || Array.isArray(vars))
        return reply.code(400).send({ error: "variables must be an object" });

      await app.db
        .update(agents)
        .set({ variables: JSON.stringify(vars) } as any)
        .where(eq(agents.id, req.params.id));
      return vars;
    },
  );

  // ── MCP (.mcp.json) ───────────────────────────────────────────────────────

  // GET /:id/mcp — read .mcp.json
  app.get<{ Params: { id: string } }>(
    "/:id/mcp",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      const mcpPath = join(agentDir(agent), ".mcp.json");
      const raw = await readFile(mcpPath, "utf-8").catch(() => null);
      if (raw === null) return { mcpServers: {} };
      try {
        return JSON.parse(raw);
      } catch {
        return { mcpServers: {} };
      }
    },
  );

  // PUT /:id/mcp — write .mcp.json
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/:id/mcp",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      const body = req.body as { mcpServers?: Record<string, unknown> };
      if (!body || typeof body !== "object" || !("mcpServers" in body))
        return reply.code(400).send({ error: "mcpServers field is required" });
      const mcpPath = join(agentDir(agent), ".mcp.json");
      await writeFile(mcpPath, JSON.stringify(body, null, 2), "utf-8");
      return body;
    },
  );

  // ── REPOS: clone & delete ──────────────────────────────────────────────────

  // POST /:id/repos/clone — clone a git repo into agents/{name}/repos/{repoName}
  app.post<{
    Params: { id: string };
    Body: { url: string; name?: string; description?: string };
  }>(
    "/:id/repos/clone",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const {
        url,
        name,
        description = "",
      } = req.body as {
        url: string;
        name?: string;
        description?: string;
      };
      if (!url || typeof url !== "string")
        return reply.code(400).send({ error: "url is required" });

      // Derive repo name from URL if not provided, sanitize to safe dirname
      const derived =
        name ||
        url
          .split("/")
          .pop()!
          .replace(/\.git$/, "");
      const safeDirName = derived.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
      if (!safeDirName)
        return reply.code(400).send({ error: "Could not derive repo name" });

      const reposDir = join(agentDir(agent), "repos");
      const cloneTarget = join(reposDir, safeDirName);

      // Prevent path traversal
      if (!cloneTarget.startsWith(reposDir + "/"))
        return reply.code(400).send({ error: "Invalid repo name" });

      await mkdir(reposDir, { recursive: true });

      try {
        await execFile("git", ["clone", "--depth", "1", url, cloneTarget], {
          timeout: 120_000,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(422).send({ error: `git clone failed: ${msg}` });
      }

      // Update repos.json
      const reposFile = join(reposDir, "repos.json");
      const existing = await readFile(reposFile, "utf-8").catch(() => "[]");
      let list: Array<{ name: string; path: string; description: string }> = [];
      try {
        list = JSON.parse(existing);
      } catch {
        list = [];
      }
      // Remove if already exists, then add
      list = list.filter((r) => r.name !== safeDirName);
      list.push({ name: safeDirName, path: cloneTarget, description });
      await writeFile(reposFile, JSON.stringify(list, null, 2), "utf-8");

      return { name: safeDirName, path: cloneTarget, description };
    },
  );

  // DELETE /:id/repos/:name — remove a repo directory and its entry in repos.json
  app.delete<{ Params: { id: string; name: string } }>(
    "/:id/repos/:name",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const agent = await getAgent(app.db, req.params.id, user.sub);
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      const reposDir = join(agentDir(agent), "repos");
      const safeDirName = req.params.name
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .slice(0, 64);
      const target = join(reposDir, safeDirName);

      if (!target.startsWith(reposDir + "/"))
        return reply.code(400).send({ error: "Invalid repo name" });

      await rm(target, { recursive: true, force: true });

      // Remove from repos.json
      const reposFile = join(reposDir, "repos.json");
      const raw = await readFile(reposFile, "utf-8").catch(() => "[]");
      let list: Array<{ name: string }> = [];
      try {
        list = JSON.parse(raw);
      } catch {
        list = [];
      }
      list = list.filter((r) => r.name !== safeDirName);
      await writeFile(reposFile, JSON.stringify(list, null, 2), "utf-8");

      return reply.code(204).send();
    },
  );
}
