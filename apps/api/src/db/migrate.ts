// Run pending migrations against DATABASE_URL, then exit. Invoked from the
// Dockerfile CMD before the server starts (see Dockerfile) — safe to run on
// every boot since drizzle tracks applied migrations and skips them.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const connectionString =
  process.env.DATABASE_URL || "postgres://localhost:5432/agent_manager";

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: new URL("./migrations", import.meta.url).pathname });
await sql.end();

console.log("Migrations applied");
