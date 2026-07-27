"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gamesRoutes = gamesRoutes;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../db");
const auth_1 = require("./auth");
const STEAM_ACHIEVEMENTS = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/";
function getAnyApiKey() {
    const row = db_1.db.prepare("SELECT steam_api_key FROM users WHERE steam_api_key IS NOT NULL AND steam_api_key != '' LIMIT 1").get();
    return row?.steam_api_key ?? null;
}
async function gamesRoutes(app) {
    app.get("/games/:shop/:objectId/achievements", async (req) => {
        const { shop, objectId } = req.params;
        if (shop !== "steam")
            return [];
        const apiKey = getAnyApiKey();
        if (!apiKey)
            return [];
        const res = await axios_1.default.get(STEAM_ACHIEVEMENTS, {
            params: { key: apiKey, appid: objectId, l: "english" },
            timeout: 8000,
        }).catch(() => null);
        const achievements = res?.data?.game?.availableGameStats?.achievements ?? [];
        return achievements.map((a) => ({
            name: a.name,
            displayName: a.displayName,
            description: a.description ?? "",
            icon: a.icon,
            icongray: a.icongray,
        }));
    });
    app.get("/games/:shop/:objectId/stats", { preHandler: auth_1.requireAuth }, async (req) => {
        const { userId } = req;
        const { shop, objectId } = req.params;
        const row = db_1.db.prepare("SELECT play_time_in_seconds, last_time_played FROM games WHERE user_id = ? AND object_id = ? AND shop = ?").get(userId, objectId, shop);
        const totalPlayers = db_1.db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM games WHERE object_id = ? AND shop = ?").get(objectId, shop).c;
        return {
            totalPlayTime: row?.play_time_in_seconds ?? 0,
            lastTimePlayed: row?.last_time_played ?? null,
            totalPlayers,
        };
    });
    app.get("/games/:shop/:objectId", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        // Proxy to official Hydra API for game details
        try {
            const apiUrl = process.env.OFFICIAL_API_URL ?? "https://api.hydralauncher.com.br";
            const res = await axios_1.default.get(`${apiUrl}/games/${req.params.shop}/${req.params.objectId}`, { timeout: 10000 });
            return res.data;
        }
        catch {
            return reply.code(404).send({ error: "not found" });
        }
    });
    app.post("/download-sources/changes", { preHandler: auth_1.requireAuth }, async (req) => {
        // Return empty changes — self-hosted users control sources manually
        return [];
    });
}
