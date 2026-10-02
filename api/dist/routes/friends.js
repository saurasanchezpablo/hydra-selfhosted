"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.friendsRoutes = friendsRoutes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../db");
const auth_1 = require("./auth");
// A session is considered live while the launcher has reported it recently.
const ACTIVE_SESSION_WINDOW_SECONDS = 360;
const USER_COLUMNS = "id, username, display_name, profile_image_url, background_image_url";
function imgUrl(req, filePath) {
    if (!filePath)
        return null;
    const host = req.headers.host ?? "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    return `${proto}://${host}/images/${node_path_1.default.basename(filePath)}`;
}
function getCurrentGame(userId) {
    const nowTs = Math.floor(Date.now() / 1000);
    const activeGame = db_1.db
        .prepare(`SELECT title, shop, object_id, session_started_at, last_time_played
       FROM games
       WHERE user_id = ? AND is_deleted = 0 AND is_hidden_from_others = 0
         AND session_started_at IS NOT NULL AND last_time_played >= ?
       ORDER BY last_time_played DESC LIMIT 1`)
        .get(userId, nowTs - ACTIVE_SESSION_WINDOW_SECONDS);
    if (!activeGame?.session_started_at)
        return null;
    const isSteam = activeGame.shop === "steam";
    const appId = activeGame.object_id;
    return {
        title: activeGame.title,
        shop: activeGame.shop,
        objectId: activeGame.object_id,
        iconUrl: null,
        libraryHeroImageUrl: isSteam
            ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`
            : null,
        libraryImageUrl: isSteam
            ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
            : null,
        logoImageUrl: null,
        coverImageUrl: isSteam
            ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`
            : null,
        logoPosition: null,
        sessionDurationInSeconds: nowTs - activeGame.session_started_at,
    };
}
/** The launcher's UserFriend shape. */
function formatUserFriend(user, req) {
    const currentGame = getCurrentGame(user.id);
    return {
        id: user.id,
        displayName: user.display_name || user.username,
        profileImageUrl: imgUrl(req, user.profile_image_url),
        backgroundImageUrl: imgUrl(req, user.background_image_url),
        currentGame,
        isOnline: currentGame !== null,
    };
}
async function friendsRoutes(app) {
    // The launcher identifies the other party by USER id, never by friendship id.
    const findFriendship = (myId, otherUserId) => db_1.db
        .prepare(`SELECT * FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?)`)
        .get(myId, otherUserId, otherUserId, myId);
    const getUser = (userId) => db_1.db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(userId);
    // GET /profile/friends -> ProfileFriends
    app.get("/profile/friends", { preHandler: auth_1.requireAuth }, async (req) => {
        const myId = req.userId;
        const take = parseInt(req.query.take ?? "24", 10);
        const skip = parseInt(req.query.skip ?? "0", 10);
        const friendships = db_1.db
            .prepare(`SELECT * FROM friendships
           WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
           ORDER BY created_at DESC`)
            .all(myId, myId);
        const friends = friendships
            .map((friendship) => {
            const otherId = friendship.requester_id === myId
                ? friendship.addressee_id
                : friendship.requester_id;
            const user = getUser(otherId);
            return user ? formatUserFriend(user, req) : null;
        })
            .filter((friend) => friend !== null);
        return {
            totalFriends: friends.length,
            onlineFriends: friends.filter((friend) => friend.isOnline).length,
            friends: friends.slice(skip, skip + take),
        };
    });
    // GET /profile/friends/search -> { friends: UserFriend[] }
    app.get("/profile/friends/search", { preHandler: auth_1.requireAuth }, async (req) => {
        const myId = req.userId;
        const query = (req.query.query ?? "").trim();
        if (!query)
            return { friends: [] };
        const take = parseInt(req.query.take ?? "24", 10);
        const skip = parseInt(req.query.skip ?? "0", 10);
        const like = `%${query}%`;
        const users = db_1.db
            .prepare(`SELECT ${USER_COLUMNS} FROM users
           WHERE id != ? AND is_banned = 0
             AND (username LIKE ? OR display_name LIKE ? OR id = ?)
           ORDER BY username LIMIT ? OFFSET ?`)
            .all(myId, like, like, query, take, skip);
        return { friends: users.map((user) => formatUserFriend(user, req)) };
    });
    // GET /profile/friend-requests -> FriendRequest[]
    // `id` is the other user's id, because that is what the launcher sends back
    // when accepting, refusing or cancelling.
    app.get("/profile/friend-requests", { preHandler: auth_1.requireAuth }, async (req) => {
        const myId = req.userId;
        const friendships = db_1.db
            .prepare(`SELECT * FROM friendships
           WHERE (requester_id = ? OR addressee_id = ?) AND status = 'pending'
           ORDER BY created_at DESC`)
            .all(myId, myId);
        return friendships
            .map((friendship) => {
            const isSent = friendship.requester_id === myId;
            const otherId = isSent
                ? friendship.addressee_id
                : friendship.requester_id;
            const user = getUser(otherId);
            if (!user)
                return null;
            return {
                id: user.id,
                displayName: user.display_name || user.username,
                profileImageUrl: imgUrl(req, user.profile_image_url),
                type: isSent ? "SENT" : "RECEIVED",
            };
        })
            .filter(Boolean);
    });
    // POST /profile/friend-requests { friendCode }
    // friendCode is a user id or a username, whichever the user typed.
    app.post("/profile/friend-requests", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const myId = req.userId;
        const identifier = (req.body?.friendCode ?? req.body?.userId ?? "").trim();
        if (!identifier) {
            return reply.code(400).send({ message: "friend-code/required" });
        }
        const target = db_1.db
            .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE (id = ? OR username = ?) AND is_banned = 0`)
            .get(identifier, identifier);
        if (!target)
            return reply.code(404).send({ message: "user/not-found" });
        if (target.id === myId) {
            return reply.code(400).send({ message: "friend-request/self" });
        }
        const existing = findFriendship(myId, target.id);
        if (existing) {
            // Accepting from the other side is the natural reading of sending a
            // request to someone who already sent you one.
            if (existing.status === "pending" && existing.addressee_id === myId) {
                db_1.db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(existing.id);
                return { id: target.id, status: "ACCEPTED" };
            }
            return reply.code(409).send({ message: "friend-request/already-exists" });
        }
        db_1.db.prepare("INSERT INTO friendships (id, requester_id, addressee_id, status) VALUES (?, ?, ?, 'pending')").run(node_crypto_1.default.randomUUID(), myId, target.id);
        return { id: target.id, status: "PENDING" };
    });
    // PATCH /profile/friend-requests/:userId { requestState: ACCEPTED | REFUSED }
    app.patch("/profile/friend-requests/:userId", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const myId = req.userId;
        const friendship = findFriendship(myId, req.params.userId);
        if (!friendship || friendship.status !== "pending") {
            return reply.code(404).send({ message: "friend-request/not-found" });
        }
        // Only the addressee may answer a request.
        if (friendship.addressee_id !== myId) {
            return reply.code(403).send({ message: "friend-request/not-addressee" });
        }
        if (req.body?.requestState === "ACCEPTED") {
            db_1.db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(friendship.id);
            return { id: req.params.userId, status: "ACCEPTED" };
        }
        if (req.body?.requestState === "REFUSED") {
            db_1.db.prepare("DELETE FROM friendships WHERE id = ?").run(friendship.id);
            return { id: req.params.userId, status: "REFUSED" };
        }
        return reply.code(400).send({ message: "friend-request/invalid-state" });
    });
    // DELETE /profile/friend-requests/:userId
    // Cancels a sent request, or removes an existing friendship.
    app.delete("/profile/friend-requests/:userId", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const myId = req.userId;
        const friendship = findFriendship(myId, req.params.userId);
        if (!friendship) {
            return reply.code(404).send({ message: "friend-request/not-found" });
        }
        db_1.db.prepare("DELETE FROM friendships WHERE id = ?").run(friendship.id);
        return {};
    });
    // Friend request count for notifications
    app.get("/profile/notifications/count", { preHandler: auth_1.requireAuth }, async (req) => {
        const myId = req.userId;
        const count = db_1.db
            .prepare("SELECT COUNT(*) as c FROM friendships WHERE addressee_id = ? AND status = 'pending'")
            .get(myId).c;
        return { count };
    });
}
