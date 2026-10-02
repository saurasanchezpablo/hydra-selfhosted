"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.souvenirImageUrl = souvenirImageUrl;
exports.achievementSouvenirRoutes = achievementSouvenirRoutes;
exports.persistAchievementSouvenirs = persistAchievementSouvenirs;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../db");
const auth_1 = require("./auth");
const auth_2 = require("../auth");
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
const MIME_BY_EXTENSION = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
};
const maxSouvenirBytes = (Number(process.env.MAX_SOUVENIR_SIZE_MB) || 10) * 1024 * 1024;
function souvenirImageUrl(req, imageKey) {
    if (!imageKey)
        return null;
    const host = req.headers.host ?? "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    return `${proto}://${host}/achievement-images/${imageKey}`;
}
async function achievementSouvenirRoutes(app) {
    // Declared before the generic /presigned-urls/:type handler in images.ts.
    // Fastify matches static segments ahead of parametric ones, so this wins
    // regardless of registration order — but being explicit avoids souvenir
    // uploads falling through to the avatar/banner handler.
    app.post("/presigned-urls/achievement-image", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const userId = req.userId;
        const imageExt = (req.body?.imageExt ?? "jpg").toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(imageExt)) {
            return reply.code(400).send({ message: "souvenir/unsupported-format" });
        }
        if (typeof req.body?.imageLength === "number" &&
            req.body.imageLength > maxSouvenirBytes) {
            return reply.code(413).send({ message: "souvenir/image-too-large" });
        }
        const imageKey = `${node_crypto_1.default.randomUUID()}.${imageExt}`;
        const uploadToken = (0, auth_2.signAccess)(userId);
        const host = req.headers.host ?? "localhost:3000";
        const proto = req.headers["x-forwarded-proto"] ?? "http";
        return {
            presignedUrl: `${proto}://${host}/achievement-images/${imageKey}/upload?token=${encodeURIComponent(uploadToken)}`,
            imageKey,
        };
    });
    app.put("/achievement-images/:imageKey/upload", { bodyLimit: maxSouvenirBytes }, async (req, reply) => {
        try {
            (0, auth_2.verifyToken)(req.query.token ?? "", "access");
        }
        catch {
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
        await node_fs_1.default.promises.writeFile(node_path_1.default.join(db_1.SOUVENIRS_DIR, imageKey), body);
        return {};
    });
    app.get("/achievement-images/:imageKey", async (req, reply) => {
        const { imageKey } = req.params;
        if (!IMAGE_KEY_PATTERN.test(imageKey)) {
            return reply.code(400).send({ message: "souvenir/invalid-image-key" });
        }
        const filePath = node_path_1.default.join(db_1.SOUVENIRS_DIR, imageKey);
        if (!node_fs_1.default.existsSync(filePath)) {
            return reply.code(404).send({ message: "souvenir/not-found" });
        }
        const ext = node_path_1.default.extname(imageKey).slice(1).toLowerCase();
        return reply
            .type(MIME_BY_EXTENSION[ext] ?? "application/octet-stream")
            .send(node_fs_1.default.createReadStream(filePath));
    });
    // The launcher reads a game's achievements (and their souvenir images) for a
    // user id, which for a self-hosted instance is always the signed-in user.
    app.get("/users/:userId/games/achievements", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const myId = req.userId;
        if (req.params.userId !== myId) {
            // Only the owner's achievements are exposed here; other users are
            // served through the public profile API.
            return reply.code(403).send({ message: "user/forbidden" });
        }
        const { shop, objectId } = req.query;
        if (!shop || !objectId)
            return [];
        const rows = db_1.db
            .prepare(`SELECT achievement_id, unlocked_at, image_key
           FROM achievements
           WHERE user_id = ? AND shop = ? AND object_id = ?`)
            .all(myId, shop, objectId);
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
    });
}
/**
 * Persists souvenirs sent alongside an achievements sync and stamps the image
 * key on every achievement the souvenir covers. Idempotent per clientId, which
 * is what lets the launcher retry a partially failed sync.
 */
function persistAchievementSouvenirs(userId, shop, objectId, souvenirs) {
    const insertSouvenir = db_1.db.prepare(`INSERT INTO achievement_souvenirs
       (id, user_id, object_id, shop, client_id, image_key, captured_at, achievement_names)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET
       image_key = excluded.image_key,
       captured_at = excluded.captured_at,
       achievement_names = excluded.achievement_names`);
    const stampAchievement = db_1.db.prepare(`UPDATE achievements SET image_key = ?
     WHERE user_id = ? AND shop = ? AND object_id = ? AND achievement_id = ?`);
    const apply = db_1.db.transaction((items) => {
        for (const souvenir of items) {
            if (!souvenir?.clientId || !souvenir.imageKey)
                continue;
            if (!IMAGE_KEY_PATTERN.test(souvenir.imageKey))
                continue;
            const names = Array.isArray(souvenir.achievementNames)
                ? souvenir.achievementNames.filter((name) => typeof name === "string")
                : [];
            insertSouvenir.run(node_crypto_1.default.randomUUID(), userId, objectId, shop, souvenir.clientId, souvenir.imageKey, souvenir.capturedAt ?? Math.floor(Date.now() / 1000), JSON.stringify(names));
            for (const name of names) {
                stampAchievement.run(souvenir.imageKey, userId, shop, objectId, name);
            }
        }
    });
    apply(souvenirs);
}
