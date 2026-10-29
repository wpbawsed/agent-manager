import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { agents, routingRules, workflowRuns, workflowSteps, workflowVersions, workflows } from "../db/schema.js";
import { validateGraph, type WorkflowGraph } from "../workflow/graph.js";
import { cancelRun, resumeRun } from "../workflow/engine.js";
import { engineDeps } from "../workflow/deps.js";

// /api/workflows      — the graph (each save = new immutable version)
// /api/workflow-runs  — executions: list, detail with steps, resume, cancel

async function ownedAgentIds(app: FastifyInstance, ownerId: string): Promise<Set<string>> {
  const rows = await app.db.select({ id: agents.id }).from(agents).where(eq(agents.ownerId, ownerId));
  return new Set(rows.map((r) => r.id));
}

async function addVersion(app: FastifyInstance, workflowId: string, graph: WorkflowGraph) {
  const [last] = await app.db
    .select({ version: workflowVersions.version })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId))
    .orderBy(desc(workflowVersions.version))
    .limit(1);
  const [v] = await app.db
    .insert(workflowVersions)
    .values({
      id: randomUUID(),
      workflowId,
      version: (last?.version ?? 0) + 1,
      graph: JSON.stringify(graph),
      createdAt: Date.now(),
    })
    .returning();
  await app.db
    .update(workflows)
    .set({ currentVersionId: v.id, updatedAt: Date.now() })
    .where(eq(workflows.id, workflowId));
  return v;
}

const graphSchema = { type: "object", additionalProperties: true } as const;

export async function workflowRoutes(app: FastifyInstance) {
  // POST /api/workflows — create with its first version
  app.post<{ Body: { name: string; description?: string; graph: WorkflowGraph } }>(
    "/",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "graph"],
          properties: { name: { type: "string", minLength: 1 }, description: { type: "string" }, graph: graphSchema },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const errors = validateGraph(req.body.graph, await ownedAgentIds(app, user.sub));
      if (errors.length) return reply.code(400).send({ error: "Invalid graph", details: errors });
      const now = Date.now();
      const [wf] = await app.db
        .insert(workflows)
        .values({ id: randomUUID(), ownerId: user.sub, name: req.body.name, description: req.body.description ?? null, createdAt: now, updatedAt: now })
        .returning();
      const v = await addVersion(app, wf.id, req.body.graph);
      return reply.code(201).send({ ...wf, currentVersionId: v.id, version: v.version, graph: req.body.graph });
    },
  );

  // GET /api/workflows
  app.get("/", { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: string };
    return app.db
      .select({
        id: workflows.id,
        name: workflows.name,
        description: workflows.description,
        currentVersionId: workflows.currentVersionId,
        version: workflowVersions.version,
        updatedAt: workflows.updatedAt,
      })
      .from(workflows)
      .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
      .where(eq(workflows.ownerId, user.sub))
      .orderBy(desc(workflows.updatedAt));
  });

  // GET /api/workflows/:id — current graph + version list
  app.get<{ Params: { id: string } }>("/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const [wf] = await app.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, req.params.id), eq(workflows.ownerId, user.sub)))
      .limit(1);
    if (!wf) return reply.code(404).send({ error: "Workflow not found" });
    const versions = await app.db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, wf.id))
      .orderBy(desc(workflowVersions.version));
    const current = versions.find((v) => v.id === wf.currentVersionId);
    return {
      ...wf,
      version: current?.version ?? null,
      graph: current ? (JSON.parse(current.graph) as WorkflowGraph) : null,
      versions: versions.map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt })),
    };
  });

  // GET /api/workflows/:id/versions/:version
  app.get<{ Params: { id: string; version: string } }>(
    "/:id/versions/:version",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const [row] = await app.db
        .select({ v: workflowVersions })
        .from(workflowVersions)
        .innerJoin(workflows, eq(workflows.id, workflowVersions.workflowId))
        .where(
          and(
            eq(workflowVersions.workflowId, req.params.id),
            eq(workflowVersions.version, Number(req.params.version)),
            eq(workflows.ownerId, user.sub),
          ),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: "Version not found" });
      return { ...row.v, graph: JSON.parse(row.v.graph) as WorkflowGraph };
    },
  );

  // PUT /api/workflows/:id — rename and/or save a new graph version
  app.put<{ Params: { id: string }; Body: { name?: string; description?: string | null; graph?: WorkflowGraph } }>(
    "/:id",
    {
      schema: {
        body: {
          type: "object",
          properties: { name: { type: "string", minLength: 1 }, description: { type: ["string", "null"] }, graph: graphSchema },
        },
      },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const [wf] = await app.db
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, req.params.id), eq(workflows.ownerId, user.sub)))
        .limit(1);
      if (!wf) return reply.code(404).send({ error: "Workflow not found" });
      if (req.body.graph !== undefined) {
        const errors = validateGraph(req.body.graph, await ownedAgentIds(app, user.sub));
        if (errors.length) return reply.code(400).send({ error: "Invalid graph", details: errors });
      }
      const patch: Partial<typeof workflows.$inferInsert> = { updatedAt: Date.now() };
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.description !== undefined) patch.description = req.body.description;
      await app.db.update(workflows).set(patch).where(eq(workflows.id, wf.id));
      const v = req.body.graph !== undefined ? await addVersion(app, wf.id, req.body.graph) : null;
      return { ok: true, version: v?.version ?? null };
    },
  );

  // DELETE /api/workflows/:id — refused while a routing rule still targets it
  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const [wf] = await app.db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, req.params.id), eq(workflows.ownerId, user.sub)))
      .limit(1);
    if (!wf) return reply.code(404).send({ error: "Workflow not found" });
    const [rule] = await app.db.select({ id: routingRules.id }).from(routingRules).where(eq(routingRules.workflowId, wf.id)).limit(1);
    if (rule) return reply.code(409).send({ error: "A routing rule still targets this workflow", ruleId: rule.id });
    await app.db.delete(workflows).where(eq(workflows.id, wf.id));
    return reply.code(204).send();
  });
}

const RUN_STATUSES = ["running", "interrupted", "done", "failed", "cancelled"];

export async function workflowRunRoutes(app: FastifyInstance) {
  // GET /api/workflow-runs?status=&workflowId=&limit= — interrupted first, then newest
  app.get<{ Querystring: { status?: string; workflowId?: string; limit?: string } }>(
    "/",
    { preHandler: [app.authenticate] },
    async (req) => {
      const user = req.user as { sub: string };
      const filters = [eq(workflowRuns.ownerId, user.sub)];
      const statuses = req.query.status?.split(",").filter((s) => RUN_STATUSES.includes(s));
      if (statuses?.length) filters.push(inArray(workflowRuns.status, statuses));
      if (req.query.workflowId) filters.push(eq(workflowRuns.workflowId, req.query.workflowId));
      return app.db
        .select({
          id: workflowRuns.id,
          workflowId: workflowRuns.workflowId,
          workflowName: workflows.name,
          version: workflowVersions.version,
          status: workflowRuns.status,
          currentNode: workflowRuns.currentNode,
          steps: workflowRuns.steps,
          error: workflowRuns.error,
          createdAt: workflowRuns.createdAt,
          updatedAt: workflowRuns.updatedAt,
        })
        .from(workflowRuns)
        .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
        .leftJoin(workflowVersions, eq(workflowVersions.id, workflowRuns.versionId))
        .where(and(...filters))
        .orderBy(sql`(${workflowRuns.status} = 'interrupted') desc`, desc(workflowRuns.updatedAt))
        .limit(Math.min(Number(req.query.limit) || 50, 200));
    },
  );

  // GET /api/workflow-runs/:id — run, its pinned graph, and every step
  app.get<{ Params: { id: string } }>("/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const [run] = await app.db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, req.params.id), eq(workflowRuns.ownerId, user.sub)))
      .limit(1);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    const [v] = await app.db.select().from(workflowVersions).where(eq(workflowVersions.id, run.versionId)).limit(1);
    const steps = await app.db.select().from(workflowSteps).where(eq(workflowSteps.runId, run.id)).orderBy(asc(workflowSteps.seq));
    const { replyPolicy: _p, steps: stepCount, ...rest } = run;
    return {
      ...rest,
      stepCount, // kind=run steps taken (what maxSteps limits); `steps` below is the full checkpoint list
      state: JSON.parse(run.state),
      version: v?.version ?? null,
      graph: v ? (JSON.parse(v.graph) as WorkflowGraph) : null,
      steps: steps.map((s) => ({ ...s, result: s.result ? JSON.parse(s.result) : null })),
    };
  });

  // POST /api/workflow-runs/:id/resume { message? } — continue an interrupted run
  app.post<{ Params: { id: string }; Body: { message?: string } }>(
    "/:id/resume",
    {
      schema: { body: { type: "object", properties: { message: { type: "string", maxLength: 20000 } } } },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = req.user as { sub: string };
      const err = await resumeRun(engineDeps(app, req.log), req.params.id, user.sub, req.body?.message);
      if (err) return reply.code(err === "Run not found" ? 404 : 409).send({ error: err });
      return { ok: true };
    },
  );

  // POST /api/workflow-runs/:id/cancel
  app.post<{ Params: { id: string } }>("/:id/cancel", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: string };
    const err = await cancelRun(engineDeps(app, req.log), req.params.id, user.sub);
    if (err) return reply.code(err === "Run not found" ? 404 : 409).send({ error: err });
    return { ok: true };
  });
}
