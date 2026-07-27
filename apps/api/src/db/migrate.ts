// Run pending migrations against DATABASE_URL, then exit. Invoked from the
// Dockerfile CMD before the server starts (see Dockerfile) — safe to run on
// every boot since drizzle tracks applied migrations and skips them.
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const connectionString =
  process.env.DATABASE_URL || "postgres://localhost:5432/agent_manager";

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

// drizzle's migrator takes no lock of its own — two replicas booting at once
// would race to apply the same migration. Fine at today's numReplicas: 1, but
// this advisory lock keeps it safe if that ever changes, at near-zero cost.
const LOCK_KEY = 0x6167656e746d6772n; // 'agentmgr', truncated to fit bigint

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

try {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied");
} finally {
  await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  await sql.end();
}
