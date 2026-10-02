import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, SOUVENIRS_DIR } from "../db";
import { requireAuth } from "./auth";
import { signAccess, verifyToken } from "../auth";

/**
 * Achievement souvenirs (launcher >= 4.1.4).
 *
 * The launcher captures a screenshot when achievements unlock and then:
 *   1. POST /presigned-urls/achievement-image  -> { presignedUrl, imageKey }
 *   2. PUT  <presignedUrl>                      (raw image bytes)
 *   3. PUT  /profile/games/achievements         (achievements + souvenirs[])
 *   4. GET  /users/:userId/games/achievements   (reads imageUrl back)
 *
 * Steps 1 and 4 live here; step 3 is handled in profile.ts.
 */

const IMAGE_KEY_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,5}$/;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const maxSouvenirBytes =
  (Number(process.env.MAX_SOUVENIR_SIZE_MB) || 10) * 1024 * 1024;

export function souvenirImageUrl(req: FastifyRequest, imageKey: string | null) {
  if (!imageKey) return null;
  const host = req.headers.host ?? "localhost:3000";
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  return `${proto}://${host}/achievement-images/${imageKey}`;
}

export async function achievementSouvenirRoutes(app: FastifyInstance) {
  // Declared before the generic /presigned-urls/:type handler in images.ts.
  // Fastify matches static segments ahead of parametric ones, so this wins
  // regardless of registration order — but being explicit avoids souvenir
  // uploads falling through to the avatar/banner handler.
  app.post(
    "/presigned-urls/achievement-image",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Body: {
          imageExt?: string;
          imageLength?: number;
          remoteGameId?: string;
          clientId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const userId = (req as any).userId;
      const imageExt = (req.body?.imageExt ?? "jpg").toLowerCase();

      if (!ALLOWED_EXTENSIONS.has(imageExt)) {
        return reply.code(400).send({ message: "souvenir/unsupported-format" });
      }
      if (
        typeof req.body?.imageLength === "number" &&
        req.body.imageLength > maxSouvenirBytes
      ) {
        return reply.code(413).send({ message: "souvenir/image-too-large" });
      }

      const imageKey = `${crypto.randomUUID()}.${imageExt}`;
      const uploadToken = signAccess(userId);
      const host = req.headers.host ?? "localhost:3000";
      const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";

      return {
        presignedUrl: `${proto}://${host}/achievement-images/${imageKey}/upload?token=${encodeURIComponent(uploadToken)}`,
        imageKey,
      };
    }
  );

  app.put(
    "/achievement-images/:imageKey/upload",
    { bodyLimit: maxSouvenirBytes },
    async (
      req: FastifyRequest<{
        Params: { imageKey: string };
        Querystring: { token?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        verifyToken(req.query.token ?? "", "access");
      } catch {
        return reply.code(401).send({ message: "invalid token" });
      }

      const { imageKey } = req.params;
      if (!IMAGE_KEY_PATTERN.test(imageKey)) {
        return reply.code(400).send({ message: "souvenir/invalid-image-key" });
      }

      const body = req.body;
      if (!(body instanceof Buffer)) {
        return reply.code(400).send({ message: "souvenir/invalid-body" });
      }

      await fs.promises.writeFile(path.join(SOUVENIRS_DIR, imageKey), body);
      return {};
    }
  );

  app.get(
    "/achievement-images/:imageKey",
    async (
      req: FastifyRequest<{ Params: { imageKey: string } }>,
      reply: FastifyReply
    ) => {
      const { imageKey } = req.params;
      if (!IMAGE_KEY_PATTERN.test(imageKey)) {
        return reply.code(400).send({ message: "souvenir/invalid-image-key" });
      }

      const filePath = path.join(SOUVENIRS_DIR, imageKey);
      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({ message: "souvenir/not-found" });
      }

      const ext = path.extname(imageKey).slice(1).toLowerCase();
      return reply
        .type(MIME_BY_EXTENSION[ext] ?? "application/octet-stream")
        .send(fs.createReadStream(filePath));
    }
  );

  // The launcher reads a game's achievements (and their souvenir images) for a
  // user id, which for a self-hosted instance is always the signed-in user.
  app.get(
    "/users/:userId/games/achievements",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Params: { userId: string };
        Querystring: { shop?: string; objectId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const myId = (req as any).userId;
      if (req.params.userId !== myId) {
        // Only the owner's achievements are exposed here; other users are
        // served through the public profile API.
        return reply.code(403).send({ message: "user/forbidden" });
      }

      const { shop, objectId } = req.query;
      if (!shop || !objectId) return [];

      const rows = db
        .prepare(
          `SELECT achievement_id, unlocked_at, image_key
           FROM achievements
           WHERE user_id = ? AND shop = ? AND object_id = ?`
        )
        .all(myId, shop, objectId) as {
        achievement_id: string;
        unlocked_at: number;
        image_key: string | null;
      }[];

      return rows.map((row) => ({
        name: row.achievement_id,
        displayName: row.achievement_id,
        description: "",
        icon: "",
        icongray: "",
        hidden: false,
        unlocked: true,
        unlockTime: row.unlocked_at,
        imageUrl: souvenirImageUrl(req, row.image_key),
      }));
    }
  );
}

export interface IncomingSouvenir {
  clientId?: string;
  imageKey?: string;
  capturedAt?: number;
  achievementNames?: string[];
}

/**
 * Persists souvenirs sent alongside an achievements sync and stamps the image
 * key on every achievement the souvenir covers. Idempotent per clientId, which
 * is what lets the launcher retry a partially failed sync.
 */
export function persistAchievementSouvenirs(
  userId: string,
  shop: string,
  objectId: string,
  souvenirs: IncomingSouvenir[]
) {
  const insertSouvenir = db.prepare(
    `INSERT INTO achievement_souvenirs
       (id, user_id, object_id, shop, client_id, image_key, captured_at, achievement_names)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET
       image_key = excluded.image_key,
       captured_at = excluded.captured_at,
       achievement_names = excluded.achievement_names`
  );
  const stampAchievement = db.prepare(
    `UPDATE achievements SET image_key = ?
     WHERE user_id = ? AND shop = ? AND object_id = ? AND achievement_id = ?`
  );

  const apply = db.transaction((items: IncomingSouvenir[]) => {
    for (const souvenir of items) {
      if (!souvenir?.clientId || !souvenir.imageKey) continue;
      if (!IMAGE_KEY_PATTERN.test(souvenir.imageKey)) continue;

      const names = Array.isArray(souvenir.achievementNames)
        ? souvenir.achievementNames.filter(
            (name): name is string => typeof name === "string"
          )
        : [];

      insertSouvenir.run(
        crypto.randomUUID(),
        userId,
        objectId,
        shop,
        souvenir.clientId,
        souvenir.imageKey,
        souvenir.capturedAt ?? Math.floor(Date.now() / 1000),
        JSON.stringify(names)
      );

      for (const name of names) {
        stampAchievement.run(souvenir.imageKey, userId, shop, objectId, name);
      }
    }
  });

  apply(souvenirs);
}
