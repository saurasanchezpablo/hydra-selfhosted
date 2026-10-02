import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, IMAGES_DIR } from "../db";
import { requireAuth } from "./auth";
import { signAccess, verifyToken } from "../auth";

export async function imagesRoutes(app: FastifyInstance) {
  app.post(
    "/presigned-urls/:type",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Params: { type: "profile-image" | "background-image" };
        Body: { imageExt: string; imageLength: number };
      }>
    ) => {
      const userId = (req as any).userId;
      const { type } = req.params;
      const { imageExt } = req.body;
      const id = crypto.randomUUID();
      const filename = `${id}.${imageExt}`;

      const uploadToken = signAccess(userId);
      const host = req.headers.host ?? "localhost:3000";
      const proto = req.headers["x-forwarded-proto"] ?? "http";
      const presignedUrl = `${proto}://${host}/images/${filename}/upload?token=${uploadToken}&type=${type}&userId=${userId}`;

      const imageUrl = `${proto}://${host}/images/${filename}`;

      return {
        presignedUrl,
        profileImageUrl: type === "profile-image" ? imageUrl : undefined,
        backgroundImageUrl: type === "background-image" ? imageUrl : undefined,
      };
    }
  );

  app.put(
    "/images/:filename/upload",
    async (
      req: FastifyRequest<{
        Params: { filename: string };
        Querystring: { token: string; type: string; userId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        verifyToken(req.query.token, "access");
      } catch {
        return reply.code(401).send({ error: "invalid token" });
      }

      const filePath = path.join(IMAGES_DIR, req.params.filename);
      await fs.promises.writeFile(filePath, req.body as Buffer);

      const { type, userId } = req.query;
      // Only the two profile image kinds may rewrite a user column. Any other
      // presigned type is stored but must not silently replace the avatar or
      // banner — achievement souvenirs used to land in the `else` branch.
      if (type === "profile-image") {
        db.prepare("UPDATE users SET profile_image_url = ? WHERE id = ?").run(`/images/${req.params.filename}`, userId);
      } else if (type === "background-image") {
        db.prepare("UPDATE users SET background_image_url = ? WHERE id = ?").run(`/images/${req.params.filename}`, userId);
      }

      return {};
    }
  );

  app.get(
    "/images/:filename",
    async (
      req: FastifyRequest<{ Params: { filename: string } }>,
      reply: FastifyReply
    ) => {
      const filePath = path.join(IMAGES_DIR, req.params.filename);
      if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "not found" });

      const ext = path.extname(req.params.filename).slice(1).toLowerCase();
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg",
        png: "image/png", gif: "image/gif",
        webp: "image/webp",
      };

      return reply
        .type(mimeMap[ext] ?? "application/octet-stream")
        .send(fs.createReadStream(filePath));
    }
  );
}
