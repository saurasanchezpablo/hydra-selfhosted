"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.imagesRoutes = imagesRoutes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../db");
const auth_1 = require("./auth");
const auth_2 = require("../auth");
async function imagesRoutes(app) {
    app.post("/presigned-urls/:type", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { type } = req.params;
        const { imageExt } = req.body;
        const id = node_crypto_1.default.randomUUID();
        const filename = `${id}.${imageExt}`;
        const uploadToken = (0, auth_2.signAccess)(userId);
        const host = req.headers.host ?? "localhost:3000";
        const proto = req.headers["x-forwarded-proto"] ?? "http";
        const presignedUrl = `${proto}://${host}/images/${filename}/upload?token=${uploadToken}&type=${type}&userId=${userId}`;
        const imageUrl = `${proto}://${host}/images/${filename}`;
        return {
            presignedUrl,
            profileImageUrl: type === "profile-image" ? imageUrl : undefined,
            backgroundImageUrl: type === "background-image" ? imageUrl : undefined,
        };
    });
    app.put("/images/:filename/upload", async (req, reply) => {
        try {
            (0, auth_2.verifyToken)(req.query.token, "access");
        }
        catch {
            return reply.code(401).send({ error: "invalid token" });
        }
        const filePath = node_path_1.default.join(db_1.IMAGES_DIR, req.params.filename);
        await node_fs_1.default.promises.writeFile(filePath, req.body);
        const { type, userId } = req.query;
        // Only the two profile image kinds may rewrite a user column. Any other
        // presigned type is stored but must not silently replace the avatar or
        // banner — achievement souvenirs used to land in the `else` branch.
        if (type === "profile-image") {
            db_1.db.prepare("UPDATE users SET profile_image_url = ? WHERE id = ?").run(`/images/${req.params.filename}`, userId);
        }
        else if (type === "background-image") {
            db_1.db.prepare("UPDATE users SET background_image_url = ? WHERE id = ?").run(`/images/${req.params.filename}`, userId);
        }
        return {};
    });
    app.get("/images/:filename", async (req, reply) => {
        const filePath = node_path_1.default.join(db_1.IMAGES_DIR, req.params.filename);
        if (!node_fs_1.default.existsSync(filePath))
            return reply.code(404).send({ error: "not found" });
        const ext = node_path_1.default.extname(req.params.filename).slice(1).toLowerCase();
        const mimeMap = {
            jpg: "image/jpeg", jpeg: "image/jpeg",
            png: "image/png", gif: "image/gif",
            webp: "image/webp",
        };
        return reply
            .type(mimeMap[ext] ?? "application/octet-stream")
            .send(node_fs_1.default.createReadStream(filePath));
    });
}
