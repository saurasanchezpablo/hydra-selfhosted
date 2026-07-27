"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSteamSyncScheduler = exports.syncSteamGames = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("./db");
const syncSteamGames = async (userId) => {
    const user = db_1.db
        .prepare("SELECT steam_id, steam_api_key FROM users WHERE id = ?")
        .get(userId);
    if (!user?.steam_id || !user?.steam_api_key)
        return;
    const res = await axios_1.default
        .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/", {
        params: {
            key: user.steam_api_key,
            steamid: user.steam_id,
            include_appinfo: true,
            include_played_free_games: true,
        },
        timeout: 10000,
    })
        .catch(() => null);
    if (!res)
        return;
    const games = res.data?.response?.games ?? [];
    const upsert = db_1.db.prepare(`
    INSERT INTO games (id, user_id, object_id, shop, title, play_time_in_seconds, is_deleted, source)
    VALUES (lower(hex(randomblob(16))), ?, ?, 'steam', ?, ?, 0, 'steam_sync')
    ON CONFLICT(user_id, object_id, shop) DO UPDATE SET
      play_time_in_seconds = MAX(play_time_in_seconds, excluded.play_time_in_seconds),
      title = CASE WHEN title = '' THEN excluded.title ELSE title END,
      source = 'steam_sync'
  `);
    const syncMany = db_1.db.transaction((rows) => {
        for (const g of rows) {
            if (!g.name)
                continue;
            upsert.run(userId, String(g.appid), g.name, g.playtime_forever * 60);
        }
    });
    syncMany(games);
};
exports.syncSteamGames = syncSteamGames;
// Sync all users with Steam configured every 30 minutes
const startSteamSyncScheduler = () => {
    const run = async () => {
        const users = db_1.db
            .prepare("SELECT id FROM users WHERE steam_id IS NOT NULL AND steam_api_key IS NOT NULL")
            .all();
        for (const u of users) {
            await (0, exports.syncSteamGames)(u.id).catch(() => { });
        }
    };
    run();
    setInterval(run, 30 * 60 * 1000);
};
exports.startSteamSyncScheduler = startSteamSyncScheduler;
