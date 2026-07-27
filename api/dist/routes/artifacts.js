"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.artifactsRoutes = artifactsRoutes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../db");
const auth_1 = require("./auth");
const auth_2 = require("../auth");
function formatArtifact(a) {
    return {
        id: a.id,
        artifactLengthInBytes: a.artifact_length_in_bytes,
        downloadOptionTitle: a.download_option_title,
        createdAt: new Date(a.created_at * 1000).toISOString(),
        updatedAt: new Date(a.updated_at * 1000).toISOString(),
        hostname: a.hostname,
        downloadCount: a.download_count,
        label: a.label,
        isFrozen: Boolean(a.is_frozen),
    };
}
async function artifactsRoutes(app) {
    app.post("/profile/games/artifacts", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const id = node_crypto_1.default.randomUUID();
        const { artifactLengthInBytes, shop, objectId, hostname, winePrefixPath, homeDir, downloadOptionTitle, platform, label } = req.body;
        db_1.db.prepare(`
        INSERT INTO artifacts (id, user_id, object_id, shop, hostname, wine_prefix_path, home_dir, download_option_title, platform, label, artifact_length_in_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, objectId, shop, hostname, winePrefixPath ?? null, homeDir, downloadOptionTitle ?? null, platform, label ?? null, artifactLengthInBytes);
        // uploadUrl points back to this server — client will PUT the file here
        const uploadToken = (0, auth_2.signAccess)(userId);
        const host = req.headers.host ?? "localhost:3000";
        const proto = req.headers["x-forwarded-proto"] ?? "http";
        const uploadUrl = `${proto}://${host}/artifacts/${id}/upload?token=${uploadToken}`;
        return { id, uploadUrl };
    });
    app.get("/profile/games/artifacts", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { objectId, shop } = req.query;
        const artifacts = db_1.db
            .prepare("SELECT * FROM artifacts WHERE user_id = ? AND object_id = ? AND shop = ? ORDER BY created_at DESC")
            .all(userId, objectId, shop);
        return artifacts.map(formatArtifact);
    });
    app.get("/profile/games/:shop/:objectId/artifacts", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const artifacts = db_1.db
            .prepare("SELECT * FROM artifacts WHERE user_id = ? AND object_id = ? AND shop = ? ORDER BY created_at DESC")
            .all(userId, req.params.objectId, req.params.shop);
        return artifacts.map(formatArtifact);
    });
    app.put("/artifacts/:id/upload", async (req, reply) => {
        let userId;
        try {
            userId = (0, auth_2.verifyToken)(req.query.token, "access");
        }
        catch {
            return reply.code(401).send({ error: "invalid token" });
        }
        const artifact = db_1.db
            .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
            .get(req.params.id, userId);
        if (!artifact)
            return reply.code(404).send({ error: "artifact not found" });
        const filePath = node_path_1.default.join(db_1.ARTIFACTS_DIR, `${req.params.id}.tar`);
        const body = req.body;
        await node_fs_1.default.promises.writeFile(filePath, body);
        const stat = await node_fs_1.default.promises.stat(filePath);
        db_1.db.prepare("UPDATE artifacts SET file_path = ?, artifact_length_in_bytes = ?, updated_at = unixepoch() WHERE id = ?").run(filePath, stat.size, req.params.id);
        return {};
    });
    app.get("/artifacts/:id/download", async (req, reply) => {
        let userId;
        try {
            userId = (0, auth_2.verifyToken)(req.query.token, "access");
        }
        catch {
            return reply.code(401).send({ error: "invalid token" });
        }
        const artifact = db_1.db
            .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
            .get(req.params.id, userId);
        if (!artifact?.file_path)
            return reply.code(404).send({ error: "artifact not found" });
        return reply
            .type("application/octet-stream")
            .send(node_fs_1.default.createReadStream(artifact.file_path));
    });
    app.delete("/artifacts/:id", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const userId = req.userId;
        const artifact = db_1.db
            .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
            .get(req.params.id, userId);
        if (!artifact)
            return reply.code(404).send({ error: "not found" });
        if (artifact.file_path) {
            await node_fs_1.default.promises.unlink(artifact.file_path).catch(() => { });
        }
        db_1.db.prepare("DELETE FROM artifacts WHERE id = ?").run(req.params.id);
        return {};
    });
    app.delete("/profile/games/artifacts/:id", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const userId = req.userId;
        const artifact = db_1.db
            .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
            .get(req.params.id, userId);
        if (!artifact)
            return reply.code(404).send({ error: "not found" });
        if (artifact.file_path)
            await node_fs_1.default.promises.unlink(artifact.file_path).catch(() => { });
        db_1.db.prepare("DELETE FROM artifacts WHERE id = ?").run(req.params.id);
        return {};
    });
    // Download URL endpoint — called by launcher before actual download
    app.post("/profile/games/artifacts/:id/download", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const userId = req.userId;
        const artifact = db_1.db
            .prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?")
            .get(req.params.id, userId);
        if (!artifact?.file_path)
            return reply.code(404).send({ error: "artifact not found" });
        const downloadToken = (0, auth_2.signAccess)(userId);
        const host = req.headers.host ?? "localhost:3000";
        const proto = req.headers["x-forwarded-proto"] ?? "http";
        const downloadUrl = `${proto}://${host}/artifacts/${req.params.id}/download?token=${downloadToken}`;
        db_1.db.prepare("UPDATE artifacts SET download_count = download_count + 1 WHERE id = ?").run(req.params.id);
        return {
            downloadUrl,
            objectKey: `${req.params.id}.tar`,
            homeDir: artifact.home_dir,
            winePrefixPath: artifact.wine_prefix_path,
        };
    });
    app.put("/profile/games/artifacts/:id/freeze", { preHandler: auth_1.requireAuth }, async (req) => {
        db_1.db.prepare("UPDATE artifacts SET is_frozen = 1 WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
        return {};
    });
    app.put("/profile/games/artifacts/:id/unfreeze", { preHandler: auth_1.requireAuth }, async (req) => {
        db_1.db.prepare("UPDATE artifacts SET is_frozen = 0 WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
        return {};
    });
}
