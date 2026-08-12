"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRoutes = adminRoutes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../db");
function hashPassword(password) {
    return bcryptjs_1.default.hashSync(password, 10);
}
function verifyInstanceToken(req, reply) {
    const token = process.env.INSTANCE_TOKEN;
    if (!token)
        return true;
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "missing or invalid authorization header" });
        return false;
    }
    const provided = authHeader.slice(7);
    if (provided !== token) {
        reply.code(403).send({ error: "invalid instance token" });
        return false;
    }
    return true;
}
async function adminRoutes(app) {
    app.get("/admin/stats", async (req, reply) => {
        if (!verifyInstanceToken(req, reply))
            return;
        const userCount = db_1.db.prepare("SELECT COUNT(*) as count FROM users").get().count;
        const gameCount = db_1.db.prepare("SELECT COUNT(*) as count FROM games").get().count;
        const saveCount = db_1.db.prepare("SELECT COUNT(*) as count FROM cloud_saves").get().count ?? 0;
        return { users: userCount, games: gameCount, saves: saveCount };
    });
    app.get("/admin/users", async (req, reply) => {
        if (!verifyInstanceToken(req, reply))
            return;
        const users = db_1.db.prepare("SELECT id, username, display_name, role, created_at, steam_id FROM users ORDER BY created_at DESC").all();
        return { users };
    });
    app.post("/admin/users", async (req, reply) => {
        if (!verifyInstanceToken(req, reply))
            return;
        const { username, password, role } = req.body;
        if (!username || !password) {
            return reply.code(400).send({ error: "username and password required" });
        }
        const existing = db_1.db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (existing) {
            return reply.code(409).send({ error: "username taken" });
        }
        const id = node_crypto_1.default.randomUUID();
        db_1.db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)").run(id, username, hashPassword(password), username, role ?? "user");
        return { id, username, role: role ?? "user" };
    });
    app.put("/admin/users/:id", async (req, reply) => {
        if (!verifyInstanceToken(req, reply))
            return;
        const { id } = req.params;
        const { username, password, role } = req.body;
        const user = db_1.db.prepare("SELECT id FROM users WHERE id = ?").get(id);
        if (!user) {
            return reply.code(404).send({ error: "user not found" });
        }
        if (username) {
            const existing = db_1.db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, id);
            if (existing) {
                return reply.code(409).send({ error: "username taken" });
            }
        }
        const updates = [];
        const values = [];
        if (username) {
            updates.push("username = ?", "display_name = ?");
            values.push(username, username);
        }
        if (password) {
            updates.push("password_hash = ?");
            values.push(hashPassword(password));
        }
        if (role) {
            updates.push("role = ?");
            values.push(role);
        }
        if (updates.length === 0) {
            return reply.code(400).send({ error: "no fields to update" });
        }
        values.push(id);
        db_1.db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
        return { ok: true };
    });
    app.delete("/admin/users/:id", async (req, reply) => {
        if (!verifyInstanceToken(req, reply))
            return;
        const { id } = req.params;
        const user = db_1.db.prepare("SELECT id FROM users WHERE id = ?").get(id);
        if (!user) {
            return reply.code(404).send({ error: "user not found" });
        }
        db_1.db.prepare("DELETE FROM users WHERE id = ?").run(id);
        return { ok: true };
    });
}
