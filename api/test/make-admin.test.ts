import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let db: typeof import("../src/db").db;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-make-admin-"));

before(async () => {
  process.env.DATA_DIR = dataDir;
  ({ db } = await import("../src/db"));
  const { authRoutes } = await import("../src/routes/auth");
  const { profileRoutes } = await import("../src/routes/profile");
  app = (await import("fastify")).default();
  app.register(authRoutes);
  app.register(profileRoutes);
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const register = async (username: string) =>
  (await app.inject({ method: "POST", url: "/auth/register", payload: { username, password: "pw" } })).json().accessToken as string;

test("a signed-in user cannot make themselves admin", async () => {
  // Fresh install: the owner has signed up but has no admin role until enforceInitialAdmin() runs.
  await register("owner");
  const token = await register("mallory");
  await app.inject({ method: "POST", url: "/profile/make-admin", headers: { authorization: `Bearer ${token}` } });
  const { roles } = db.prepare("SELECT roles FROM users WHERE username = 'mallory'").get() as { roles: string | null };
  assert.equal(roles, null);
});
