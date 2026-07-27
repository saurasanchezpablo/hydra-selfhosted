"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
exports.requireAuth = requireAuth;
const node_crypto_1 = __importDefault(require("node:crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
const auth_1 = require("../auth");
function hashPassword(password) {
    return bcryptjs_1.default.hashSync(password, 10);
}
function verifyPassword(password, hash) {
    if (hash.length === 64) {
        return node_crypto_1.default.createHash("sha256").update(password).digest("hex") === hash;
    }
    return bcryptjs_1.default.compareSync(password, hash);
}
async function authRoutes(app) {
    app.post("/auth/register", async (req, reply) => {
        const { username, password } = req.body;
        if (!username || !password)
            return reply.code(400).send({ error: "username and password required" });
        const existing = db_1.db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (existing)
            return reply.code(409).send({ error: "username taken" });
        const id = node_crypto_1.default.randomUUID();
        db_1.db.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)").run(id, username, hashPassword(password), username);
        const accessToken = (0, auth_1.signAccess)(id);
        const refreshToken = (0, auth_1.signRefresh)(id);
        return { accessToken, refreshToken, expiresIn: auth_1.ACCESS_TTL };
    });
    app.post("/auth/login", async (req, reply) => {
        const { username, password } = req.body;
        const user = db_1.db
            .prepare("SELECT id, password_hash FROM users WHERE username = ?")
            .get(username);
        if (!user || !verifyPassword(password, user.password_hash)) {
            return reply.code(401).send({ error: "invalid credentials" });
        }
        const accessToken = (0, auth_1.signAccess)(user.id);
        const refreshToken = (0, auth_1.signRefresh)(user.id);
        return { accessToken, refreshToken, expiresIn: auth_1.ACCESS_TTL };
    });
    app.post("/auth/refresh", async (req, reply) => {
        try {
            const userId = (0, auth_1.verifyToken)(req.body.refreshToken, "refresh");
            const accessToken = (0, auth_1.signAccess)(userId);
            return { accessToken, expiresIn: auth_1.ACCESS_TTL };
        }
        catch {
            return reply.code(401).send({ error: "invalid refresh token" });
        }
    });
    app.post("/auth/logout", async () => {
        // Token invalidation: in a stateless JWT setup, the client simply discards the token.
        // For a production server, you would add the token to a blocklist.
        return { ok: true };
    });
    // Verify instance token — Hydra calls this when saving settings
    app.post("/auth/verify-instance", async (req, reply) => {
        const instanceToken = process.env.INSTANCE_TOKEN;
        if (!instanceToken)
            return { valid: true }; // no token configured = open
        if (req.body.token === instanceToken)
            return { valid: true };
        return reply.code(401).send({ valid: false, error: "invalid instance token" });
    });
    app.post("/auth/ws", { preHandler: requireAuth }, async (req) => {
        const token = (0, auth_1.signWs)(req.userId);
        return { token };
    });
}
async function requireAuth(req, reply) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer "))
        return reply.code(401).send({ error: "unauthorized" });
    try {
        req.userId = (0, auth_1.verifyToken)(auth.slice(7), "access");
    }
    catch {
        return reply.code(401).send({ error: "invalid token" });
    }
}
