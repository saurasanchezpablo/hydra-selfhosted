import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import { db } from "../db";
import { requireAuth } from "./auth";

type Req = FastifyRequest & { userId: string };

interface DbUser {
  id: string;
  username: string;
  display_name: string;
  profile_image_url: string | null;
  background_image_url: string | null;
  bio: string;
  steam_id: string | null;
  steam_api_key: string | null;
}

interface DbGame {
  id: string;
  user_id: string;
  object_id: string;
  shop: string;
  title: string;
  play_time_in_seconds: number;
  last_time_played: number | null;
  is_favorite: number;
  is_pinned: number;
  is_deleted: number;
  collection_ids: string;
  session_started_at: number | null;
}

function imgUrl(req: any, filePath: string | null): string | null {
  if (!filePath) return null;
  const filename = require("node:path").basename(filePath);
  const host = req.headers.host ?? "localhost:3000";
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${host}/images/${filename}`;
}

function formatUser(u: DbUser, req?: any) {
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

function formatGame(g: DbGame) {
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
    executablePath: (g as any).executable_path ?? null,
    pinnedDate: (g as any).pinned_at ? new Date((g as any).pinned_at * 1000) : null,
  };
}

export async function profileRoutes(app: FastifyInstance) {
  app.get("/profile/me", { preHandler: requireAuth }, async (req: FastifyRequest) => {
    const userId = (req as Req).userId;
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DbUser;
    if (!user) return (req as any).server.httpErrors?.notFound();
    return formatUser(user, req);
  });

  app.patch(
    "/profile",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Body: { displayName?: string; bio?: string; profileVisibility?: string; profileImageUrl?: string | null; backgroundImageUrl?: string | null };
      }>,
      _reply: FastifyReply
    ) => {
      const userId = (req as Req).userId;
      const { displayName, bio, profileImageUrl, backgroundImageUrl } = req.body;
      if (displayName !== undefined)
        db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
      if (bio !== undefined)
        db.prepare("UPDATE users SET bio = ? WHERE id = ?").run(bio, userId);
      if (profileImageUrl !== undefined)
        db.prepare("UPDATE users SET profile_image_url = ? WHERE id = ?").run(profileImageUrl, userId);
      if (backgroundImageUrl !== undefined)
        db.prepare("UPDATE users SET background_image_url = ? WHERE id = ?").run(backgroundImageUrl, userId);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DbUser;
      return formatUser(user, req);
    }
  );

  app.post(
    "/profile/games/batch",
    { preHandler: requireAuth },
    async (req: FastifyRequest) => {
      const userId = (req as Req).userId;
      const games = req.body as Array<{
        objectId: string;
        shop: string;
        title?: string;
        playTimeInMilliseconds?: number;
        lastTimePlayed?: string | null;
        isFavorite?: boolean;
        isPinned?: boolean;
      }>;

      const upsert = db.prepare(`
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

      const tx = db.transaction((items: typeof games) => {
        for (const g of items) {
          upsert.run(
            crypto.randomUUID(),
            userId,
            g.objectId,
            g.shop,
            g.title ?? g.objectId,
            Math.floor((g.playTimeInMilliseconds ?? 0) / 1000),
            g.lastTimePlayed ? Math.floor(new Date(g.lastTimePlayed).getTime() / 1000) : null,
            g.isFavorite ? 1 : 0,
            g.isPinned ? 1 : 0,
          );
        }
      });
      tx(games);

      const saved = db
        .prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0")
        .all(userId) as DbGame[];
      return saved.map(formatGame);
    }
  );

  // Single game create (used when adding individual game)
  app.post(
    "/profile/games",
    { preHandler: requireAuth },
    async (req: FastifyRequest) => {
      const userId = (req as Req).userId;
      const g = req.body as any;
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      // createGame is called when a game session opens, so start a session
      const sessionStartedAt = now;
      db.prepare(`
        INSERT INTO games (id, user_id, object_id, shop, title, play_time_in_seconds, last_time_played, is_favorite, is_pinned, session_started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
        ON CONFLICT(user_id, object_id, shop) DO UPDATE SET
          title = COALESCE(excluded.title, title),
          play_time_in_seconds = excluded.play_time_in_seconds,
          last_time_played = excluded.last_time_played,
          session_started_at = excluded.session_started_at,
          is_deleted = 0
      `).run(
        id, userId, g.objectId, g.shop,
        g.title ?? g.objectId,
        Math.floor((g.playTimeInMilliseconds ?? 0) / 1000),
        g.lastTimePlayed ? Math.floor(new Date(g.lastTimePlayed).getTime() / 1000) : now,
        sessionStartedAt
      );
      const game = db.prepare("SELECT * FROM games WHERE user_id = ? AND object_id = ? AND shop = ?")
        .get(userId, g.objectId, g.shop) as DbGame;
      return formatGame(game);
    }
  );

  app.get(
    "/profile/games",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Querystring: { skip?: string; take?: string } }>) => {
      const userId = (req as Req).userId;
      const skip = parseInt(req.query.skip ?? "0", 10);
      const take = parseInt(req.query.take ?? "30", 10);
      const games = db
        .prepare(
          "SELECT * FROM games WHERE user_id = ? AND is_deleted = 0 LIMIT ? OFFSET ?"
        )
        .all(userId, take, skip) as DbGame[];
      return games.map(formatGame);
    }
  );

  app.put(
    "/profile/games/:shop/:objectId",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Params: { shop: string; objectId: string };
        Body: {
          playTimeInSeconds?: number;
          playTimeDeltaInSeconds?: number;
          lastTimePlayed?: string | null;
          title?: string;
          executablePath?: string | null;
        };
      }>
    ) => {
      const userId = (req as Req).userId;
      const { shop, objectId } = req.params;
      const { playTimeInSeconds, playTimeDeltaInSeconds, lastTimePlayed, title, executablePath } = req.body;

      const existing = db
        .prepare("SELECT id, play_time_in_seconds, last_time_played, session_started_at FROM games WHERE user_id = ? AND object_id = ? AND shop = ?")
        .get(userId, objectId, shop) as { id: string; play_time_in_seconds: number; last_time_played: number | null; session_started_at: number | null } | undefined;

      const lastTimePlayedTs = lastTimePlayed ? Math.floor(new Date(lastTimePlayed).getTime() / 1000) : null;
      const now = Math.floor(Date.now() / 1000);
      const SESSION_TIMEOUT = 360;

      if (!existing) {
        const id = crypto.randomUUID();
        const initialPlayTime = playTimeInSeconds ?? (playTimeDeltaInSeconds ?? 0);
        // Any playtime update while creating = session is starting now
        const sessionStartedAt = playTimeDeltaInSeconds !== undefined ? now : null;
        db.prepare(
          "INSERT INTO games (id, user_id, object_id, shop, title, play_time_in_seconds, last_time_played, session_started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(id, userId, objectId, shop, title ?? objectId, initialPlayTime, lastTimePlayedTs, sessionStartedAt);
      } else {
        if (playTimeInSeconds !== undefined) {
          db.prepare(
            "UPDATE games SET play_time_in_seconds = ?, last_time_played = ? WHERE user_id = ? AND object_id = ? AND shop = ?"
          ).run(playTimeInSeconds, lastTimePlayedTs, userId, objectId, shop);
        } else if (playTimeDeltaInSeconds !== undefined) {
          // Detect session start: previous last_time_played is old or null
          const prevLastPlayed = existing.last_time_played;
          const isNewSession = !prevLastPlayed || (now - prevLastPlayed) > SESSION_TIMEOUT;
          const sessionStartedAt = isNewSession ? now : existing.session_started_at;
          db.prepare(
            "UPDATE games SET play_time_in_seconds = play_time_in_seconds + ?, last_time_played = ?, session_started_at = ? WHERE user_id = ? AND object_id = ? AND shop = ?"
          ).run(playTimeDeltaInSeconds, lastTimePlayedTs ?? now, sessionStartedAt, userId, objectId, shop);
        }
        if (executablePath !== undefined)
          db.prepare(
            "UPDATE games SET executable_path = ? WHERE user_id = ? AND object_id = ? AND shop = ?"
          ).run(executablePath, userId, objectId, shop);
      }
      return {};
    }
  );

  app.put(
    "/profile/games/:shop/:objectId/playtime",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Params: { shop: string; objectId: string };
        Body: { playTimeInSeconds: number };
      }>
    ) => {
      const userId = (req as Req).userId;
      const { shop, objectId } = req.params;
      db.prepare(
        "UPDATE games SET play_time_in_seconds = ? WHERE user_id = ? AND object_id = ? AND shop = ?"
      ).run(req.body.playTimeInSeconds, userId, objectId, shop);
      return {};
    }
  );

  app.put(
    "/profile/games/:shop/:objectId/pin",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>) => {
      const userId = (req as Req).userId;
      const { shop, objectId } = req.params;
      const now = Math.floor(Date.now() / 1000);
      db.prepare("UPDATE games SET is_pinned = 1, pinned_at = ? WHERE user_id = ? AND object_id = ? AND shop = ?")
        .run(now, userId, objectId, shop);
      const g = db.prepare("SELECT * FROM games WHERE user_id = ? AND object_id = ? AND shop = ?").get(userId, objectId, shop) as any;
      return formatGame(g);
    }
  );

  app.put(
    "/profile/games/:shop/:objectId/unpin",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>) => {
      const userId = (req as Req).userId;
      const { shop, objectId } = req.params;
      db.prepare("UPDATE games SET is_pinned = 0, pinned_at = NULL WHERE user_id = ? AND object_id = ? AND shop = ?")
        .run(userId, objectId, shop);
      return {};
    }
  );

  app.put(
    "/profile/games/:shop/:objectId/favorite",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>) => {
      const userId = (req as Req).userId;
      db.prepare(
        "UPDATE games SET is_favorite = 1 WHERE user_id = ? AND object_id = ? AND shop = ?"
      ).run(userId, req.params.objectId, req.params.shop);
      return {};
    }
  );

  app.put(
    "/profile/games/:shop/:objectId/unfavorite",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>) => {
      const userId = (req as Req).userId;
      db.prepare(
        "UPDATE games SET is_favorite = 0 WHERE user_id = ? AND object_id = ? AND shop = ?"
      ).run(userId, req.params.objectId, req.params.shop);
      return {};
    }
  );

  app.put(
    "/profile/games/:shop/:objectId/collection",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Params: { shop: string; objectId: string };
        Body: { collectionIds: string[] };
      }>
    ) => {
      const userId = (req as Req).userId;
      db.prepare(
        "UPDATE games SET collection_ids = ? WHERE user_id = ? AND object_id = ? AND shop = ?"
      ).run(
        JSON.stringify(req.body.collectionIds),
        userId,
        req.params.objectId,
        req.params.shop
      );
      return {};
    }
  );

  app.get("/profile/games/collections", { preHandler: requireAuth }, async (req) => {
    const userId = (req as Req).userId;
    const rows = db
      .prepare("SELECT id, name FROM collections WHERE user_id = ? ORDER BY position ASC, created_at ASC")
      .all(userId) as { id: string; name: string }[];

    return rows.map((row) => {
      const gamesCount = (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM games WHERE user_id = ? AND is_deleted = 0 AND json_array_length(collection_ids) > 0 AND EXISTS (SELECT 1 FROM json_each(collection_ids) WHERE value = ?)"
          )
          .get(userId, row.id) as { cnt: number }
      ).cnt;
      return { id: row.id, name: row.name, gamesCount };
    });
  });

  app.post(
    "/profile/games/collections",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{ Body: { name: string } }>,
      reply
    ) => {
      const userId = (req as Req).userId;
      const { name } = req.body;

      if (!name?.trim()) {
        return reply.code(400).send({ error: "name required" });
      }

      const existing = db
        .prepare("SELECT id FROM collections WHERE user_id = ? AND name = ?")
        .get(userId, name.trim());

      if (existing) {
        return reply.code(409).send({ error: "collection-name-already-in-use" });
      }

      const id = crypto.randomUUID();
      const position = (
        db
          .prepare("SELECT COALESCE(MAX(position) + 1, 0) as next FROM collections WHERE user_id = ?")
          .get(userId) as { next: number }
      ).next;

      db.prepare(
        "INSERT INTO collections (id, user_id, name, position) VALUES (?, ?, ?, ?)"
      ).run(id, userId, name.trim(), position);

      return { id, name: name.trim(), gamesCount: 0 };
    }
  );

  app.delete(
    "/profile/games/collections/:collectionId",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { collectionId: string } }>) => {
      const userId = (req as Req).userId;
      const { collectionId } = req.params;

      db.prepare("DELETE FROM collections WHERE id = ? AND user_id = ?").run(
        collectionId,
        userId
      );

      // Remove this collection from all games that had it
      const games = db
        .prepare(
          "SELECT id, collection_ids FROM games WHERE user_id = ? AND collection_ids != '[]'"
        )
        .all(userId) as { id: string; collection_ids: string }[];

      const update = db.prepare(
        "UPDATE games SET collection_ids = ? WHERE id = ?"
      );
      const tx = db.transaction(() => {
        for (const g of games) {
          const ids: string[] = JSON.parse(g.collection_ids || "[]");
          const updated = ids.filter((id) => id !== collectionId);
          if (updated.length !== ids.length) {
            update.run(JSON.stringify(updated), g.id);
          }
        }
      });
      tx();

      return {};
    }
  );

  app.delete(
    "/profile/games/:remoteId",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { remoteId: string } }>) => {
      const userId = (req as Req).userId;
      db.prepare("UPDATE games SET is_deleted = 1 WHERE id = ? AND user_id = ?").run(
        req.params.remoteId,
        userId
      );
      return {};
    }
  );

  app.put(
    "/profile/games/achievements",
    { preHandler: requireAuth },
    async (req: FastifyRequest) => {
      const userId = (req as Req).userId;
      const { id: remoteId, achievements } = req.body as { id: string; achievements: Array<{ name: string; unlockTime: number }> };

      const game = db.prepare("SELECT * FROM games WHERE id = ? AND user_id = ?").get(remoteId, userId) as DbGame | undefined;
      if (!game) return {};

      const upsert = db.prepare(`
        INSERT INTO achievements (id, user_id, object_id, shop, achievement_id, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, object_id, shop, achievement_id) DO NOTHING
      `);
      const tx = db.transaction((items: typeof achievements) => {
        for (const a of items) {
          upsert.run(crypto.randomUUID(), userId, game.object_id, game.shop, a.name,
            a.unlockTime ?? Math.floor(Date.now() / 1000));
        }
      });
      tx(achievements ?? []);

      const count = (db.prepare("SELECT COUNT(*) as cnt FROM achievements WHERE user_id = ? AND object_id = ? AND shop = ?")
        .get(userId, game.object_id, game.shop) as any)?.cnt ?? 0;
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
    }
  );

  app.put(
    "/profile/games/:shop/:objectId/achievements",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Params: { shop: string; objectId: string };
        Body: Array<{ name: string; unlockedAt: string }>;
      }>
    ) => {
      const userId = (req as Req).userId;
      const { shop, objectId } = req.params;
      const upsert = db.prepare(`
        INSERT INTO achievements (id, user_id, object_id, shop, achievement_id, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, object_id, shop, achievement_id) DO NOTHING
      `);
      const tx = db.transaction(
        (items: Array<{ name: string; unlockedAt: string }>) => {
          for (const a of items) {
            upsert.run(
              crypto.randomUUID(),
              userId,
              objectId,
              shop,
              a.name,
              Math.floor(new Date(a.unlockedAt).getTime() / 1000)
            );
          }
        }
      );
      tx(req.body);
      return {};
    }
  );

  app.delete(
    "/profile/games/achievements/:remoteId",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { remoteId: string } }>) => {
      const userId = (req as Req).userId;
      db.prepare("DELETE FROM achievements WHERE id = ? AND user_id = ?").run(
        req.params.remoteId,
        userId
      );
      return {};
    }
  );

  // Public user profile endpoints
  app.get(
    "/users/:userId",
    async (req: FastifyRequest<{ Params: { userId: string }; Querystring: any }>, rep: FastifyReply) => {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId) as DbUser | undefined;
      if (!user) return rep.code(404).send({ message: "Not found" });

      const stats = db.prepare(`
        SELECT COUNT(*) as cnt, SUM(play_time_in_seconds) as total_play
        FROM games WHERE user_id = ? AND is_deleted = 0
      `).get(req.params.userId) as any;

      const recentGames = (db.prepare(`
        SELECT * FROM games WHERE user_id = ? AND is_deleted = 0
        ORDER BY last_time_played DESC LIMIT 5
      `).all(req.params.userId) as DbGame[]).map(formatGame);

      const SESSION_TIMEOUT_SECONDS = 360;
      const nowTs = Math.floor(Date.now() / 1000);

      // Try Steam API first if user has steam_id configured
      let currentGame: object | null = null;
      if (user.steam_id && user.steam_api_key) {
        try {
          const steamRes = await fetch(
            `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(user.steam_api_key)}&steamids=${encodeURIComponent(user.steam_id)}`,
            { signal: AbortSignal.timeout(3000) }
          );
          if (steamRes.ok) {
            const steamData = await steamRes.json() as any;
            const player = steamData?.response?.players?.[0];
            if (player?.gameextrainfo && player?.gameid) {
              const steamObjectId = String(player.gameid);
              const dbGame = db.prepare(
                "SELECT * FROM games WHERE user_id = ? AND object_id = ? AND shop = 'steam' AND is_deleted = 0"
              ).get(req.params.userId, steamObjectId) as DbGame | undefined;
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
        } catch {}
      }

      // Fallback: DB session tracking (any shop, client ticks every 3 min → 6 min timeout)
      if (!currentGame) {
        const activeGame = db.prepare(`
          SELECT * FROM games WHERE user_id = ? AND is_deleted = 0
          AND session_started_at IS NOT NULL AND last_time_played >= ?
          ORDER BY last_time_played DESC LIMIT 1
        `).get(req.params.userId, nowTs - SESSION_TIMEOUT_SECONDS) as DbGame | undefined;

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
            sessionDurationInMillis: (nowTs - activeGame.session_started_at!) * 1000,
            sessionDurationInSeconds: nowTs - activeGame.session_started_at!,
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
    }
  );

  app.get(
    "/users/:userId/stats",
    async (req: FastifyRequest<{ Params: { userId: string }; Querystring: any }>) => {
      const stats = db.prepare(`
        SELECT COUNT(*) as cnt, SUM(play_time_in_seconds) as total_play, 0 as achievement_count
        FROM games WHERE user_id = ? AND is_deleted = 0
      `).get(req.params.userId) as any;
      const achievements = db.prepare(`
        SELECT COUNT(*) as cnt FROM achievements WHERE user_id = ?
      `).get(req.params.userId) as any;
      return {
        totalPlayTimeInSeconds: { value: Math.floor(stats?.total_play ?? 0), topPercentile: 100 },
        libraryCount: stats?.cnt ?? 0,
        achievementCount: achievements?.cnt ?? 0,
      };
    }
  );

  app.get(
    "/users/:userId/library",
    async (req: FastifyRequest<{ Params: { userId: string }; Querystring: { take?: string; skip?: string; sortBy?: string } }>) => {
      const skip = parseInt(req.query.skip ?? "0", 10);
      const take = parseInt(req.query.take ?? "12", 10);
      const sortBy = req.query.sortBy === "playedRecently" ? "last_time_played DESC NULLS LAST" : "title ASC";
      const allGames = db
        .prepare(`SELECT * FROM games WHERE user_id = ? AND is_deleted = 0 ORDER BY ${sortBy}`)
        .all(req.params.userId) as DbGame[];
      const pinned = allGames.filter(g => g.is_pinned).map(formatGame);
      const unpinned = allGames.filter(g => !g.is_pinned);
      const page = unpinned.slice(skip, skip + take).map(formatGame);
      return { library: page, pinnedGames: skip === 0 ? pinned : [], total: allGames.length };
    }
  );

  app.get("/users/:userId/reviews", async () => {
    return { results: [], total: 0 };
  });

  app.get("/profile/blocks", { preHandler: requireAuth }, async () => {
    return { blocks: [], total: 0 };
  });

  app.get("/features", async () => {
    return [];
  });

  app.get("/badges", async () => {
    return [];
  });

  // Notification stubs — self-hosted has no social notifications
  app.get("/profile/notifications", { preHandler: requireAuth }, async () => {
    return { notifications: [], pagination: { total: 0, take: 20, skip: 0, hasMore: false } };
  });
  // /profile/notifications/count is registered in friends.ts
  app.put("/profile/notifications/:id/read", { preHandler: requireAuth }, async () => {
    return {};
  });
  app.delete("/profile/notifications/:id", { preHandler: requireAuth }, async () => {
    return {};
  });
  app.put("/profile/notifications/all/read", { preHandler: requireAuth }, async () => {
    return {};
  });
  app.delete("/profile/notifications/all", { preHandler: requireAuth }, async () => {
    return {};
  });
}
