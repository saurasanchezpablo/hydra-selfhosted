"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewsRoutes = reviewsRoutes;
const crypto_1 = require("crypto");
const db_1 = require("../db");
const auth_1 = require("./auth");
db_1.db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    object_id TEXT NOT NULL,
    shop TEXT NOT NULL,
    review_html TEXT NOT NULL DEFAULT '',
    score INTEGER NOT NULL,
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, object_id, shop)
  );
  CREATE TABLE IF NOT EXISTS review_answers (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    answer_html TEXT NOT NULL,
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS review_votes (
    user_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    vote_type TEXT NOT NULL,
    PRIMARY KEY(user_id, target_id)
  );
`);
function formatReview(r, userId) {
    const user = db_1.db.prepare("SELECT id, display_name, profile_image_url FROM users WHERE id = ?").get(r.user_id);
    const answers = db_1.db.prepare("SELECT * FROM review_answers WHERE review_id = ? ORDER BY created_at ASC LIMIT 3").all(r.id);
    const answerCount = db_1.db.prepare("SELECT COUNT(*) as c FROM review_answers WHERE review_id = ?").get(r.id).c;
    const userVote = userId ? db_1.db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(userId, r.id) : null;
    return {
        id: r.id,
        reviewHtml: r.review_html,
        score: r.score,
        createdAt: new Date(r.created_at * 1000).toISOString(),
        updatedAt: new Date(r.updated_at * 1000).toISOString(),
        upvotes: r.upvotes,
        downvotes: r.downvotes,
        answerCount,
        answers: answers.map(a => formatAnswer(a, userId)),
        isBlocked: false,
        hasUpvoted: userVote?.vote_type === "upvote",
        hasDownvoted: userVote?.vote_type === "downvote",
        user: { id: user?.id ?? r.user_id, displayName: user?.display_name ?? "", profileImageUrl: user?.profile_image_url ?? null },
        translations: {},
        detectedLanguage: null,
    };
}
function formatAnswer(a, userId) {
    const user = db_1.db.prepare("SELECT id, display_name, profile_image_url FROM users WHERE id = ?").get(a.user_id);
    const userVote = userId ? db_1.db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(userId, a.id) : null;
    return {
        id: a.id,
        answerHtml: a.answer_html,
        createdAt: new Date(a.created_at * 1000).toISOString(),
        updatedAt: new Date(a.updated_at * 1000).toISOString(),
        upvotes: a.upvotes,
        downvotes: a.downvotes,
        isBlocked: false,
        hasUpvoted: userVote?.vote_type === "upvote",
        hasDownvoted: userVote?.vote_type === "downvote",
        user: { id: user?.id ?? a.user_id, displayName: user?.display_name ?? "", profileImageUrl: user?.profile_image_url ?? null },
        translations: {},
        detectedLanguage: null,
    };
}
async function reviewsRoutes(app) {
    app.get("/games/:shop/:objectId/reviews/check", { preHandler: auth_1.requireAuth }, async (req) => {
        const user = req.user;
        const { shop, objectId } = req.params;
        const row = db_1.db.prepare("SELECT id FROM reviews WHERE user_id = ? AND object_id = ? AND shop = ?").get(user.id, objectId, shop);
        return { hasReviewed: !!row };
    });
    app.get("/games/:shop/:objectId/reviews", async (req) => {
        const { shop, objectId } = req.params;
        const take = parseInt(req.query.take ?? "20");
        const skip = parseInt(req.query.skip ?? "0");
        const sortBy = req.query.sortBy ?? "createdAt";
        const order = sortBy === "score" ? "score DESC" : sortBy === "upvotes" ? "upvotes DESC" : "created_at DESC";
        const userId = req.user?.id ?? null;
        const reviews = db_1.db.prepare(`SELECT * FROM reviews WHERE object_id = ? AND shop = ? ORDER BY ${order} LIMIT ? OFFSET ?`).all(objectId, shop, take, skip);
        const totalCount = db_1.db.prepare("SELECT COUNT(*) as c FROM reviews WHERE object_id = ? AND shop = ?").get(objectId, shop).c;
        return { reviews: reviews.map(r => formatReview(r, userId)), totalCount };
    });
    app.post("/games/:shop/:objectId/reviews", { preHandler: auth_1.requireAuth }, async (req, reply) => {
        const user = req.user;
        const { shop, objectId } = req.params;
        const { reviewHtml = "", score } = req.body ?? {};
        if (score == null)
            return reply.code(400).send({ error: "score required" });
        const id = (0, crypto_1.randomUUID)();
        db_1.db.prepare("INSERT OR REPLACE INTO reviews(id, user_id, object_id, shop, review_html, score) VALUES(?,?,?,?,?,?)").run(id, user.id, objectId, shop, reviewHtml, score);
        return formatReview(db_1.db.prepare("SELECT * FROM reviews WHERE id = ?").get(id), user.id);
    });
    app.delete("/games/:shop/:objectId/reviews/:reviewId", { preHandler: auth_1.requireAuth }, async (req) => {
        const user = req.user;
        db_1.db.prepare("DELETE FROM reviews WHERE id = ? AND user_id = ?").run(req.params.reviewId, user.id);
        return { ok: true };
    });
    app.put("/games/:shop/:objectId/reviews/:reviewId/:voteType", { preHandler: auth_1.requireAuth }, async (req) => {
        const user = req.user;
        const { reviewId, voteType } = req.params;
        const existing = db_1.db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(user.id, reviewId);
        if (existing?.vote_type === voteType) {
            db_1.db.prepare("DELETE FROM review_votes WHERE user_id = ? AND target_id = ?").run(user.id, reviewId);
            db_1.db.prepare(`UPDATE reviews SET ${voteType}s = ${voteType}s - 1 WHERE id = ?`).run(reviewId);
        }
        else {
            if (existing)
                db_1.db.prepare(`UPDATE reviews SET ${existing.vote_type}s = ${existing.vote_type}s - 1 WHERE id = ?`).run(reviewId);
            db_1.db.prepare("INSERT OR REPLACE INTO review_votes(user_id, target_id, vote_type) VALUES(?,?,?)").run(user.id, reviewId, voteType);
            db_1.db.prepare(`UPDATE reviews SET ${voteType}s = ${voteType}s + 1 WHERE id = ?`).run(reviewId);
        }
        return { ok: true };
    });
    app.get("/games/:shop/:objectId/reviews/:reviewId/answers", async (req) => {
        const { reviewId } = req.params;
        const take = parseInt(req.query.take ?? "20");
        const skip = parseInt(req.query.skip ?? "0");
        const userId = req.user?.id ?? null;
        const answers = db_1.db.prepare("SELECT * FROM review_answers WHERE review_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?").all(reviewId, take, skip);
        const totalCount = db_1.db.prepare("SELECT COUNT(*) as c FROM review_answers WHERE review_id = ?").get(reviewId).c;
        return { answers: answers.map(a => formatAnswer(a, userId)), totalCount };
    });
    app.post("/games/:shop/:objectId/reviews/:reviewId/answers", { preHandler: auth_1.requireAuth }, async (req) => {
        const user = req.user;
        const id = (0, crypto_1.randomUUID)();
        db_1.db.prepare("INSERT INTO review_answers(id, review_id, user_id, answer_html) VALUES(?,?,?,?)").run(id, req.params.reviewId, user.id, req.body?.answerHtml ?? "");
        return formatAnswer(db_1.db.prepare("SELECT * FROM review_answers WHERE id = ?").get(id), user.id);
    });
    app.put("/games/:shop/:objectId/reviews/:reviewId/answers/:answerId/:voteType", { preHandler: auth_1.requireAuth }, async (req) => {
        const user = req.user;
        const { answerId, voteType } = req.params;
        const existing = db_1.db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(user.id, answerId);
        if (existing?.vote_type === voteType) {
            db_1.db.prepare("DELETE FROM review_votes WHERE user_id = ? AND target_id = ?").run(user.id, answerId);
            db_1.db.prepare(`UPDATE review_answers SET ${voteType}s = ${voteType}s - 1 WHERE id = ?`).run(answerId);
        }
        else {
            if (existing)
                db_1.db.prepare(`UPDATE review_answers SET ${existing.vote_type}s = ${existing.vote_type}s - 1 WHERE id = ?`).run(answerId);
            db_1.db.prepare("INSERT OR REPLACE INTO review_votes(user_id, target_id, vote_type) VALUES(?,?,?)").run(user.id, answerId, voteType);
            db_1.db.prepare(`UPDATE review_answers SET ${voteType}s = ${voteType}s + 1 WHERE id = ?`).run(answerId);
        }
        return { ok: true };
    });
    app.delete("/games/:shop/:objectId/reviews/:reviewId/answers/:answerId", { preHandler: auth_1.requireAuth }, async (req) => {
        const user = req.user;
        db_1.db.prepare("DELETE FROM review_answers WHERE id = ? AND user_id = ?").run(req.params.answerId, user.id);
        return { ok: true };
    });
}
