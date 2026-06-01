import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { users } from "../db/schema.js";
import type { DB } from "../db/client.js";

export interface RegisterInput {
  email: string;
  password: string;
  subdomain?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function registerUser(db: DB, input: RegisterInput) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email));
  if (existing) {
    throw Object.assign(new Error("Email already registered"), {
      statusCode: 409,
    });
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const now = Date.now();

  const [user] = await db
    .insert(users)
    .values({
      id: nanoid(),
      email: input.email,
      passwordHash,
      role: "owner",
      subdomain: input.subdomain ?? null,
      createdAt: now,
    })
    .returning();

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    subdomain: user.subdomain,
    createdAt: user.createdAt,
  };
}

export async function loginUser(db: DB, input: LoginInput) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email));
  if (!user) {
    throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });
  }

  return { id: user.id, email: user.email, role: user.role };
}

export async function getUserById(db: DB, id: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id));

  if (!user) {
    throw Object.assign(new Error("User not found"), { statusCode: 404 });
  }
  return user;
}
