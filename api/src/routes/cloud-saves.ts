import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db";
import { requireAuth } from "./auth";
import { signAccess, verifyToken } from "../auth";
import { CLOUD_SAVES_DIR } from "../db";

interface DbSnapshot {
  id: string;
  user_id: string;
  shop: string;
  object_id: string;
  version: number;
  aggregate_hash: string;
  file_count: number;
  total_size_bytes: number;
  variants: string;
  files: string;
  custom_path_raw_paths: string;
  created_at: number;
  updated_at: number;
}

interface DbPending {
  id: string;
  user_id: string;
  shop: string;
  object_id: string;
  snapshot_hash: string;
  base_version: number;
  variants: string;
  files: string;
  custom_path_raw_paths: string;
  created_at: number;
  expires_at: number;
}

interface SnapshotFile {
  variantId: string;
  rawPath: string;
  relativePath: string;
  hash: string;
  sizeBytes: number;
  lastModifiedAt: string;
}

interface SnapshotVariant {
  variantId: string;
  kind: "default" | "steam-account" | "opaque-folder";
  steamId64?: string;
  concreteFolderId?: string;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

function blobPath(hash: string) {
  return path.join(CLOUD_SAVES_DIR, `${hash}.blob`);
}

function baseUrl(req: FastifyRequest) {
  const host = req.headers.host ?? "localhost:3000";
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  return `${proto}://${host}`;
}

function parseVariant(value: unknown): SnapshotVariant {
  if (!value || typeof value !== "object") throw new Error("invalid variant");
  const v = value as Record<string, unknown>;
  if (typeof v.variantId !== "string" || !HASH_PATTERN.test(v.variantId))
    throw new Error("invalid variant id");
  if (v.kind === "default") return { variantId: v.variantId, kind: "default" };
  if (v.kind === "steam-account") {
    if (typeof v.steamId64 !== "string") throw new Error("invalid variant");
    return { variantId: v.variantId, kind: "steam-account", steamId64: v.steamId64 };
  }
  if (v.kind === "opaque-folder") {
    if (typeof v.concreteFolderId !== "string") throw new Error("invalid variant");
    return { variantId: v.variantId, kind: "opaque-folder", concreteFolderId: v.concreteFolderId };
  }
  throw new Error("invalid variant kind");
}

function parseFiles(value: unknown): SnapshotFile[] {
  if (!Array.isArray(value)) throw new Error("invalid files");
  const files: SnapshotFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new Error("invalid file");
    const f = entry as Record<string, unknown>;
    if (
      typeof f.variantId !== "string" ||
      !HASH_PATTERN.test(f.variantId) ||
      typeof f.rawPath !== "string" ||
      typeof f.relativePath !== "string" ||
      typeof f.hash !== "string" ||
      !HASH_PATTERN.test(f.hash) ||
      typeof f.sizeBytes !== "number" ||
      !Number.isSafeInteger(f.sizeBytes) ||
      f.sizeBytes < 0 ||
      typeof f.lastModifiedAt !== "string"
    ) {
      throw new Error("invalid file");
    }
    files.push({
      variantId: f.variantId,
      rawPath: f.rawPath,
      relativePath: f.relativePath,
      hash: f.hash,
      sizeBytes: f.sizeBytes,
      lastModifiedAt: f.lastModifiedAt,
    });
  }
  return files;
}

function parseCustomPathRawPaths(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("invalid custom paths");
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.startsWith("<custom>"))
      throw new Error("invalid custom path");
  }
  return value as string[];
}

export async function cloudSavesRoutes(app: FastifyInstance) {
  // Shared blob upload/download endpoints used through pre-signed uploadUrl/downloadUrl.

  app.put(
    "/cloud-saves/upload",
    { bodyLimit: 2_147_483_647 },
    async (req: FastifyRequest<{ Querystring: { token: string } }>, reply: FastifyReply) => {
      let userId: string;
      try {
        userId = verifyToken(req.query.token, "access");
      } catch {
        return reply.code(401).send({ error: "invalid token" });
      }
      void userId;

      const bytes = req.body as Buffer;
      if (!(bytes instanceof Buffer)) {
        return reply.code(400).send({ error: "request body must be a raw blob" });
      }
      const computedHash = crypto.createHash("sha256").update(bytes).digest("hex");
      const checksum = req.headers["x-amz-checksum-sha256"] as string | undefined;
      if (checksum && Buffer.from(computedHash, "hex").toString("base64") !== checksum) {
        return reply.code(400).send({ error: "blob checksum mismatch" });
      }
      await fs.promises.writeFile(blobPath(computedHash), bytes);
      return reply.code(200).send({});
    }
  );

  app.get(
    "/cloud-saves/download",
    {
      preHandler: [],
    },
    async (req: FastifyRequest<{ Querystring: { token: string; hash: string } }>, reply: FastifyReply) => {
      let userId: string;
      try {
        userId = verifyToken(req.query.token, "access");
      } catch {
        return reply.code(401).send({ error: "invalid token" });
      }
      void userId;
      const hash = req.query.hash;
      if (!hash || !HASH_PATTERN.test(hash)) {
        return reply.code(400).send({ error: "invalid blob hash" });
      }
      const filePath = blobPath(hash);
      if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "blob not found" });
      return reply
        .header("Content-Length", fs.statSync(filePath).size)
        .type("application/octet-stream")
        .send(fs.createReadStream(filePath));
    }
  );

  // List active snapshot for a game (v2).
  app.get(
    "/profile/cloud-saves/snapshots",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Querystring: { shop?: string; objectId?: string } }>) => {
      const userId = (req as any).userId;
      const rows = db
        .prepare(
          `SELECT * FROM cs_snapshots WHERE user_id = ? AND shop = ? AND object_id = ?
           ORDER BY version DESC, created_at DESC LIMIT 1`
        )
        .all(userId, req.query.shop ?? "", req.query.objectId ?? "") as DbSnapshot[];
      return rows.map(formatSnapshotSummary);
    }
  );

  // Prepare a snapshot: returns upload URLs for files that are not yet stored.
  app.post(
    "/profile/cloud-saves/prepare-snapshot",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Body: {
          shop?: string;
          objectId?: string;
          platform?: string;
          hostname?: string;
          snapshotHash?: string;
          baseVersion?: number;
          customPathRawPaths?: unknown;
          variants?: unknown;
          files?: unknown;
        };
      }>,
      reply: FastifyReply
    ) => {
      const userId = (req as any).userId;
      const { shop, objectId, snapshotHash, baseVersion } = req.body;
      if (!shop || !objectId || typeof snapshotHash !== "string" || !HASH_PATTERN.test(snapshotHash)) {
        return reply.code(400).send({ error: "invalid prepare snapshot request" });
      }
      const customPathRawPaths = parseCustomPathRawPaths(req.body.customPathRawPaths ?? []);
      const variants = ((req.body.variants ?? []) as unknown[]).map(parseVariant);
      const files = parseFiles(req.body.files);

      const pendingId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(
        `INSERT INTO cs_pending (id, user_id, shop, object_id, snapshot_hash, base_version, variants, files, custom_path_raw_paths, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        pendingId,
        userId,
        shop,
        objectId,
        snapshotHash,
        Number.isFinite(baseVersion) ? baseVersion : 0,
        JSON.stringify(req.body.variants ?? []),
        JSON.stringify(req.body.files ?? []),
        JSON.stringify(customPathRawPaths),
        now,
        now + 7200
      );

      const token = signAccess(userId);
      const base = baseUrl(req);
      const preparedFiles = files.map((file) => {
        if (fs.existsSync(blobPath(file.hash))) {
          return {
            variantId: file.variantId,
            rawPath: file.rawPath,
            relativePath: file.relativePath,
            status: "skip" as const,
          };
        }
        const uploadUrl = `${base}/cloud-saves/upload?token=${encodeURIComponent(token)}`;
        const requiredHeaders = {
          "Content-Length": String(file.sizeBytes),
          "x-amz-checksum-sha256": Buffer.from(file.hash, "hex").toString("base64"),
        };
        return {
          variantId: file.variantId,
          rawPath: file.rawPath,
          relativePath: file.relativePath,
          status: "upload" as const,
          uploadUrl,
          requiredHeaders,
        };
      });

      return { pendingSnapshotId: pendingId, snapshotHash, files: preparedFiles };
    }
  );

  // Commit a snapshot.
  app.post(
    "/profile/cloud-saves/commit-snapshot",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{ Body: { pendingSnapshotId?: string } }>,
      reply: FastifyReply
    ) => {
      const userId = (req as any).userId;
      const pending = db
        .prepare("SELECT * FROM cs_pending WHERE id = ? AND user_id = ?")
        .get(req.body.pendingSnapshotId ?? "", userId) as DbPending | undefined;
      if (!pending) {
        return reply.code(500).send({ error: "game/cloud-save-pending-snapshot-not-found" });
      }
      if (pending.expires_at < Math.floor(Date.now() / 1000)) {
        db.prepare("DELETE FROM cs_pending WHERE id = ?").run(pending.id);
        return reply.code(500).send({ error: "game/cloud-save-pending-snapshot-expired" });
      }

      const files = parseFiles(JSON.parse(pending.files));
      for (const file of files) {
        if (!fs.existsSync(blobPath(file.hash))) {
          return reply.code(500).send({ error: "game/cloud-save-pending-snapshot-incomplete" });
        }
      }

      const expectedVersion = pending.base_version + 1;

      // Optimistic concurrency: bail out if the snapshot for this game was already created afterwards.
      const latest = db
        .prepare(
          `SELECT version FROM cs_snapshots WHERE user_id = ? AND shop = ? AND object_id = ?
           ORDER BY version DESC LIMIT 1`
        )
        .get(userId, pending.shop, pending.object_id) as { version: number } | undefined;

      let snapshotId: string;
      if (latest && latest.version > expectedVersion) {
        return reply.code(409).send({ error: "concurrent snapshot created" });
      }
      if (latest && latest.version === expectedVersion) {
        // The exact same version already exists — reuse it so the client sees a consistent world.
        const existing = db
          .prepare("SELECT * FROM cs_snapshots WHERE user_id = ? AND shop = ? AND object_id = ? AND version = ?")
          .get(userId, pending.shop, pending.object_id, expectedVersion) as DbSnapshot | undefined;
        snapshotId = existing.id;
        db.prepare("UPDATE cs_snapshots SET updated_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000), snapshotId);
      } else {
        snapshotId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO cs_snapshots (id, user_id, shop, object_id, version, aggregate_hash, file_count, total_size_bytes, variants, files, custom_path_raw_paths)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          snapshotId,
          userId,
          pending.shop,
          pending.object_id,
          expectedVersion,
          pending.snapshot_hash,
          files.length,
          files.reduce((sum, file) => sum + file.sizeBytes, 0),
          pending.variants,
          pending.files,
          pending.custom_path_raw_paths
        );
      }

      db.prepare("DELETE FROM cs_pending WHERE id = ?").run(pending.id);
      return {
        snapshotId,
        version: expectedVersion,
        fileCount: files.length,
        totalSizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        aggregateHash: pending.snapshot_hash,
      };
    }
  );

  // Download URLs for restoring a snapshot's files.
  app.get(
    "/profile/cloud-saves/snapshot-download-urls",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Querystring: { snapshotId?: string } }>, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const snapshot = db
        .prepare("SELECT * FROM cs_snapshots WHERE id = ? AND user_id = ?")
        .get(req.query.snapshotId ?? "", userId) as DbSnapshot | undefined;
      if (!snapshot) return reply.code(404).send({ error: "snapshot not found" });

      const files = parseFiles(JSON.parse(snapshot.files));
      const token = signAccess(userId);
      const base = baseUrl(req);
      return files.map((file) => ({
        variantId: file.variantId,
        rawPath: file.rawPath,
        relativePath: file.relativePath,
        hash: file.hash,
        sizeBytes: file.sizeBytes,
        lastModifiedAt: file.lastModifiedAt,
        downloadUrl: `${base}/cloud-saves/download?token=${encodeURIComponent(token)}&hash=${file.hash}`,
      }));
    }
  );

  // Restore manifest: full snapshot metadata + files.
  app.get(
    "/profile/cloud-saves/snapshot-restore-manifest",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Querystring: { snapshotId?: string } }>, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const snapshot = db
        .prepare("SELECT * FROM cs_snapshots WHERE id = ? AND user_id = ?")
        .get(req.query.snapshotId ?? "", userId) as DbSnapshot | undefined;
      if (!snapshot) return reply.code(404).send({ error: "snapshot not found" });

      return {
        snapshot: {
          id: snapshot.id,
          version: snapshot.version,
          shop: snapshot.shop,
          objectId: snapshot.object_id,
        },
        customPathRawPaths: JSON.parse(snapshot.custom_path_raw_paths),
        variants: JSON.parse(snapshot.variants),
        files: JSON.parse(snapshot.files),
      };
    }
  );

  // Delete all cloud save data for a game.
  app.delete(
    "/profile/cloud-saves/snapshots",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Querystring: { objectId?: string; shop?: string } }>, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const rows = db
        .prepare("SELECT * FROM cs_snapshots WHERE user_id = ? AND shop = ? AND object_id = ?")
        .all(userId, req.query.shop ?? "", req.query.objectId ?? "") as DbSnapshot[];
      const hashes = new Set<string>();
      for (const row of rows) {
        for (const file of parseFiles(JSON.parse(row.files))) hashes.add(file.hash);
      }
      db.prepare("DELETE FROM cs_snapshots WHERE user_id = ? AND shop = ? AND object_id = ?").run(
        userId,
        req.query.shop ?? "",
        req.query.objectId ?? ""
      );
      db.prepare("DELETE FROM cs_pending WHERE user_id = ? AND shop = ? AND object_id = ?").run(
        userId,
        req.query.shop ?? "",
        req.query.objectId ?? ""
      );
      // Best-effort GC of blobs no longer referenced anywhere.
      const referenced = new Set<string>();
      const allFiles = db.prepare("SELECT files FROM cs_snapshots").all() as { files: string }[];
      for (const { files } of allFiles) {
        for (const file of parseFiles(JSON.parse(files))) referenced.add(file.hash);
      }
      for (const hash of hashes) {
        if (!referenced.has(hash)) fs.promises.unlink(blobPath(hash)).catch(() => {});
      }
      return {};
    }
  );
}

interface DbSnapshotRow {
  id: string;
  version: number;
  aggregate_hash: string;
  file_count: number;
  total_size_bytes: number;
  created_at: number;
  updated_at: number;
}

function formatSnapshotSummary(row: DbSnapshotRow) {
  return {
    id: row.id,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    fileCount: row.file_count,
    totalSizeBytes: row.total_size_bytes,
    aggregateHash: row.aggregate_hash,
  };
}