"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileRoutes = profileRoutes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
const auth_1 = require("./auth");
function imgUrl(req, filePath) {
    if (!filePath)
        return null;
    const filename = require("node:path").basename(filePath);
    const host = req.headers.host ?? "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    return `${proto}://${host}/images/${filename}`;
}
function formatUser(u, req) {
    return {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        profileImageUrl: req ? imgUrl(req, u.profile_image_url) : u.profile_image_url,
        backgroundImageUrl: req ? imgUrl(req, u.background_image_url) : u.background_image_url,
        bio: u.bio,
        email: null,
        profileVisibility: "PUBLIC",
        karma: 0,
        subscription: {
            id: "self-hosted",
            status: "active",
            plan: { id: "self-hosted", name: "Self-Hosted" },
            expiresAt: "2099-12-31T23:59:59.000Z",
            paymentMethod: "paypal",
        },
        quirks: { backupsPerGameLimit: 999 },
    };
}
function formatGame(g) {
    const isSteam = g.shop === "steam";
    const appId = g.object_id;
    return {
        id: g.id,
        objectId: g.object_id,
        shop: g.shop,
        title: g.title,
        playTimeInMilliseconds: g.play_time_in_seconds * 1000,
        lastTimePlayed: g.last_time_played ? new Date(g.last_time_played * 1000) : null,
        unlockedAchievementCount: 0,
        achievementCount: 0,
        achievementsPointsEarnedSum: 0,
        isFavorite: Boolean(g.is_favorite),
        isPinned: Boolean(g.is_pinned),
        collectionIds: JSON.parse(g.collection_ids || "[]"),
        hasManuallyUpdatedPlaytime: false,
        iconUrl: null,
        libraryHeroImageUrl: isSteam ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg` : null,
        logoImageUrl: null,
        coverImageUrl: isSteam ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg` : null,
        libraryImageUrl: isSteam ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` : null,
        logoPosition: null,
        downloadSources: [],
        platform: null,
        createdAt: null,
        executablePath: g.executable_path ?? null,
        pinnedDate: g.pinned_at ? new Date(g.pinned_at * 1000) : null,
    };
}
async function profileRoutes(app) {
    app.get("/profile/me", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const user = db_1.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
        if (!user)
            return req.server.httpErrors?.notFound();
        return formatUser(user, req);
    });
    app.patch("/profile", { preHandler: auth_1.requireAuth }, async (req, _reply) => {
        const userId = req.userId;
        const { displayName, bio, profileImageUrl, backgroundImageUrl } = req.body;
        if (displayName !== undefined)
            db_1.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
        if (bio !== undefined)
            db_1.db.prepare("UPDATE users SET bio = ? WHERE id = ?").run(bio, userId);
        if (profileImageUrl !== undefined)
            db_1.db.prepare("UPDATE users SET profile_image_url = ? WHERE id = ?").run(profileImageUrl, userId);
        if (backgroundImageUrl !== undefined)
            db_1.db.prepare("UPDATE users SET background_image_url = ? WHERE id = ?").run(backgroundImageUrl, userId);
        const user = db_1.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
        return formatUser(user, req);
    });
    app.post("/profile/games/batch", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const games = req.body;
        const upsert = db_1.db.prepare(`
        INSERT INTO games (id, user_id, object_id, shop, title, play_time_in_seconds, last_time_played, is_favorite, is_pinned)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, object_id, shop) DO UPDATE SET
          title = COALESCE(excluded.title, title),
          play_time_in_seconds = excluded.play_time_in_seconds,
          last_time_played = excluded.last_time_played,
          is_favorite = excluded.is_favorite,
          is_pinned = excluded.is_pinned,
          is_deleted = 0
      `);
        const tx = db_1.db.transaction((items) => {
            for (const g of items) {
                upsert.run(node_crypto_1.default.randomUUID(), userId, g.objectId, g.shop, g.title ?? g.objectId, Math.floor((g.playTimeInMilliseconds ?? 0) / 1000), g.lastTimePlayed ? Math.floor(new Date(g.lastTimePlayed).getTime() / 1000) : null, g.isFavorite ? 1 : 0, g.isPinned ? 1 : 0);
            }
        });
        tx(games);
        const saved = db_1.db
            .prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0")
            .all(userId);
        return saved.map(formatGame);
    });
    // Single game create (used when adding individual game)
    app.post("/profile/games", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const g = req.body;
        const id = node_crypto_1.default.randomUUID();
        const now = Math.floor(Date.now() / 1000);
        // createGame is called when a game session opens, so start a session
        const sessionStartedAt = now;
        db_1.db.prepare(`
        INSERT INTO games (id, user_id, object_id, shop, title, play_time_in_seconds, last_time_played, is_favorite, is_pinned, session_started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
        ON CONFLICT(user_id, object_id, shop) DO UPDATE SET
          title = COALESCE(excluded.title, title),
          play_time_in_seconds = excluded.play_time_in_seconds,
          last_time_played = excluded.last_time_played,
          session_started_at = excluded.session_started_at,
          is_deleted = 0
      `).run(id, userId, g.objectId, g.shop, g.title ?? g.objectId, Math.floor((g.playTimeInMilliseconds ?? 0) / 1000), g.lastTimePlayed ? Math.floor(new Date(g.lastTimePlayed).getTime() / 1000) : now, sessionStartedAt);
        const game = db_1.db.prepare("SELECT * FROM games WHERE user_id = ? AND object_id = ? AND shop = ?")
            .get(userId, g.objectId, g.shop);
        return formatGame(game);
    });
    app.get("/profile/games", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const skip = parseInt(req.query.skip ?? "0", 10);
        const take = parseInt(req.query.take ?? "30", 10);
        const games = db_1.db
            .prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0 LIMIT ? OFFSET ?")
            .all(userId, take, skip);
        return games.map(formatGame);
    });
    app.put("/profile/games/:shop/:objectId", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { shop, objectId } = req.params;
        const { playTimeInSeconds, playTimeDeltaInSeconds, lastTimePlayed, title, executablePath } = req.body;
        const existing = db_1.db
            .prepare("SELECT id, play_time_in_seconds, last_time_played, session_started_at FROM games WHERE user_id = ? AND object_id = ? AND shop = ?")
            .get(userId, objectId, shop);
        const lastTimePlayedTs = lastTimePlayed ? Math.floor(new Date(lastTimePlayed).getTime() / 1000) : null;
        const now = Math.floor(Date.now() / 1000);
        const SESSION_TIMEOUT = 360;
        if (!existing) {
            const id = node_crypto_1.default.randomUUID();
            const initialPlayTime = playTimeInSeconds ?? (playTimeDeltaInSeconds ?? 0);
            // Any playtime update while creating = session is starting now
            const sessionStartedAt = playTimeDeltaInSeconds !== undefined ? now : null;
            db_1.db.prepare("INSERT INTO games (id, user_id, object_id, shop, title, play_time_in_seconds, last_time_played, session_started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, userId, objectId, shop, title ?? objectId, initialPlayTime, lastTimePlayedTs, sessionStartedAt);
        }
        else {
            if (playTimeInSeconds !== undefined) {
                db_1.db.prepare("UPDATE games SET play_time_in_seconds = ?, last_time_played = ? WHERE user_id = ? AND object_id = ? AND shop = ?").run(playTimeInSeconds, lastTimePlayedTs, userId, objectId, shop);
            }
            else if (playTimeDeltaInSeconds !== undefined) {
                // Detect session start: previous last_time_played is old or null
                const prevLastPlayed = existing.last_time_played;
                const isNewSession = !prevLastPlayed || (now - prevLastPlayed) > SESSION_TIMEOUT;
                const sessionStartedAt = isNewSession ? now : existing.session_started_at;
                db_1.db.prepare("UPDATE games SET play_time_in_seconds = play_time_in_seconds + ?, last_time_played = ?, session_started_at = ? WHERE user_id = ? AND object_id = ? AND shop = ?").run(playTimeDeltaInSeconds, lastTimePlayedTs ?? now, sessionStartedAt, userId, objectId, shop);
            }
            if (executablePath !== undefined)
                db_1.db.prepare("UPDATE games SET executable_path = ? WHERE user_id = ? AND object_id = ? AND shop = ?").run(executablePath, userId, objectId, shop);
        }
        return {};
    });
    app.put("/profile/games/:shop/:objectId/playtime", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { shop, objectId } = req.params;
        db_1.db.prepare("UPDATE games SET play_time_in_seconds = ? WHERE user_id = ? AND object_id = ? AND shop = ?").run(req.body.playTimeInSeconds, userId, objectId, shop);
        return {};
    });
    app.put("/profile/games/:shop/:objectId/pin", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { shop, objectId } = req.params;
        const now = Math.floor(Date.now() / 1000);
        db_1.db.prepare("UPDATE games SET is_pinned = 1, pinned_at = ? WHERE user_id = ? AND object_id = ? AND shop = ?")
            .run(now, userId, objectId, shop);
        const g = db_1.db.prepare("SELECT * FROM games WHERE user_id = ? AND object_id = ? AND shop = ?").get(userId, objectId, shop);
        return formatGame(g);
    });
    app.put("/profile/games/:shop/:objectId/unpin", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { shop, objectId } = req.params;
        db_1.db.prepare("UPDATE games SET is_pinned = 0, pinned_at = NULL WHERE user_id = ? AND object_id = ? AND shop = ?")
            .run(userId, objectId, shop);
        return {};
    });
    app.put("/profile/games/:shop/:objectId/favorite", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        db_1.db.prepare("UPDATE games SET is_favorite = 1 WHERE user_id = ? AND object_id = ? AND shop = ?").run(userId, req.params.objectId, req.params.shop);
        return {};
    });
    app.put("/profile/games/:shop/:objectId/unfavorite", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        db_1.db.prepare("UPDATE games SET is_favorite = 0 WHERE user_id = ? AND object_id = ? AND shop = ?").run(userId, req.params.objectId, req.params.shop);
        return {};
    });
    app.put("/profile/games/:shop/:objectId/collection", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        db_1.db.prepare("UPDATE games SET collection_ids = ? WHERE user_id = ? AND object_id = ? AND shop = ?").run(JSON.stringify(req.body.collectionIds), userId, req.params.objectId, req.params.shop);
        return {};
    });
    app.get("/profile/games/collections", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const rows = db_1.db
            .prepare("SELECT id, name FROM collections WHERE user_id = ? ORDER BY position ASC, created_at ASC")
            .all(userId);
        return rows.map((row) => {
            const gamesCount = db_1.db
                .prepare("SELECT COUNT(*) as cnt FROM games WHERE user_id = ? AND is_deleted = 0 AND json_array_length(collection_ids) > 0 AND EXISTS (SELECT 1 FROM json_each(collection_ids) WHERE value = ?)")
                .get(userId, row.id).cnt;
            return { id: row.id, name: row.name, gamesCount };
        });
    });
    app.post("/profile/games/collections", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const userId = req.userId;
        const { name } = req.body;
        if (!name?.trim()) {
            return reply.code(400).send({ error: "name required" });
        }
        const existing = db_1.db
            .prepare("SELECT id FROM collections WHERE user_id = ? AND name = ?")
            .get(userId, name.trim());
        if (existing) {
            return reply.code(409).send({ error: "collection-name-already-in-use" });
        }
        const id = node_crypto_1.default.randomUUID();
        const position = db_1.db
            .prepare("SELECT COALESCE(MAX(position) + 1, 0) as next FROM collections WHERE user_id = ?")
            .get(userId).next;
        db_1.db.prepare("INSERT INTO collections (id, user_id, name, position) VALUES (?, ?, ?, ?)").run(id, userId, name.trim(), position);
        return { id, name: name.trim(), gamesCount: 0 };
    });
    app.delete("/profile/games/collections/:collectionId", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { collectionId } = req.params;
        db_1.db.prepare("DELETE FROM collections WHERE id = ? AND user_id = ?").run(collectionId, userId);
        // Remove this collection from all games that had it
        const games = db_1.db
            .prepare("SELECT id, collection_ids FROM games WHERE user_id = ? AND collection_ids != '[]'")
            .all(userId);
        const update = db_1.db.prepare("UPDATE games SET collection_ids = ? WHERE id = ?");
        const tx = db_1.db.transaction(() => {
            for (const g of games) {
                const ids = JSON.parse(g.collection_ids || "[]");
                const updated = ids.filter((id) => id !== collectionId);
                if (updated.length !== ids.length) {
                    update.run(JSON.stringify(updated), g.id);
                }
            }
        });
        tx();
        return {};
    });
    app.delete("/profile/games/:remoteId", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        db_1.db.prepare("UPDATE games SET is_deleted = 1 WHERE id = ? AND user_id = ?").run(req.params.remoteId, userId);
        return {};
    });
    app.put("/profile/games/achievements", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { id: remoteId, achievements } = req.body;
        const game = db_1.db.prepare("SELECT * FROM games WHERE id = ? AND user_id = ?").get(remoteId, userId);
        if (!game)
            return {};
        const upsert = db_1.db.prepare(`
        INSERT INTO achievements (id, user_id, object_id, shop, achievement_id, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, object_id, shop, achievement_id) DO NOTHING
      `);
        const tx = db_1.db.transaction((items) => {
            for (const a of items) {
                upsert.run(node_crypto_1.default.randomUUID(), userId, game.object_id, game.shop, a.name, a.unlockTime ?? Math.floor(Date.now() / 1000));
            }
        });
        tx(achievements ?? []);
        const count = db_1.db.prepare("SELECT COUNT(*) as cnt FROM achievements WHERE user_id = ? AND object_id = ? AND shop = ?")
            .get(userId, game.object_id, game.shop)?.cnt ?? 0;
        void count;
        return {
            objectId: game.object_id,
            shop: game.shop,
            achievements: (achievements ?? []).map((a) => ({
                name: a.name,
                unlockTime: a.unlockTime,
                unlocked: true,
            })),
        };
    });
    app.put("/profile/games/:shop/:objectId/achievements", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        const { shop, objectId } = req.params;
        const upsert = db_1.db.prepare(`
        INSERT INTO achievements (id, user_id, object_id, shop, achievement_id, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, object_id, shop, achievement_id) DO NOTHING
      `);
        const tx = db_1.db.transaction((items) => {
            for (const a of items) {
                upsert.run(node_crypto_1.default.randomUUID(), userId, objectId, shop, a.name, Math.floor(new Date(a.unlockedAt).getTime() / 1000));
            }
        });
        tx(req.body);
        return {};
    });
    app.delete("/profile/games/achievements/:remoteId", { preHandler: auth_1.requireAuth }, async (req) => {
        const userId = req.userId;
        db_1.db.prepare("DELETE FROM achievements WHERE id = ? AND user_id = ?").run(req.params.remoteId, userId);
        return {};
    });
    // Public user profile endpoints
    app.get("/users/:userId", async (req, rep) => {
        const user = db_1.db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId);
        if (!user)
            return rep.code(404).send({ message: "Not found" });
        const stats = db_1.db.prepare(`
        SELECT COUNT(*) as cnt, SUM(play_time_in_seconds) as total_play
        FROM games WHERE user_id = ? AND is_deleted = 0
      `).get(req.params.userId);
        const recentGames = db_1.db.prepare(`
        SELECT * FROM games WHERE user_id = ? AND is_deleted = 0
        ORDER BY last_time_played DESC LIMIT 5
      `).all(req.params.userId).map(formatGame);
        const SESSION_TIMEOUT_SECONDS = 360;
        const nowTs = Math.floor(Date.now() / 1000);
        // Try Steam API first if user has steam_id configured
        let currentGame = null;
        if (user.steam_id && user.steam_api_key) {
            try {
                const steamRes = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(user.steam_api_key)}&steamids=${encodeURIComponent(user.steam_id)}`, { signal: AbortSignal.timeout(3000) });
                if (steamRes.ok) {
                    const steamData = await steamRes.json();
                    const player = steamData?.response?.players?.[0];
                    if (player?.gameextrainfo && player?.gameid) {
                        const steamObjectId = String(player.gameid);
                        const dbGame = db_1.db.prepare("SELECT * FROM games WHERE user_id = ? AND object_id = ? AND shop = 'steam' AND is_deleted = 0").get(req.params.userId, steamObjectId);
                        const sessionStartedAt = dbGame?.session_started_at ?? nowTs;
                        currentGame = {
                            id: dbGame?.id ?? steamObjectId,
                            objectId: steamObjectId,
                            shop: "steam",
                            title: player.gameextrainfo,
                            iconUrl: null,
                            libraryHeroImageUrl: null,
                            coverImageUrl: null,
                            backgroundImageUrl: null,
                            sessionDurationInMillis: (nowTs - sessionStartedAt) * 1000,
                            sessionDurationInSeconds: nowTs - sessionStartedAt,
                        };
                    }
                }
            }
            catch { }
        }
        // Fallback: DB session tracking (any shop, client ticks every 3 min → 6 min timeout)
        if (!currentGame) {
            const activeGame = db_1.db.prepare(`
          SELECT * FROM games WHERE user_id = ? AND is_deleted = 0
          AND session_started_at IS NOT NULL AND last_time_played >= ?
          ORDER BY last_time_played DESC LIMIT 1
        `).get(req.params.userId, nowTs - SESSION_TIMEOUT_SECONDS);
            if (activeGame) {
                currentGame = {
                    id: activeGame.id,
                    objectId: activeGame.object_id,
                    shop: activeGame.shop,
                    title: activeGame.title,
                    iconUrl: null,
                    libraryHeroImageUrl: null,
                    coverImageUrl: null,
                    backgroundImageUrl: null,
                    sessionDurationInMillis: (nowTs - activeGame.session_started_at) * 1000,
                    sessionDurationInSeconds: nowTs - activeGame.session_started_at,
                };
            }
        }
        return {
            ...formatUser(user, req),
            totalPlayTimeInSeconds: Math.floor((stats?.total_play ?? 0)),
            libraryCount: stats?.cnt ?? 0,
            friendsCount: 0,
            friends: [],
            badges: [],
            recentGames,
            libraryGames: recentGames,
            totalFriends: 0,
            relation: null,
            currentGame,
            hasActiveSubscription: true,
            hasCompletedWrapped2025: false,
        };
    });
    app.get("/users/:userId/stats", async (req) => {
        const stats = db_1.db.prepare(`
        SELECT COUNT(*) as cnt, SUM(play_time_in_seconds) as total_play, 0 as achievement_count
        FROM games WHERE user_id = ? AND is_deleted = 0
      `).get(req.params.userId);
        const achievements = db_1.db.prepare(`
        SELECT COUNT(*) as cnt FROM achievements WHERE user_id = ?
      `).get(req.params.userId);
        return {
            totalPlayTimeInSeconds: { value: Math.floor(stats?.total_play ?? 0), topPercentile: 100 },
            libraryCount: stats?.cnt ?? 0,
            achievementCount: achievements?.cnt ?? 0,
        };
    });
    app.get("/users/:userId/library", async (req) => {
        const skip = parseInt(req.query.skip ?? "0", 10);
        const take = parseInt(req.query.take ?? "12", 10);
        const sortBy = req.query.sortBy === "playedRecently" ? "last_time_played DESC NULLS LAST" : "title ASC";
        const allGames = db_1.db
            .prepare(`SELECT * FROM games WHERE user_id = ? AND is_deleted = 0 ORDER BY ${sortBy}`)
            .all(req.params.userId);
        const pinned = allGames.filter(g => g.is_pinned).map(formatGame);
        const unpinned = allGames.filter(g => !g.is_pinned);
        const page = unpinned.slice(skip, skip + take).map(formatGame);
        return { library: page, pinnedGames: skip === 0 ? pinned : [], total: allGames.length };
    });
    app.get("/users/:userId/reviews", async (req) => {
        const take = parseInt(req.query.take ?? "20");
        const skip = parseInt(req.query.skip ?? "0");
        const rows = db_1.db.prepare("SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(req.params.userId, take, skip);
        const total = db_1.db.prepare("SELECT COUNT(*) as c FROM reviews WHERE user_id = ?").get(req.params.userId).c;
        const currentUserId = req.user?.id ?? null;
        const results = rows.map(r => {
            const user = db_1.db.prepare("SELECT id, display_name, profile_image_url FROM users WHERE id = ?").get(r.user_id);
            const answerCount = db_1.db.prepare("SELECT COUNT(*) as c FROM review_answers WHERE review_id = ?").get(r.id).c;
            const userVote = currentUserId ? db_1.db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(currentUserId, r.id) : null;
            const game = db_1.db.prepare("SELECT title FROM games WHERE user_id = ? AND object_id = ? AND shop = ?").get(r.user_id, r.object_id, r.shop);
            return {
                id: r.id, reviewHtml: r.review_html, score: r.score,
                createdAt: new Date(r.created_at * 1000).toISOString(),
                updatedAt: new Date(r.updated_at * 1000).toISOString(),
                upvotes: r.upvotes, downvotes: r.downvotes, answerCount, answers: [],
                isBlocked: false,
                hasUpvoted: userVote?.vote_type === "upvote",
                hasDownvoted: userVote?.vote_type === "downvote",
                user: { id: user?.id ?? r.user_id, displayName: user?.display_name ?? "", profileImageUrl: user?.profile_image_url ?? null },
                translations: {}, detectedLanguage: null,
                game: { title: game?.title ?? r.object_id, objectId: r.object_id, shop: r.shop },
            };
        });
        return { reviews: results, totalCount: total };
    });
    app.get("/profile/blocks", { preHandler: auth_1.requireAuth }, async (req) => {
        const { userId } = req;
        const take = parseInt(req.query.take ?? "20");
        const skip = parseInt(req.query.skip ?? "0");
        const rows = db_1.db.prepare("SELECT blocked_user_id FROM blocks WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(userId, take, skip);
        const total = db_1.db.prepare("SELECT COUNT(*) as c FROM blocks WHERE user_id = ?").get(userId).c;
        const users = rows.map((r) => {
            const u = db_1.db.prepare("SELECT id, display_name, profile_image_url FROM users WHERE id = ?").get(r.blocked_user_id);
            return u ? { id: u.id, displayName: u.display_name, profileImageUrl: u.profile_image_url } : null;
        }).filter(Boolean);
        return { results: users, total };
    });
    app.get("/features", async () => {
        return ["badges", "blocks", "notifications"];
    });
    app.get("/badges", async (req) => {
        const targetUserId = req.query.userId ?? null;
        const rows = targetUserId
            ? db_1.db.prepare("SELECT * FROM badges WHERE user_id = ? ORDER BY unlocked_at DESC").all(targetUserId)
            : db_1.db.prepare("SELECT * FROM badges ORDER BY unlocked_at DESC").all();
        return rows.map(r => ({
            id: r.id,
            name: r.badge_type,
            displayName: r.badge_type,
            description: r.badge_data ?? "",
            icon: null,
            userId: r.user_id,
            unlockedAt: new Date(r.unlocked_at * 1000).toISOString(),
        }));
    });
    app.get("/profile/notifications", { preHandler: auth_1.requireAuth }, async (req) => {
        const { userId } = req;
        const take = parseInt(req.query.take ?? "20");
        const skip = parseInt(req.query.skip ?? "0");
        const total = db_1.db.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id = ?").get(userId).c;
        const rows = db_1.db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(userId, take, skip);
        return {
            notifications: rows.map(r => ({
                id: r.id,
                type: r.type,
                title: r.title,
                body: r.body,
                data: r.data ? JSON.parse(r.data) : null,
                isRead: !!r.is_read,
                createdAt: new Date(r.created_at * 1000).toISOString(),
            })),
            pagination: { total, take, skip, hasMore: skip + take < total },
        };
    });
    app.put("/profile/notifications/:id/read", { preHandler: auth_1.requireAuth }, async (req) => {
        const { userId } = req;
        db_1.db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(req.params.id, userId);
        return {};
    });
    app.delete("/profile/notifications/:id", { preHandler: auth_1.requireAuth }, async (req) => {
        const { userId } = req;
        db_1.db.prepare("DELETE FROM notifications WHERE id = ? AND user_id = ?").run(req.params.id, userId);
        return {};
    });
    app.put("/profile/notifications/all/read", { preHandler: auth_1.requireAuth }, async (req) => {
        const { userId } = req;
        db_1.db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(userId);
        return {};
    });
    app.delete("/profile/notifications/all", { preHandler: auth_1.requireAuth }, async (req) => {
        const { userId } = req;
        db_1.db.prepare("DELETE FROM notifications WHERE user_id = ?").run(userId);
        return {};
    });
}
