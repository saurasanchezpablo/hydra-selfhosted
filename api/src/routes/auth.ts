import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import {
  signAccess,
  signRefresh,
  signWs,
  verifyToken,
  ACCESS_TTL,
} from "../auth";

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password: string, hash: string): boolean {
  if (hash.length === 64) {
    return crypto.createHash("sha256").update(password).digest("hex") === hash;
  }
  return bcrypt.compareSync(password, hash);
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/register",
    async (
      req: FastifyRequest<{ Body: { username: string; password: string } }>,
      reply: FastifyReply
    ) => {
      const { username, password } = req.body;
      if (!username || !password) return reply.code(400).send({ error: "username and password required" });

      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      if (existing) return reply.code(409).send({ error: "username taken" });

      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)"
      ).run(id, username, hashPassword(password), username);

      const accessToken = signAccess(id);
      const refreshToken = signRefresh(id);
      return { accessToken, refreshToken, expiresIn: ACCESS_TTL };
    }
  );

  app.post(
    "/auth/login",
    async (
      req: FastifyRequest<{ Body: { username: string; password: string } }>,
      reply: FastifyReply
    ) => {
      const { username, password } = req.body;
      const user = db
        .prepare("SELECT id, password_hash FROM users WHERE username = ?")
        .get(username) as { id: string; password_hash: string } | undefined;

      if (!user || !verifyPassword(password, user.password_hash)) {
        return reply.code(401).send({ error: "invalid credentials" });
      }

      const accessToken = signAccess(user.id);
      const refreshToken = signRefresh(user.id);
      return { accessToken, refreshToken, expiresIn: ACCESS_TTL };
    }
  );

  app.post(
    "/auth/refresh",
    async (
      req: FastifyRequest<{ Body: { refreshToken: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const userId = verifyToken(req.body.refreshToken, "refresh");
        const accessToken = signAccess(userId);
        return { accessToken, expiresIn: ACCESS_TTL };
      } catch {
        return reply.code(401).send({ error: "invalid refresh token" });
      }
    }
  );

  app.post("/auth/logout", async () => {
    // Token invalidation: in a stateless JWT setup, the client simply discards the token.
    // For a production server, you would add the token to a blocklist.
    return { ok: true };
  });

  // Verify instance token — Hydra calls this when saving settings
  app.post("/auth/verify-instance", async (req: FastifyRequest<{ Body: { token: string } }>, reply: FastifyReply) => {
    const instanceToken = process.env.INSTANCE_TOKEN;
    if (!instanceToken) return { valid: true }; // no token configured = open
    if (req.body.token === instanceToken) return { valid: true };
    return reply.code(401).send({ valid: false, error: "invalid instance token" });
  });

  app.post("/auth/ws", { preHandler: requireAuth }, async (req: FastifyRequest) => {
    const token = signWs((req as any).userId);
    return { token };
  });
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized" });
  try {
    (req as any).userId = verifyToken(auth.slice(7), "access");
  } catch {
    return reply.code(401).send({ error: "invalid token" });
  }
}
