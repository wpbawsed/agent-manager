import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { users } from "./schema.js";
import "dotenv/config";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

async function seed() {
  console.log("🌱 Seeding database...");

  const passwordHash = await bcrypt.hash("test1234", 10);

  const [user] = await db
    .insert(users)
    .values({
      id: nanoid(),
      email: "test@test.com",
      passwordHash,
      role: "owner",
      createdAt: Date.now(),
    })
    .returning();

  console.log(`✅ Created user: ${user.email} (role: ${user.role})`);
  console.log("🎉 Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
