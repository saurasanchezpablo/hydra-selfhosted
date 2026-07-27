"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.friendsRoutes = friendsRoutes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
const auth_1 = require("./auth");
function formatFriend(user, friendship, myId) {
    return {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        profileImageUrl: user.profile_image_url,
        friendshipId: friendship.id,
        status: friendship.status,
        type: friendship.requester_id === myId ? "sent" : "received",
    };
}
async function friendsRoutes(app) {
    // Search users
    app.get("/users/search", { preHandler: auth_1.requireAuth }, async (req) => {
        const q = `%${req.query.q ?? ""}%`;
        const users = db_1.db
            .prepare("SELECT id, username, display_name, profile_image_url FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 20")
            .all(q, q);
        return users.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, profileImageUrl: u.profile_image_url }));
    });
    // Send friend request
    app.post("/profile/friends/requests", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const myId = req.userId;
        const { userId } = req.body;
        if (myId === userId)
            return reply.code(400).send({ error: "cannot add yourself" });
        const existing = db_1.db.prepare("SELECT id FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)").get(myId, userId, userId, myId);
        if (existing)
            return reply.code(409).send({ error: "already exists" });
        const id = node_crypto_1.default.randomUUID();
        db_1.db.prepare("INSERT INTO friendships (id, requester_id, addressee_id) VALUES (?, ?, ?)").run(id, myId, userId);
        return { id };
    });
    // List friends / requests
    app.get("/profile/friends", { preHandler: auth_1.requireAuth }, async (req) => {
        const myId = req.userId;
        const friendships = db_1.db.prepare("SELECT * FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'").all(myId, myId);
        const results = friendships.map((f) => {
            const otherId = f.requester_id === myId ? f.addressee_id : f.requester_id;
            const user = db_1.db.prepare("SELECT * FROM users WHERE id = ?").get(otherId);
            return user ? formatFriend(user, f, myId) : null;
        }).filter(Boolean);
        return { results, total: results.length };
    });
    // Incoming friend requests
    app.get("/profile/friends/requests/received", { preHandler: auth_1.requireAuth }, async (req) => {
        const myId = req.userId;
        const friendships = db_1.db.prepare("SELECT * FROM friendships WHERE addressee_id = ? AND status = 'pending'").all(myId);
        const results = friendships.map((f) => {
            const user = db_1.db.prepare("SELECT * FROM users WHERE id = ?").get(f.requester_id);
            return user ? formatFriend(user, f, myId) : null;
        }).filter(Boolean);
        return { results, total: results.length };
    });
    // Outgoing friend requests
    app.get("/profile/friends/requests/sent", { preHandler: auth_1.requireAuth }, async (req) => {
        const myId = req.userId;
        const friendships = db_1.db.prepare("SELECT * FROM friendships WHERE requester_id = ? AND status = 'pending'").all(myId);
        const results = friendships.map((f) => {
            const user = db_1.db.prepare("SELECT * FROM users WHERE id = ?").get(f.addressee_id);
            return user ? formatFriend(user, f, myId) : null;
        }).filter(Boolean);
        return { results, total: results.length };
    });
    // Accept friend request
    app.put("/profile/friends/requests/:id/accept", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const myId = req.userId;
        const f = db_1.db.prepare("SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = 'pending'").get(req.params.id, myId);
        if (!f)
            return reply.code(404).send({ error: "not found" });
        db_1.db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(req.params.id);
        return {};
    });
    // Refuse/remove friend
    app.delete("/profile/friends/:id", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const myId = req.userId;
        const f = db_1.db.prepare("SELECT id FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?)").get(req.params.id, myId, myId);
        if (!f)
            return reply.code(404).send({ error: "not found" });
        db_1.db.prepare("DELETE FROM friendships WHERE id = ?").run(req.params.id);
        return {};
    });
    // Friend request count for notifications
    app.get("/profile/notifications/count", { preHandler: auth_1.requireAuth }, async (req) => {
        const myId = req.userId;
        const count = db_1.db.prepare("SELECT COUNT(*) as c FROM friendships WHERE addressee_id = ? AND status = 'pending'").get(myId).c;
        return { count };
    });
}
