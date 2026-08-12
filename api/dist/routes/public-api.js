"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicApiRoutes = publicApiRoutes;
const db_1 = require("../db");
function imgUrl(req, filePath) {
    if (!filePath)
        return null;
    const filename = require("node:path").basename(filePath);
    const host = req.headers.host ?? "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    return `${proto}://${host}/images/${filename}`;
}
function formatGame(g) {
    return {
        id: g.id,
        objectId: g.object_id,
        shop: g.shop,
        title: g.title,
        playTimeInMilliseconds: g.play_time_in_seconds * 1000,
        lastTimePlayed: g.last_time_played ? new Date(g.last_time_played * 1000).toISOString() : null,
        isFavorite: Boolean(g.is_favorite),
        isPinned: Boolean(g.is_pinned),
    };
}
async function publicApiRoutes(app) {
    // GET /api - API info
    app.get("/api", async () => {
        return {
            name: "Hydra Self-Hosted API",
            version: "1.0.0",
            docs: "/docs",
            endpoints: {
                public: [
                    "GET /api",
                    "GET /api/users/:username",
                    "GET /api/users/:username/stats",
                    "GET /api/users/:username/library",
                    "GET /api/users/:username/games",
                    "GET /api/games/:shop/:objectId/achievements",
                ],
                authenticated: [
                    "POST /auth/register",
                    "POST /auth/login",
                    "POST /auth/refresh",
                    "GET /profile/me",
                    "PATCH /profile",
                    "POST /profile/games/batch",
                    "GET /profile/games",
                    "PUT /profile/games/:shop/:objectId",
                    "DELETE /profile/games/:remoteId",
                    "PUT /profile/games/:shop/:objectId/pin",
                    "PUT /profile/games/:shop/:objectId/unpin",
                    "PUT /profile/games/:shop/:objectId/favorite",
                    "PUT /profile/games/:shop/:objectId/unfavorite",
                    "PUT /profile/games/achievements",
                    "GET /profile/friends",
                    "POST /profile/friends/requests",
                    "PUT /profile/friends/requests/:id/accept",
                    "DELETE /profile/friends/:id",
                    "GET /users/search",
                    "GET /features",
                    "GET /badges",
                ],
            },
        };
    });
    // GET /api/users/:username - Public user profile
    app.get("/api/users/:username", async (req, reply) => {
        const user = db_1.db.prepare("SELECT * FROM users WHERE username = ?")
            .get(req.params.username);
        if (!user)
            return reply.code(404).send({ error: "User not found" });
        const games = db_1.db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0")
            .all(user.id);
        const totalSeconds = games.reduce((s, g) => s + g.play_time_in_seconds, 0);
        const steamGames = games.filter(g => g.shop === "steam");
        const steamHours = Math.floor(steamGames.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);
        const nowTs = Math.floor(Date.now() / 1000);
        let currentGame = null;
        if (user.steam_id) {
            try {
                const activeGame = db_1.db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0 AND session_started_at IS NOT NULL AND last_time_played >= ? ORDER BY last_time_played DESC LIMIT 1").get(user.id, nowTs - 360);
                if (activeGame) {
                    currentGame = {
                        title: activeGame.title,
                        shop: activeGame.shop,
                        sessionDurationInSeconds: nowTs - activeGame.session_started_at,
                    };
                }
            }
            catch { }
        }
        return reply.send({
            username: user.username,
            displayName: user.display_name,
            bio: user.bio,
            profileImageUrl: imgUrl(req, user.profile_image_url),
            backgroundImageUrl: imgUrl(req, user.background_image_url),
            steamId: user.steam_id ?? undefined,
            accentColor: user.accent_color ?? undefined,
            createdAt: new Date(user.created_at * 1000).toISOString(),
            stats: {
                totalGames: games.length,
                totalHours: Math.floor(totalSeconds / 3600),
                steamHours,
            },
            currentGame,
        });
    });
    // GET /api/users/:username/stats
    app.get("/api/users/:username/stats", async (req, reply) => {
        const user = db_1.db.prepare("SELECT id FROM users WHERE username = ?")
            .get(req.params.username);
        if (!user)
            return reply.code(404).send({ error: "User not found" });
        const stats = db_1.db.prepare(`
      SELECT COUNT(*) as totalGames, SUM(play_time_in_seconds) as totalPlayTime
      FROM games WHERE user_id = ? AND is_deleted = 0
    `).get(user.id);
        const achievements = db_1.db.prepare(`
      SELECT COUNT(*) as count FROM achievements WHERE user_id = ?
    `).get(user.id);
        const byShop = db_1.db.prepare(`
      SELECT shop, COUNT(*) as count, SUM(play_time_in_seconds) as playtime
      FROM games WHERE user_id = ? AND is_deleted = 0 GROUP BY shop
    `).all(user.id);
        return reply.send({
            totalGames: stats?.totalGames ?? 0,
            totalPlayTimeInSeconds: stats?.totalPlayTime ?? 0,
            totalHours: Math.floor((stats?.totalPlayTime ?? 0) / 3600),
            achievements: achievements?.count ?? 0,
            byShop: Object.fromEntries(byShop.map((r) => [r.shop, { games: r.count, playtime: r.playtime }])),
        });
    });
    // GET /api/users/:username/library
    app.get("/api/users/:username/library", async (req, reply) => {
        const user = db_1.db.prepare("SELECT id FROM users WHERE username = ?")
            .get(req.params.username);
        if (!user)
            return reply.code(404).send({ error: "User not found" });
        const skip = parseInt(req.query.skip ?? "0", 10);
        const take = Math.min(parseInt(req.query.take ?? "30", 10), 100);
        const sortBy = req.query.sortBy === "playedRecently" ? "last_time_played DESC NULLS LAST" : "title ASC";
        const shopFilter = req.query.shop && ["steam", "hydra"].includes(req.query.shop) ? req.query.shop : null;
        const query = shopFilter
            ? `SELECT * FROM games WHERE user_id = ? AND is_deleted = 0 AND shop = ? ORDER BY is_pinned DESC, ${sortBy} LIMIT ? OFFSET ?`
            : `SELECT * FROM games WHERE user_id = ? AND is_deleted = 0 ORDER BY is_pinned DESC, ${sortBy} LIMIT ? OFFSET ?`;
        const games = shopFilter
            ? db_1.db.prepare(query).all(user.id, shopFilter, take, skip)
            : db_1.db.prepare(query).all(user.id, take, skip);
        const totalQuery = shopFilter
            ? "SELECT COUNT(*) as c FROM games WHERE user_id = ? AND is_deleted = 0 AND shop = ?"
            : "SELECT COUNT(*) as c FROM games WHERE user_id = ? AND is_deleted = 0";
        const total = (shopFilter
            ? db_1.db.prepare(totalQuery).get(user.id, shopFilter)
            : db_1.db.prepare(totalQuery).get(user.id)).c;
        return reply.send({
            games: games.map(formatGame),
            total,
            skip,
            take,
        });
    });
    // GET /api/users/:username/games - alias for library
    app.get("/api/users/:username/games", async (req, reply) => {
        const user = db_1.db.prepare("SELECT id FROM users WHERE username = ?")
            .get(req.params.username);
        if (!user)
            return reply.code(404).send({ error: "User not found" });
        const skip = parseInt(req.query.skip ?? "0", 10);
        const take = Math.min(parseInt(req.query.take ?? "30", 10), 100);
        const games = db_1.db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0 ORDER BY is_pinned DESC, title ASC LIMIT ? OFFSET ?").all(user.id, take, skip);
        return reply.send(games.map(formatGame));
    });
    // GET /api/games/:shop/:objectId/achievements
    app.get("/api/games/:shop/:objectId/achievements", async (req) => {
        const { shop, objectId } = req.params;
        if (shop !== "steam")
            return [];
        const row = db_1.db.prepare("SELECT steam_api_key FROM users WHERE steam_api_key IS NOT NULL AND steam_api_key != '' LIMIT 1").get();
        if (!row)
            return [];
        try {
            const axios = await Promise.resolve().then(() => __importStar(require("axios")));
            const res = await axios.default.get("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/", {
                params: { key: row.steam_api_key, appid: objectId, l: "english" },
                timeout: 8000,
            });
            const achievements = res?.data?.game?.availableGameStats?.achievements ?? [];
            return achievements.map((a) => ({
                name: a.name,
                displayName: a.displayName,
                description: a.description ?? "",
                icon: a.icon,
                iconGray: a.icongray,
            }));
        }
        catch {
            return [];
        }
    });
    // GET /api/health
    app.get("/api/health", async () => {
        return { status: "ok", timestamp: new Date().toISOString() };
    });
}
